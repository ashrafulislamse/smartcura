import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeterministicEmailDeliveryProvider,
  NotificationEmailHandler,
  type EmailDeliveryProvider,
} from '../apps/worker/src/notification-email.handler.js';
import {
  renderAppointmentReminder,
  renderVerificationResult,
  renderPasswordReset,
  renderPharmacyOrderUpdate,
  renderEmail,
  escapeHtml,
  VERIFICATION_STATUSES,
  PHARMACY_ORDER_STATUSES,
} from '../apps/worker/src/email-templates.js';
import { loadWorkerConfig } from '../apps/worker/src/config.js';
import {
  NOTIFICATION_EMAIL_REQUESTED_EVENT_TYPE,
  NOTIFICATION_EMAIL_REQUESTED_EVENT_VERSION,
} from '@smartcura/database/consultations';

const deliveryId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e01';
const profileId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e02';
const notificationId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e03';

const recipient = { displayName: 'Aisha Rahman', email: 'aisha@example.test' };

// ---------------------------------------------------------------------------
// Deterministic email provider
// ---------------------------------------------------------------------------

test('deterministic email provider logs and reports success with a stable reference', async () => {
  const provider = new DeterministicEmailDeliveryProvider();
  const result = await provider.send({
    operationId: deliveryId, to: recipient.email,
    subject: 'Test subject', html: '<p>body</p>',
  });
  assert.equal(result.delivered, true);
  assert.equal(result.providerReference, `deterministic:${deliveryId}`);
  assert.equal(result.errorCode, null);
});

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

test('appointment reminder template produces a dated subject and escapes names', () => {
  const rendered = renderAppointmentReminder({
    kind: 'appointment_reminder', recipient,
    doctorName: 'Dr. Lee <admin>', clinicName: 'Klinik Sehat',
    date: '2026-08-15', time: '09:30 MYT', mode: 'In-person',
  });
  assert.match(rendered.subject, /Appointment reminder — 2026-08-15 at 09:30 MYT/);
  // The HTML-injection attempt in the doctor name is escaped, not interpreted.
  assert.equal(rendered.html.includes('Dr. Lee <admin>'), false);
  assert.match(rendered.html, /Dr\. Lee &lt;admin&gt;/);
  assert.match(rendered.html, /Aisha Rahman/);
});

test('verification result template distinguishes approved and rejected outcomes', () => {
  const approved = renderVerificationResult({
    kind: 'verification_result', recipient, status: 'approved',
    documentType: 'Medical license', reason: null,
  });
  assert.match(approved.subject, /approved/);
  assert.equal(approved.html.includes('Reviewer note'), false);

  const rejected = renderVerificationResult({
    kind: 'verification_result', recipient, status: 'rejected',
    documentType: 'Medical license', reason: 'Photo is illegible',
  });
  assert.match(rejected.subject, /rejected/);
  assert.match(rejected.html, /Reviewer note:.*Photo is illegible/);

  const changes = renderVerificationResult({
    kind: 'verification_result', recipient, status: 'changes_requested',
    documentType: 'National ID', reason: 'Re-upload a clearer scan',
  });
  assert.match(changes.subject, /returned for changes/);
  assert.match(changes.html, /Re-upload a clearer scan/);
});

test('password reset template carries the reset link and expiry, never as authority', () => {
  const link = 'https://portal.smartcura.app/reset?token=abc';
  const rendered = renderPasswordReset({
    kind: 'password_reset', recipient, resetLink: link, expiry: '30 minutes',
  });
  assert.match(rendered.subject, /Reset your SmartCura password/);
  assert.match(rendered.html, /href="https:\/\/portal\.smartcura\.app\/reset\?token=abc"/);
  assert.match(rendered.html, /expires in 30 minutes/);
});

test('pharmacy order update template surfaces order id, status and items summary', () => {
  const rendered = renderPharmacyOrderUpdate({
    kind: 'pharmacy_order_update', recipient,
    orderId: 'PHARM-123', status: 'ready_for_dispatch', itemsSummary: '3 items',
  });
  assert.match(rendered.subject, /PHARM-123 — ready for dispatch/);
  assert.match(rendered.html, /PHARM-123/);
  assert.match(rendered.html, /3 items/);
});

