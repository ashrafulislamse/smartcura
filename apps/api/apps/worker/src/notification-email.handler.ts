import { Logger } from '@nestjs/common';
import { formatSafeLog } from '@smartcura/observability';
import type { NotificationRepository, EmailWorkRow } from '@smartcura/database/consultations';
import { renderEmail, escapeHtml, type EmailTemplateInput, type RenderedEmail, type PharmacyOrderStatus } from './email-templates.js';
import { renderNotificationCopy } from './notification-copy.js';

/**
 * Transactional email delivery, mirroring the push channel.
 *
 * The push handler (`NotificationPushHandler`) sends only opaque identifiers to the
 * provider; the email channel is different because an email body MUST carry rendered
 * content (subject + HTML). The content is still minimum-data: it carries the
 * recipient's display name and the resource references needed to render a template,
 * never clinical detail, never tokens that grant authority beyond viewing a page.
 *
 * The recipient's email address is resolved from `profiles` by `loadEmailWork` in
 * the notification repository, not carried on the outbox payload, so a leaked
 * outbox row does not expose contact details.
 */

export interface EmailDeliveryProvider {
  send(input: {
    operationId: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<{ delivered: boolean; providerReference: string | null; errorCode: string | null }>;
}

/**
 * Deterministic stub. Logs the email and reports success without sending anything,
 * matching `DeterministicPushDeliveryProvider`. Allowed in production for the FYP
 * demo with a warning log at boot (see `selectEmailProvider` in worker.module.ts).
 */
export class DeterministicEmailDeliveryProvider implements EmailDeliveryProvider {
  private readonly logger = new Logger(DeterministicEmailDeliveryProvider.name);

  async send(input: {
    operationId: string; to: string; subject: string; html: string;
  }): Promise<{ delivered: boolean; providerReference: string | null; errorCode: string | null }> {
    this.logger.log(formatSafeLog({
      event: 'email.deterministic_send',
      operation_id: input.operationId,
      to: input.to,
      subject: input.subject,
    }));
    return {
      delivered: true,
      providerReference: `deterministic:${input.operationId}`,
      errorCode: null,
    } as const;
  }
}

/**
 * Cloudflare Email Service adapter using the REST API.
 *
 * Sends transactional email via the Cloudflare Email Sending API. The endpoint and
 * request shape follow the Cloudflare Email Service REST API for outbound mail;
 * the `from` address is derived from the configured verified domain
 * (`CLOUDFLARE_EMAIL_DOMAIN`) so the recipient sees a consistent sender.
 *
 * NOTE on the exact API surface: Cloudflare Email Service's outbound REST endpoint
 * is documented under the account-level Email Routing/Sending API. If the field
 * names or path drift between API revisions, the TODO below marks the only part
 * that depends on the live contract; the interface, template rendering, and worker
 * wiring do not.
 */
export class CloudflareEmailDeliveryProvider implements EmailDeliveryProvider {
  private readonly logger = new Logger(CloudflareEmailDeliveryProvider.name);

  constructor(private readonly config: {
    apiToken: string;
    accountId: string;
    fromDomain: string;
    fromName: string;
  }) {}

  async send(input: {
    operationId: string; to: string; subject: string; html: string;
  }): Promise<{ delivered: boolean; providerReference: string | null; errorCode: string | null }> {
    const fromAddress = `no-reply@${this.config.fromDomain}`;
    // TODO: confirm the exact path/field names against the live Cloudflare Email
    // Service REST API version deployed in the target account. The interface and
    // wiring above this call are stable regardless of the endpoint shape.
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/email/messages`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { email: fromAddress, name: this.config.fromName },
          to: [input.to],
          subject: input.subject,
          html: input.html,
          // A stable reference so bounces/complaints can be correlated back to the
          // notification delivery that produced the send.
          custom_headers: [
            { name: 'X-SmartCura-Operation-Id', value: input.operationId },
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(formatSafeLog({
          event: 'email.cloudflare_http_error',
          operation_id: input.operationId,
          status: response.status,
          body,
        }));
        return {
          delivered: false,
          providerReference: null,
          errorCode: `http_${response.status}`,
        } as const;
      }
      const data = await response.json().catch(() => ({})) as {
        result?: { id?: string }; success?: boolean;
      };
      const reference = data.result?.id ?? null;
      return {
        delivered: data.success !== false,
        providerReference: reference,
        errorCode: data.success === false ? 'cloudflare_rejected' : null,
      } as const;
    } catch (error) {
      this.logger.error(formatSafeLog({
        event: 'email.cloudflare_fetch_error',
        operation_id: input.operationId,
        error: error instanceof Error ? error.message : String(error),
      }));
      return {
        delivered: false,
        providerReference: null,
        errorCode: 'fetch_error',
      } as const;
    }
  }
}

/**
 * Maps a notification's category and resource to the template input it needs.
 *
 * The notification row carries a `category` (the NotificationCategory enum) and a
 * `resource_type`/`resource_id` pair; `loadEmailWork` joins the LIVE appointment or
 * pharmacy-order row, so these templates state the real date, doctor, mode, and
 * order status. When the join produced nothing (the entity was deleted, or the
 * notification is not about one of these entities) the function returns undefined
 * and the handler renders the generic notice — a template with invented data is
 * worse than no template.
 *
 * The password-reset template deliberately has NO branch here: no reset flow exists
 * (Firebase Auth owns password reset), so wiring it would ship a link that does
 * nothing. It stays exported for the day a real token-issuing flow exists.
 */
function toTemplateInput(work: EmailWorkRow): EmailTemplateInput | undefined {
  const recipient = { displayName: work.displayName, email: work.email };
  switch (work.category) {
    case 'appointments':
      if (work.appointmentStartsAt === null || work.appointmentStartsAt === undefined) return undefined;
      return {
        kind: 'appointment_reminder',
        recipient,
        doctorName: work.appointmentDoctorName ?? 'your doctor',
        clinicName: 'SmartCura',
        date: work.appointmentStartsAt.toISOString().slice(0, 10),
        time: work.appointmentStartsAt.toISOString().slice(11, 16) + ' UTC',
        mode: work.appointmentMode === 'video' ? 'Video consultation'
          : work.appointmentMode === 'onsite' ? 'In-person visit'
          : work.appointmentMode ?? 'as booked',
      };
    case 'ai_review':
    case 'system':
      // Verification results arrive under categories that surface document review.
      // The title_code distinguishes a verification outcome from a generic system
      // notice.
      if (work.titleCode.startsWith('verification.')) {
        return {
          kind: 'verification_result',
          recipient,
          status: work.titleCode.endsWith('.approved') ? 'approved'
            : work.titleCode.endsWith('.rejected') ? 'rejected'
            : work.titleCode.endsWith('.changes_requested') ? 'changes_requested'
            : 'pending_review',
          documentType: work.resourceType.replace(/_/g, ' '),
          reason: null,
        };
      }
      return undefined;
    case 'delivery':
      // Pharmacy order updates arrive under the delivery category. The status is
      // the LIVE order status from the join, never a hardcoded value.
      if (work.pharmacyOrderStatus === null || work.pharmacyOrderStatus === undefined) return undefined;
      return {
        kind: 'pharmacy_order_update',
        recipient,
        orderId: work.resourceId,
        status: work.pharmacyOrderStatus as PharmacyOrderStatus,
        itemsSummary: work.pharmacyItemCount === null
          ? 'the items on your order'
          : `${work.pharmacyItemCount} item${work.pharmacyItemCount === 1 ? '' : 's'}`,
      };
    default:
      // consultations, messages, prescriptions, vitals_alerts, emergency,
      // account_security: no dedicated template; the generic notice carries the
      // copy-catalogue wording instead.
      return undefined;
  }
}

/**
 * Renders a generic notice for a notification that has no dedicated template, so an
 * email always carries a readable body rather than a mislabeled template. The copy
 * comes from the same server-side catalogue the push channel uses, so the email
 * never ships a raw `body_code` string to a human.
 */
function renderGenericNotice(work: EmailWorkRow): RenderedEmail {
  const copy = renderNotificationCopy(work);
  const subject = copy.title;
  const html = [
    `<p>Dear ${escapeHtml(work.displayName)},</p>`,
    `<p>${escapeHtml(copy.body)}</p>`,
    `<p>Open the SmartCura app to view the details. Your notification centre keeps the full history.</p>`,
    `<p style="color:#666;font-size:small">This is an automated message from SmartCura. Do not reply to this email.</p>`,
  ].join('\n');
  return { subject, html };
}

export class NotificationEmailHandler {
  private readonly logger = new Logger(NotificationEmailHandler.name);

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly provider: EmailDeliveryProvider,
  ) {}

  async handle(deliveryId: string): Promise<boolean> {
    const work = await this.notifications.loadEmailWork(deliveryId);
    if (work === undefined || work.status === 'delivered' || work.status === 'suppressed') {
      return true;
    }
    // An email without a verifiable address cannot be delivered. Suppressed is a
    // terminal state the loader already short-circuits; an empty address is a
    // data-quality failure we settle as a failed delivery rather than retrying.
    if (work.email.length === 0) {
      this.logger.warn(formatSafeLog({
        event: 'email.empty_recipient',
        delivery_id: deliveryId,
        profile_id: work.profileId,
      }));
      await this.notifications.settleEmail({
        deliveryId, delivered: false, providerReference: null,
        errorCode: 'empty_recipient', now: new Date(),
      });
      return true;
    }
    // Categories without a dedicated template still get a readable generic body.
    // toTemplateInput returns undefined when there is no honest dedicated template
    // (including when the entity join produced no live row), never an invented one.
    const templateInput = toTemplateInput(work);
    const rendered = templateInput !== undefined
      ? renderEmail(templateInput)
      : renderGenericNotice(work);

    const result = await this.provider.send({
      operationId: work.deliveryId,
      to: work.email,
      subject: rendered.subject,
      html: rendered.html,
    });

    // Successful delivery: settle as delivered (terminal) so the outbox consumes the event.
    if (result.delivered) {
      const settled = await this.notifications.settleEmail({
        deliveryId: work.deliveryId,
        delivered: true,
        providerReference: result.providerReference,
        errorCode: result.errorCode,
        now: new Date(),
      });
      return settled !== 'not_found';
    }

    // Delivery failed. Distinguish permanent from transient: a permanent failure
    // is settled as 'failed' (terminal) so the outbox consumes the event; a
    // transient failure is left 'queued' and returns false so the outbox retries
    // the event on the next poll cycle.
    const permanentEmailErrorCodes = new Set(['empty_recipient', 'invalid_email', 'smtp_auth_error']);
    if (result.errorCode !== null && permanentEmailErrorCodes.has(result.errorCode)) {
      const settled = await this.notifications.settleEmail({
        deliveryId: work.deliveryId,
        delivered: false,
        providerReference: result.providerReference,
        errorCode: result.errorCode,
        now: new Date(),
      });
      return settled !== 'not_found';
    }

    // Transient failure (smtp_error, fetch_error, http_5xx, etc.): do not settle.
    // The delivery stays 'queued' and the outbox will re-claim the event on the
    // next poll cycle for retry.
    this.logger.warn(formatSafeLog({
      event: 'email.transient_failure',
      delivery_id: deliveryId,
      profile_id: work.profileId,
      error_code: result.errorCode,
    }));
    return false;
  }
}
