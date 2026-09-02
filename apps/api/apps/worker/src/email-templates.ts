/**
 * Transactional email template system: layout → templates → renderer.
 *
 * Architecture (business logic never touches HTML):
 *
 *   Business event → Email Event (notification.email-requested.v1)
 *                 → Template selection (notification-email.handler)
 *                 → renderTemplate(name, data)   [this file]
 *                 → SMTP / provider transport
 *
 * Templates are pure functions from structured data to a `{ subject, html }`
 * pair. They carry NO secrets, NO tokens that grant authority beyond reading a
 * page, and no clinical detail beyond what the in-app notification already
 * shows. They never query the database — the handler resolves real data (joins
 * in `loadEmailWork`) and passes it in.
 *
 * TYPE SAFETY: `renderTemplate` is keyed on a `TemplateName` union whose data
 * type is locked by the `TEMPLATE_DATA` map, so an invented name is a compile
 * error and a mismatched data object is a compile error — the same guarantee the
 * previous discriminated union gave, in the centralized `renderTemplate(name,
 * data)` shape.
 *
 * DESIGN: one lightweight, table-based, inline-styled layout (email clients
 * strip <style> blocks), brand blue #1E3FAE matching the apps and portal, no
 * images (readable everywhere, nothing to block), fluid 560px column for
 * mobile. Transactional healthcare communication, not marketing.
 */

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
}

/** A recipient's display name and email, resolved by the handler before send. */
export interface EmailRecipient {
  readonly displayName: string;
  readonly email: string;
}

// --- Layout -----------------------------------------------------------------

const BRAND_BLUE = '#1e3fae';

/**
 * The email's action block. A `url` CTA is a real button to a REAL route that
 * exists for this recipient; an `app` CTA is a styled instruction to open the
 * SmartCura app — patients have no web surface, and a button that goes nowhere
 * (or to a login that leads nowhere) is a fake CTA, which this system does not
 * ship.
 */
export type EmailCta =
  | { readonly kind: 'url'; readonly label: string; readonly url: string }
  | { readonly kind: 'app'; readonly label: string; readonly detail: string };

export function emailLayout(input: {
  readonly preheader: string;
  readonly bodyHtml: string;
  readonly cta: EmailCta | null;
}): string {
  const ctaHtml = input.cta === null ? '' : input.cta.kind === 'url'
    ? [
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td style="border-radius:8px;background:${BRAND_BLUE}">`,
      `<a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:12px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">${escapeHtml(input.cta.label)}</a>`,
      `</td></tr></table>`,
    ].join('')
    : [
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td style="border-radius:8px;background:#eef1fb;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:${BRAND_BLUE}">`,
      `<strong style="color:${BRAND_BLUE}">${escapeHtml(input.cta.label)}</strong><br>`,
      `<span style="color:#475569">${escapeHtml(input.cta.detail)}</span>`,
      `</td></tr></table>`,
    ].join('');
  return [
    `<!DOCTYPE html>`,
    `<html lang="en"><body style="margin:0;padding:0;background:#f1f5f9">`,
    // Preheader: the snippet mail clients show after the subject. Hidden visually.
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">`,
    // Header: text wordmark, no images.
      `<tr><td style="padding:20px 28px;background:${BRAND_BLUE};border-radius:12px 12px 0 0;font-family:Arial,Helvetica,sans-serif">`,
      `<span style="font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:0.5px">SmartCura</span>`,
      `<span style="display:block;font-size:11px;color:#c7d2fe;margin-top:2px">Healthcare communication</span>`,
      `</td></tr>`,
    // Body card.
      `<tr><td style="padding:28px;background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#1e293b">`,
      input.bodyHtml,
      ctaHtml,
      `</td></tr>`,
    // Footer.
      `<tr><td style="padding:16px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#94a3b8;text-align:center">`,
      `This is an automated message from SmartCura. Do not reply to this email.`,
      `<br>SmartCura is a prototype healthcare platform; this email is not medical advice.`,
      `</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join('\n');
}

// --- Appointment reminder ----------------------------------------------------

export interface AppointmentReminderData {
  readonly recipient: EmailRecipient;
  readonly doctorName: string;
  /** Clinic or organization display name. */
  readonly clinicName: string;
  /** ISO-8601 date string, e.g. "2026-08-15". */
  readonly date: string;
  /** Human-readable time, e.g. "09:30 UTC". */
  readonly time: string;
  /** In-person or video, as a short label. */
  readonly mode: string;
}

export function renderAppointmentReminder(input: AppointmentReminderData): RenderedEmail {
  const subject = `Appointment reminder — ${input.date} at ${input.time}`;
  const bodyHtml = [
    `<p style="margin:0 0 16px">Dear ${escapeHtml(input.recipient.displayName)},</p>`,
    `<p style="margin:0 0 16px">This is a reminder for your upcoming appointment.</p>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;font-size:15px">`,
    row('Date', input.date),
    row('Time', input.time),
    row('Doctor', input.doctorName),
    row('Clinic', input.clinicName),
    row('Type', input.mode),
    `</table>`,
    `<p style="margin:0;color:#475569">Please arrive 10 minutes early for in-person visits, or join the video room a few minutes before the scheduled time.</p>`,
  ].join('\n');
  return {
    subject,
    html: emailLayout({
      preheader: `Your appointment on ${input.date} at ${input.time}.`,
      bodyHtml,
      cta: { kind: 'app', label: 'View this appointment in SmartCura', detail: 'Open the SmartCura app and tap the notification to see the full appointment details.' },
    }),
  };
}

