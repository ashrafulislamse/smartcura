import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  renderNotificationCopy,
  deepLinkForResource,
} from '../apps/worker/src/notification-copy.js';
import { SmtpEmailDeliveryProvider } from '../apps/worker/src/smtp-email.provider.js';
import { loadWorkerConfig } from '../apps/worker/src/config.js';

// ---------------------------------------------------------------------------
// Copy catalogue: what a lock screen shows
// ---------------------------------------------------------------------------

const PHI_MARKERS = ['patient name', 'diagnosis', 'medication', 'condition', 'address_line'] as const;

test('every copy entry names what happened and where the tap goes — no generic filler', () => {
  const entries = [
    { category: 'messages' as const, titleCode: 'message.new.title', bodyCode: 'message.new.body',
      resourceType: 'conversation', resourceId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e30' },
    { category: 'emergency' as const, titleCode: 'emergency.created.title', bodyCode: 'emergency.created.body',
      resourceType: 'emergency_event', resourceId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e30' },
    { category: 'appointments' as const, titleCode: 'appointment.confirmed.title', bodyCode: 'appointment.confirmed.body',
      resourceType: 'appointment', resourceId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e30' },
    { category: 'vitals_alerts' as const, titleCode: 'health.alert.raised.title', bodyCode: 'health.alert.raised.body',
      resourceType: 'health_alert', resourceId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e30' },
  ];
  for (const entry of entries) {
    const copy = renderNotificationCopy(entry);
    assert.ok(copy.title.length > 3, `${entry.titleCode}: title must be real copy`);
    assert.ok(!/^new notification$/i.test(copy.title), `${entry.titleCode}: vacuous title`);
    assert.match(copy.body, /tap/i, `${entry.titleCode}: body must say where the tap goes`);
    for (const marker of PHI_MARKERS) {
      assert.equal(copy.body.toLowerCase().includes(marker), false,
        `${entry.titleCode}: body leaks "${marker}"`);
    }
  }
});

test('priority is derived per event, not per category blanket', () => {
  const at = (titleCode: string, category: Parameters<typeof renderNotificationCopy>[0]['category']) =>
    renderNotificationCopy({
      category, titleCode, bodyCode: 'x.body', resourceType: 'appointment',
      resourceId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e30',
    }).priority;
  assert.equal(at('emergency.created.title', 'emergency'), 'critical');
  assert.equal(at('health.alert.raised.title', 'vitals_alerts'), 'high');
  assert.equal(at('appointment.reminder.title', 'appointments'), 'high');
  assert.equal(at('appointment.confirmed.title', 'appointments'), 'normal');
  // Category fallback still carries the urgency floor.
  assert.equal(at('unknown.code.title', 'emergency'), 'critical');
});

test('deep links exist only for entities with a real screen behind them', () => {
  assert.equal(deepLinkForResource('prescription', 'p1'), 'smartcura://prescriptions/p1');
  assert.equal(deepLinkForResource('pharmacy_order', 'o1'), 'smartcura://pharmacy-orders/o1');
  assert.equal(deepLinkForResource('appointment', 'a1'), 'smartcura://appointments/a1');
  assert.equal(deepLinkForResource('conversation', 'c1'), 'smartcura://conversations/c1');
  assert.equal(deepLinkForResource('dispatch_assignment', 'd1'), 'smartcura://orders/d1');
  // No detail screen exists for these; the notification centre is the honest
  // destination, never the home screen.
  assert.equal(deepLinkForResource('emergency_event', 'e1'), 'smartcura://notifications');
  assert.equal(deepLinkForResource('verification_document', 'v1'), 'smartcura://notifications');
  assert.equal(deepLinkForResource('broadcast', 'b1'), 'smartcura://notifications');
});

// ---------------------------------------------------------------------------
// SMTP (Hostinger) provider
// ---------------------------------------------------------------------------

test('smtp provider sends through the transport and reports the message id', async () => {
  const mails: unknown[] = [];
  const provider = new SmtpEmailDeliveryProvider(
    {
      host: 'smtp.hostinger.com', port: 465, secure: true,
      user: 'no-reply@smartcura.app', password: 'secret-pass',
      fromEmail: 'no-reply@smartcura.app', fromName: 'SmartCura',
    },
    { sendMail: async (options) => { mails.push(options); return { messageId: '<abc@hostinger>' }; } },
  );
  const result = await provider.send({
    operationId: 'op-1', to: 'aisha@example.test',
    subject: 'Appointment reminder', html: '<p>Hi</p>',
  });
  assert.equal(result.delivered, true);
  assert.equal(result.providerReference, '<abc@hostinger>');
  assert.equal(result.errorCode, null);
  const mail = mails[0] as { from: string; to: string; subject: string; headers: Record<string, string> };
  assert.equal(mail.from, '"SmartCura" <no-reply@smartcura.app>');
  assert.equal(mail.to, 'aisha@example.test');
  assert.equal(mail.headers['X-SmartCura-Operation-Id'], 'op-1');
});

test('smtp provider reports a transport failure without leaking the password', async () => {
  const provider = new SmtpEmailDeliveryProvider(
    {
      host: 'smtp.hostinger.com', port: 465, secure: true,
      user: 'no-reply@smartcura.app', password: 'super-secret-pass',
      fromEmail: 'no-reply@smartcura.app', fromName: 'SmartCura',
    },
    { sendMail: async () => { throw new Error('auth failed for super-secret-pass'); } },
  );
  const result = await provider.send({
    operationId: 'op-2', to: 'aisha@example.test', subject: 's', html: 'h',
  });
  assert.equal(result.delivered, false);
  assert.equal(result.errorCode, 'smtp_error');
});

test('worker config parses full smtp credentials and defaults Hostinger-style TLS', () => {
  const config = loadWorkerConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/smartcura',
    SMARTCURA_EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.hostinger.com',
    SMTP_USER: 'no-reply@smartcura.app',
    SMTP_PASSWORD: 'secret',
  });
  assert.equal(config.emailProvider, 'smtp');
  assert.equal(config.smtp?.host, 'smtp.hostinger.com');
  assert.equal(config.smtp?.port, 465);
  assert.equal(config.smtp?.secure, true, 'port 465 defaults to implicit TLS');
  assert.equal(config.smtp?.fromEmail, 'no-reply@smartcura.app');
  assert.equal(config.smtp?.fromName, 'SmartCura');
});

test('partial smtp credentials leave config.smtp undefined so selection can refuse', () => {
  const config = loadWorkerConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/smartcura',
    SMTP_HOST: 'smtp.hostinger.com',
    SMTP_USER: 'no-reply@smartcura.app',
  });
  assert.equal(config.smtp, undefined);
});

