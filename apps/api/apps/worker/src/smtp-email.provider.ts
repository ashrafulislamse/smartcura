import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { formatSafeLog } from '@smartcura/observability';
import type { EmailDeliveryProvider } from './notification-email.handler.js';

/**
 * The slice of nodemailer's transporter the provider calls. Structural so tests
 * can supply a mock without a socket.
 */
export interface SmtpTransportClient {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string; response?: string }>;
}

export interface SmtpProviderConfig {
  readonly host: string;
  readonly port: number;
  /** True for implicit TLS (port 465); false upgrades via STARTTLS (587). */
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly fromEmail: string;
  readonly fromName: string;
}

/**
 * SMTP adapter for transactional email, targeting **Hostinger Email SMTP**
 * (`smtp.hostinger.com`, implicit TLS on 465 — supplied through env vars, never
 * hardcoded). Implements the same `EmailDeliveryProvider` interface as the
 * Cloudflare and deterministic adapters, so the selection factory in
 * `worker.module.ts` can swap it in with `SMARTCURA_EMAIL_PROVIDER=smtp`.
 *
 * Credentials live only in env (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
 * `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`); nothing is committed.
 * The transport is created once and reused — one pooled socket, not one
 * connection per email.
 *
 * Failure semantics: a rejected recipient or a 4xx SMTP reply is a delivery
 * failure the outbox may retry (transient mailbox issues are common); a thrown
 * transport error (auth failure, TLS failure, timeout) is a failure with
 * `smtp_error`, also retried by the outbox policy. The password is never logged.
 */
export class SmtpEmailDeliveryProvider implements EmailDeliveryProvider {
  private readonly logger = new Logger(SmtpEmailDeliveryProvider.name);
  private transport: SmtpTransportClient | undefined;

  constructor(
    private readonly config: SmtpProviderConfig,
    /** Override for tests; in production this is undefined and built lazily. */
    private readonly clientOverride?: SmtpTransportClient,
  ) {}

  async send(input: {
    operationId: string; to: string; subject: string; html: string;
  }): Promise<{ delivered: boolean; providerReference: string | null; errorCode: string | null }> {
    const transport = this.resolveTransport();
    try {
      const info = await transport.sendMail({
        from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
        // A stable reference so bounces/complaints can be correlated back to the
        // notification delivery that produced the send.
        headers: { 'X-SmartCura-Operation-Id': input.operationId },
      });
      this.logger.log(formatSafeLog({
        event: 'email.smtp_delivered',
        operation_id: input.operationId,
        to: input.to,
        subject: input.subject,
        message_id: info.messageId ?? null,
        smtp_response: info.response ?? null,
      }));
      return {
        delivered: true,
        providerReference: info.messageId ?? null,
        errorCode: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(this.config.password, '[redacted]') : String(error);
      // Distinguish permanent config errors (auth, TLS) from transient ones
      // (network, timeout, mailbox full). Auth failures will never succeed on
      // retry, so they get a dedicated code the handler treats as permanent.
      const isAuthError = /(?:authentication|auth|invalid login|535|530|sender not allowed)/i.test(message);
      const errorCode = isAuthError ? 'smtp_auth_error' : 'smtp_error';
      this.logger.error(formatSafeLog({
        event: 'email.smtp_send_error',
        operation_id: input.operationId,
        to: input.to,
        subject: input.subject,
        // Deliberately no credential material: the message may quote auth state,
        // and the SMTP password must never reach a log line.
        error: message,
      }));
      return {
        delivered: false,
        providerReference: null,
        errorCode,
      };
    }
  }

  private resolveTransport(): SmtpTransportClient {
    if (this.clientOverride !== undefined) return this.clientOverride;
    if (this.transport === undefined) {
      this.transport = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: { user: this.config.user, pass: this.config.password },
        // Connection pooling: one reusable pool instead of a socket per email.
        pool: true,
        maxConnections: 5,
        // Timeout hardening so a hung SMTP server does not stall the worker.
        connectionTimeout: 10_000,
        socketTimeout: 30_000,
        greetingTimeout: 10_000,
        // STARTTLS enforcement for port 587 (secure === false). When secure is
        // true (port 465, implicit TLS) requireTLS is irrelevant — the
        // connection is already encrypted.
        requireTLS: this.config.secure === false,
      }) as unknown as SmtpTransportClient;
      this.verify().catch(() => {/* logged inside verify */});
    }
    return this.transport;
  }

  /**
   * Probes the SMTP server with a NOOP-style verify. Logs success or a warning
   * on failure but never throws — the worker must still boot even if the SMTP
   * server is temporarily unreachable, so that other channels (push, in-app)
   * remain operational.
   */
  async verify(): Promise<void> {
    if (this.clientOverride !== undefined) return;
    const transport = this.resolveTransport() as unknown as { verify(): Promise<true> };
    try {
      await transport.verify();
      this.logger.log(formatSafeLog({
        event: 'email.smtp_verify_ok',
        host: this.config.host,
        port: this.config.port,
      }));
    } catch (error) {
      this.logger.warn(formatSafeLog({
        event: 'email.smtp_verify_failed',
        host: this.config.host,
        port: this.config.port,
        error: error instanceof Error ? error.message.replace(this.config.password, '[redacted]') : String(error),
      }));
    }
  }
}