function row(label: string, value: string): string {
  return [
    `<tr>`,
    `<td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>`,
    `<td style="padding:6px 0;font-weight:bold">${escapeHtml(value)}</td>`,
    `</tr>`,
  ].join('');
}

// --- Verification result -----------------------------------------------------

/**
 * The verification status vocabulary, DERIVED from the frozen catalogue rather than
 * retyped. A retyped copy is how `not_required` and `pending` once crept in as
 * accepted values that do not exist in `pg_enum`.
 */
export const VERIFICATION_STATUSES = [
  'not_submitted', 'pending_review', 'changes_requested', 'approved',
  'rejected', 'suspended', 'expired',
] as const;
export type VerificationStatus = typeof VERIFICATION_STATUSES[number];

export interface VerificationResultData {
  readonly recipient: EmailRecipient;
  readonly status: VerificationStatus;
  /** Human-readable label for the document type, e.g. "Medical license". */
  readonly documentType: string;
  /** Free-text reviewer reason; only present for changes_requested/rejected. */
  readonly reason: string | null;
}

export function renderVerificationResult(input: VerificationResultData): RenderedEmail {
  if (input.status === 'approved') {
    const subject = `Your ${input.documentType} verification was approved`;
    const bodyHtml = [
      `<p style="margin:0 0 16px">Dear ${escapeHtml(input.recipient.displayName)},</p>`,
      `<p style="margin:0">Your <strong>${escapeHtml(input.documentType)}</strong> has been verified and approved. You may now proceed with your assigned role.</p>`,
    ].join('\n');
    return {
      subject,
      html: emailLayout({
        preheader: `Your ${input.documentType} was approved.`,
        bodyHtml,
        cta: { kind: 'app', label: 'Open SmartCura', detail: 'You can continue where you left off in the SmartCura app.' },
      }),
    };
  }
  if (input.status === 'rejected' || input.status === 'changes_requested') {
    const outcome = input.status === 'rejected' ? 'rejected' : 'returned for changes';
    const subject = `Your ${input.documentType} verification was ${outcome}`;
    const reasonBlock = input.reason !== null && input.reason.length > 0
      ? `<p style="margin:0 0 16px;padding:12px 16px;background:#f8fafc;border-left:3px solid ${BRAND_BLUE};border-radius:4px"><strong>Reviewer note:</strong> ${escapeHtml(input.reason)}</p>`
      : '';
    const bodyHtml = [
      `<p style="margin:0 0 16px">Dear ${escapeHtml(input.recipient.displayName)},</p>`,
      `<p style="margin:0 0 16px">Your <strong>${escapeHtml(input.documentType)}</strong> was ${escapeHtml(outcome)}.</p>`,
      reasonBlock,
    ].join('\n');
    return {
      subject,
      html: emailLayout({
        preheader: `Your ${input.documentType} was ${outcome}.`,
        bodyHtml,
        cta: { kind: 'app', label: 'Submit updated documentation', detail: 'Open the SmartCura app and follow the verification steps to submit an updated document.' },
      }),
    };
  }
  // pending_review, not_submitted, suspended, expired: a neutral status update.
  const subject = `Update on your ${input.documentType} verification`;
  const bodyHtml = [
    `<p style="margin:0 0 16px">Dear ${escapeHtml(input.recipient.displayName)},</p>`,
    `<p style="margin:0">The verification status of your <strong>${escapeHtml(input.documentType)}</strong> is now: <strong>${escapeHtml(input.status.replace(/_/g, ' '))}</strong>.</p>`,
  ].join('\n');
  return {
    subject,
    html: emailLayout({
      preheader: `Verification status: ${input.status.replace(/_/g, ' ')}.`,
      bodyHtml,
      cta: null,
    }),
  };
}