test('renderEmail dispatches every template kind and an unknown kind is a type error', () => {
  // The discriminated union means this compiles only for known kinds; the test
  // asserts the dispatch reaches each renderer. A future kind without a case is a
  // compile error, which is the guard against an empty-body email.
  assert.match(
    renderEmail({ kind: 'appointment_reminder', recipient, doctorName: 'Dr. X', clinicName: 'C',
      date: '2026-01-01', time: '10:00', mode: 'video' }).subject,
    /Appointment reminder/,
  );
  assert.match(
    renderEmail({ kind: 'verification_result', recipient, status: 'approved',
      documentType: 'Licence', reason: null }).subject,
    /approved/,
  );
  assert.match(
    renderEmail({ kind: 'password_reset', recipient, resetLink: 'https://x/reset',
      expiry: '15 minutes' }).subject,
    /Reset your SmartCura password/,
  );
  assert.match(
    renderEmail({ kind: 'pharmacy_order_update', recipient, orderId: 'O1',
      status: 'delivered', itemsSummary: '1 item' }).subject,
    /O1 — delivered/,
  );
});

test('escapeHtml neutralises all five HTML-significant characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('verification and pharmacy order vocabularies are frozen catalogues, not retyped', () => {
  // The real vocabularies are frozen in pg_enum; these arrays must match them so an
  // invented status cannot compile into a template. `approved` and `dispatched` are
  // the values the templates branch on; `pending` and `dispatching` (the trap names)
  // must NOT appear as accepted statuses.
  assert.ok(VERIFICATION_STATUSES.includes('approved'));
  assert.ok(VERIFICATION_STATUSES.includes('rejected'));
  assert.ok(VERIFICATION_STATUSES.includes('changes_requested'));
  assert.equal(VERIFICATION_STATUSES.includes('pending' as never), false);
  assert.equal(VERIFICATION_STATUSES.includes('not_required' as never), false);
  assert.ok(PHARMACY_ORDER_STATUSES.includes('dispatched'));
  assert.ok(PHARMACY_ORDER_STATUSES.includes('delivered'));
  assert.equal(PHARMACY_ORDER_STATUSES.includes('dispatching' as never), false);
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

test('email handler resolves the recipient address, sends, and settles terminal delivery idempotently', async () => {
  const sent: unknown[] = [];
  const settlements: unknown[] = [];
  const work = {
    deliveryId, notificationId, profileId, category: 'delivery' as const,
    resourceType: 'pharmacy_order', resourceId: 'PHARM-123',
    titleCode: 'pharmacy.order.ready.title', bodyCode: 'pharmacy.order.ready.body',
    createdAt: new Date('2026-08-15T01:00:00.000Z'),
    status: 'queued' as const, email: 'aisha@example.test', displayName: 'Aisha Rahman',
  };
  const repository = {
    loadEmailWork: async () => work,
    settleEmail: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
  };
  const provider: EmailDeliveryProvider = {
    send: async (input) => {
      sent.push(input);
      return { delivered: true, providerReference: 'mock:1', errorCode: null };
    },
  };
  const handler = new NotificationEmailHandler(repository as never, provider);
  assert.equal(await handler.handle(deliveryId), true);
  // The provider received the resolved address and a non-empty subject/html.
  assert.equal((sent[0] as { to: string }).to, 'aisha@example.test');
  assert.ok(((sent[0] as { subject: string }).subject).length > 0);
  assert.ok(((sent[0] as { html: string }).html).length > 0);
  assert.equal((settlements[0] as { delivered: boolean }).delivered, true);
});

test('email handler settles a missing recipient as a failed delivery without sending', async () => {
  const sent: unknown[] = [];
  const settlements: unknown[] = [];
  const repository = {
    loadEmailWork: async () => ({
      ...{
        deliveryId, notificationId, profileId, category: 'appointments' as const,
        resourceType: 'appointment', resourceId: 'apt-1',
        titleCode: 'appointment.reminder.title', bodyCode: 'appointment.reminder.body',
        createdAt: new Date('2026-08-15T01:00:00.000Z'),
        status: 'queued' as const,
      },
      email: '', displayName: 'Aisha Rahman',
    }),
    settleEmail: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
  };
  const provider: EmailDeliveryProvider = {
    send: async (input) => { sent.push(input); return { delivered: true, providerReference: 'x', errorCode: null }; },
  };
  const handler = new NotificationEmailHandler(repository as never, provider);
  assert.equal(await handler.handle(deliveryId), true);
  assert.equal(sent.length, 0);
  assert.equal((settlements[0] as { errorCode: string | null }).errorCode, 'empty_recipient');
  assert.equal((settlements[0] as { delivered: boolean }).delivered, false);
});

test('email handler skips an already-terminal delivery without sending', async () => {
  const sent: unknown[] = [];
  const repository = {
    loadEmailWork: async () => ({
      deliveryId, notificationId, profileId, category: 'appointments' as const,
      resourceType: 'appointment', resourceId: 'apt-1',
      titleCode: 'appointment.reminder.title', bodyCode: 'appointment.reminder.body',
      createdAt: new Date('2026-08-15T01:00:00.000Z'),
      status: 'delivered' as const, email: 'aisha@example.test', displayName: 'Aisha Rahman',
    }),
    settleEmail: async () => 'terminal' as const,
  };
  const provider: EmailDeliveryProvider = {
    send: async (input) => { sent.push(input); return { delivered: true, providerReference: 'x', errorCode: null }; },
  };
  const handler = new NotificationEmailHandler(repository as never, provider);
  assert.equal(await handler.handle(deliveryId), true);
  assert.equal(sent.length, 0);
});

test('email handler retries a transient smtp_error without settling', async () => {
  const settlements: unknown[] = [];
  const work = {
    deliveryId, notificationId, profileId, category: 'appointments' as const,
    resourceType: 'appointment', resourceId: 'apt-1',
    titleCode: 'appointment.reminder.title', bodyCode: 'appointment.reminder.body',
    createdAt: new Date('2026-08-15T01:00:00.000Z'),
    status: 'queued' as const, email: 'aisha@example.test', displayName: 'Aisha Rahman',
  };
  const repository = {
    loadEmailWork: async () => work,
    settleEmail: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
  };
  const provider: EmailDeliveryProvider = {
    send: async () => ({ delivered: false, providerReference: null, errorCode: 'smtp_error' }),
  };
  const handler = new NotificationEmailHandler(repository as never, provider);
  // smtp_error is transient: return false, no settlement — the outbox retries.
  assert.equal(await handler.handle(deliveryId), false);
  assert.equal(settlements.length, 0);
});

test('email handler settles a permanent invalid_email failure and returns true', async () => {
  const settlements: unknown[] = [];
  const work = {
    deliveryId, notificationId, profileId, category: 'appointments' as const,
    resourceType: 'appointment', resourceId: 'apt-1',
    titleCode: 'appointment.reminder.title', bodyCode: 'appointment.reminder.body',
    createdAt: new Date('2026-08-15T01:00:00.000Z'),
    status: 'queued' as const, email: 'aisha@example.test', displayName: 'Aisha Rahman',
  };
  const repository = {
    loadEmailWork: async () => work,
    settleEmail: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
  };
  const provider: EmailDeliveryProvider = {
    send: async () => ({ delivered: false, providerReference: null, errorCode: 'invalid_email' }),
  };
  const handler = new NotificationEmailHandler(repository as never, provider);
  // invalid_email is permanent: settle as failed, return true.
  assert.equal(await handler.handle(deliveryId), true);
  assert.equal((settlements[0] as { delivered: boolean }).delivered, false);
  assert.equal((settlements[0] as { errorCode: string | null }).errorCode, 'invalid_email');
});

// ---------------------------------------------------------------------------
// Config / provider selection
// ---------------------------------------------------------------------------

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/smartcura',
};