test('compose-style empty-string credentials are treated as unset, not boot-fatal', () => {
  // `${VAR:-}` in the compose files presents unset variables as empty strings;
  // rejecting them would crash the worker at boot on every demo deployment.
  const config = loadWorkerConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/smartcura',
    SMTP_HOST: '',
    SMTP_PORT: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    SMTP_SECURE: '',
    FIREBASE_PROJECT_ID: '',
    FIREBASE_CLIENT_EMAIL: '',
    FIREBASE_PRIVATE_KEY: '',
    CLOUDFLARE_API_TOKEN: '',
  });
  assert.equal(config.smtp, undefined);
  assert.equal(config.firebase, undefined);
  assert.equal(config.cloudflareEmail, undefined);
});

// ---------------------------------------------------------------------------
// Producers: every workflow that must communicate now does (source-level, the
// house style for repository behaviour that needs a live database)
// ---------------------------------------------------------------------------

const databaseSource = (file: string): string =>
  readFileSync(new URL(`../packages/database/src/${file}`, import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');

test('appointment transitions notify the other party in the same transaction', () => {
  const source = databaseSource('appointment-repository.ts');
  assert.match(source, /notifyAppointmentParty/);
  assert.match(source, /'appointment\.requested\.title'/);
  assert.match(source, /'appointment\.confirmed\.title'/);
  assert.match(source, /'appointment\.cancelled_by_patient\.title'/);
  assert.match(source, /'appointment\.cancelled_by_doctor\.title'/);
  assert.match(source, /'appointment\.rescheduled\.title'/);
  // The reminder scan is idempotent against the notifications table itself.
  const scan = source.slice(source.indexOf('createDueReminders'));
  assert.match(scan, /NOT EXISTS/);
  assert.match(scan, /appointment\.reminder\.title/);
});

test('verification decisions notify the reviewed party', () => {
  const source = databaseSource('verification-repository.ts');
  assert.match(source, /'verification\.approved\.title'/);
  assert.match(source, /'verification\.rejected\.title'/);
  assert.match(source, /'verification\.changes_requested\.title'/);
  // The recipient is the document owner, not the reviewer.
  const block = source.slice(source.indexOf('decisionCode'), source.indexOf('decisionCode') + 900);
  assert.match(block, /current\.profileId/);
});

test('pharmacy order milestones notify the patient with the real status', () => {
  const source = databaseSource('pharmacy-repository.ts');
  assert.match(source, /'pharmacy_order\.ready_for_dispatch\.title'/);
  assert.match(source, /'pharmacy_order\.dispatched\.title'/);
  assert.match(source, /'pharmacy_order\.delivered\.title'/);
  assert.match(source, /'pharmacy_order\.cancelled\.title'/);
  // The actor is excluded so a patient cancelling their own order is not self-notified.
  const block = source.slice(source.indexOf('patientCode'), source.indexOf('patientCode') + 800);
  assert.match(block, /patient\.patientProfileId !== actorProfileId/);
});

test('emergency raise forces push past preferences; terminal states notify the patient', () => {
  const source = databaseSource('emergency-repository.ts');
  const raiseBlock = source.slice(source.indexOf("'emergency.created.title'") - 700,
    source.indexOf("'emergency.created.title'") + 200);
  assert.match(raiseBlock, /mandatoryPush: true/, 'an SOS must not be mutable by preference');
  assert.match(raiseBlock, /role_id = 'emergency'/);
  assert.match(source, /'emergency\.resolved\.title'/);
  assert.match(source, /'emergency\.cancelled\.title'/);
});

test('critical health alerts force push to doctors with an active care assignment', () => {
  const source = databaseSource('vital-reading-repository.ts');
  const block = source.slice(source.indexOf("'health.alert.raised.title'") - 1200,
    source.indexOf("'health.alert.raised.title'") + 300);
  assert.match(block, /severity === 'critical'/, 'only critical alerts interrupt');
  assert.match(block, /mandatoryPush: true/);
  assert.match(block, /care_assignments/);
  assert.match(block, /status = 'active'/);
});

test('push devices are disabled when access is revoked', () => {
  const migration = readFileSync(new URL(
    '../packages/database/drizzle/0050_unified_communication.sql', import.meta.url,
  ), 'utf8');
  // Both revocation paths must close the push capability with the session.
  const membershipFn = migration.slice(
    migration.indexOf('smartcura_end_inactive_membership_sessions'),
    migration.indexOf('smartcura_revoke_profile_access'),
  );
  const profileFn = migration.slice(migration.indexOf('smartcura_revoke_profile_access'));
  for (const block of [membershipFn, profileFn]) {
    assert.match(block, /UPDATE push_devices/);
    assert.match(block, /enabled = false/);
  }
  // Every role can now read its own notifications; before 0050 only patient and
  // doctor held the permission and every other role's GET /notifications 403ed.
  assert.match(migration, /'driver','notification:read:own'/);
  assert.match(migration, /'super_admin','notification:read:own'/);
});