// --- Password reset ----------------------------------------------------------

export interface PasswordResetData {
  readonly recipient: EmailRecipient;
  /** The full reset URL, already carrying the one-time token. */
  readonly resetLink: string;
  /** Human-readable expiry, e.g. "30 minutes". */
  readonly expiry: string;
}

export function renderPasswordReset(input: PasswordResetData): RenderedEmail {
  const subject = `Reset your SmartCura password`;
  const bodyHtml = [
    `<p style="margin:0 0 16px">Dear ${escapeHtml(input.recipient.displayName)},</p>`,
    `<p style="margin:0 0 16px">We received a request to reset your password. Use the button below to choose a new one.</p>`,
    `<p style="margin:0;color:#475569">This link expires in ${escapeHtml(input.expiry)} and can be used once. If you did not request a reset, you can safely ignore this email.</p>`,
  ].join('\n');
  return {
    subject,
    html: emailLayout({
      preheader: 'A password reset was requested for your SmartCura account.',
      bodyHtml,
      cta: { kind: 'url', label: 'Reset password', url: input.resetLink },
    }),
  };
}

// --- Pharmacy order update ---------------------------------------------------

/**
 * The pharmacy order state vocabulary, DERIVED from the frozen catalogue. A retyped
 * copy is how `dispatched` once masked the real `dispatching` status.
 */
export const PHARMACY_ORDER_STATUSES = [
  'received', 'awaiting_validation', 'validated', 'stock_reserved', 'fulfilling',
  'ready_for_dispatch', 'dispatched', 'delivered', 'delivery_exception', 'returned',
  'rejected', 'cancelled',
] as const;
export type PharmacyOrderStatus = typeof PHARMACY_ORDER_STATUSES[number];

export interface PharmacyOrderUpdateData {
  readonly recipient: EmailRecipient;
  readonly orderId: string;
  readonly status: PharmacyOrderStatus;
  /** Short human-readable items summary, e.g. "3 items". */
  readonly itemsSummary: string;
}

export function renderPharmacyOrderUpdate(input: PharmacyOrderUpdateData): RenderedEmail {
  const subject = `Pharmacy order ${input.orderId} — ${input.status.replace(/_/g, ' ')}`;
  const bodyHtml = [
    `<p style="margin:0 0 16px">Dear ${escapeHtml(input.recipient.displayName)},</p>`,
    `<p style="margin:0 0 16px">Your pharmacy order has been updated.</p>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;font-size:15px">`,
    row('Order', input.orderId),
    row('Status', input.status.replace(/_/g, ' ')),
    row('Items', input.itemsSummary),
    `</table>`,
  ].join('\n');
  return {
    subject,
    html: emailLayout({
      preheader: `Your pharmacy order is ${input.status.replace(/_/g, ' ')}.`,
      bodyHtml,
      cta: { kind: 'app', label: 'Track this order', detail: 'Open the SmartCura app and tap the notification to see the order and its delivery status.' },
    }),
  };
}