test('email provider defaults to deterministic and exposes no cloudflare credentials', () => {
  const config = loadWorkerConfig({ ...baseEnv });
  assert.equal(config.emailProvider, 'deterministic');
  assert.equal(config.cloudflareEmail, undefined);
});

test('cloudflare email credentials are parsed only when all three are present', () => {
  const partial = loadWorkerConfig({
    ...baseEnv,
    SMARTCURA_EMAIL_PROVIDER: 'cloudflare',
    CLOUDFLARE_API_TOKEN: 'tok',
    CLOUDFLARE_EMAIL_DOMAIN: 'smartcura.app',
  });
  assert.equal(partial.cloudflareEmail, undefined,
    'a missing CLOUDFLARE_ACCOUNT_ID must leave cloudflareEmail undefined');

  const full = loadWorkerConfig({
    ...baseEnv,
    SMARTCURA_EMAIL_PROVIDER: 'cloudflare',
    CLOUDFLARE_API_TOKEN: 'tok',
    CLOUDFLARE_ACCOUNT_ID: 'acc',
    CLOUDFLARE_EMAIL_DOMAIN: 'smartcura.app',
  });
  assert.notEqual(full.cloudflareEmail, undefined);
  assert.equal(full.cloudflareEmail!.apiToken, 'tok');
  assert.equal(full.cloudflareEmail!.accountId, 'acc');
  assert.equal(full.cloudflareEmail!.fromDomain, 'smartcura.app');
});

test('notification email-requested event type and version are the frozen contract values', () => {
  assert.equal(NOTIFICATION_EMAIL_REQUESTED_EVENT_TYPE, 'notification.email-requested.v1');
  assert.equal(NOTIFICATION_EMAIL_REQUESTED_EVENT_VERSION, 1);
});