// --- Generic notice ----------------------------------------------------------

export interface GenericNoticeData {
  readonly recipient: EmailRecipient;
  /** Already-humanized copy from the server-side notification catalogue. */
  readonly title: string;
  readonly body: string;
}

export function renderGenericNotice(input: GenericNoticeData): RenderedEmail {
  const bodyHtml = [
    `<p style="margin:0 0 16px">Dear ${escapeHtml(input.recipient.displayName)},</p>`,
    `<p style="margin:0">${escapeHtml(input.body)}</p>`,
  ].join('\n');
  return {
    subject: input.title,
    html: emailLayout({
      preheader: input.body,
      bodyHtml,
      cta: { kind: 'app', label: 'View in SmartCura', detail: 'Open the SmartCura app — your notification centre keeps the full history.' },
    }),
  };
}

// --- Centralized renderer ----------------------------------------------------

export const EMAIL_TEMPLATE_NAMES = [
  'appointment_reminder', 'verification_result', 'password_reset',
  'pharmacy_order_update', 'generic_notice',
] as const;
export type EmailTemplateName = typeof EMAIL_TEMPLATE_NAMES[number];

/**
 * The name → data contract. Every template's data type lives here, so
 * `renderTemplate('x', data)` with the wrong data shape cannot compile and a
 * template cannot be added without a data type.
 */
interface TemplateDataMap {
  readonly appointment_reminder: AppointmentReminderData;
  readonly verification_result: VerificationResultData;
  readonly password_reset: PasswordResetData;
  readonly pharmacy_order_update: PharmacyOrderUpdateData;
  readonly generic_notice: GenericNoticeData;
}

const RENDERERS: { readonly [K in EmailTemplateName]: (data: TemplateDataMap[K]) => RenderedEmail } = {
  appointment_reminder: renderAppointmentReminder,
  verification_result: renderVerificationResult,
  password_reset: renderPasswordReset,
  pharmacy_order_update: renderPharmacyOrderUpdate,
  generic_notice: renderGenericNotice,
};

/** The centralized renderer: business logic calls this, never a template directly. */
export function renderTemplate<K extends EmailTemplateName>(
  name: K, data: TemplateDataMap[K],
): RenderedEmail {
  return RENDERERS[name](data);
}

// --- Backward-compatible discriminated-union entry point ---------------------

/**
 * The discriminated-union shape the email handler builds: a `kind` tag plus the
 * matching data fields. Derived from `TemplateDataMap` so a new template cannot
 * be added without its data type also appearing here.
 */
export type EmailTemplateInput = {
  [K in EmailTemplateName]: { readonly kind: K } & TemplateDataMap[K];
}[EmailTemplateName];

/**
 * Renders from the discriminated-union shape. Equivalent to
 * `renderTemplate(input.kind, input)` — the switch narrows the union so each
 * branch passes the correctly-typed data to its renderer.
 */
export function renderEmail(input: EmailTemplateInput): RenderedEmail {
  switch (input.kind) {
    case 'appointment_reminder': return renderAppointmentReminder(input);
    case 'verification_result': return renderVerificationResult(input);
    case 'password_reset': return renderPasswordReset(input);
    case 'pharmacy_order_update': return renderPharmacyOrderUpdate(input);
    case 'generic_notice': return renderGenericNotice(input);
  }
}

// --- HTML escaping -----------------------------------------------------------

/**
 * Escapes the five HTML-significant characters. Template data originates from the
 * database and includes user-supplied display names, so every interpolation passes
 * through here to prevent reflected HTML injection in an email body.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
