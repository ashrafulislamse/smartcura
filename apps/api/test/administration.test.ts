import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type {
  BroadcastRecord, CustomRoleRecord, FaqRecord, TemplateRecord, TemplateVersionRecord,
} from '@smartcura/database/stage11';
import {
  broadcastResponse, customRoleResponse, faqResponse, templateResponse, templateVersionResponse,
} from '../apps/api/src/administration/stage11.service.js';
import {
  activateTemplateVersionSchema,
  archiveFaqSchema,
  assignCustomRoleSchema,
  createBroadcastSchema,
  createCustomRoleSchema,
  createFaqSchema,
  createTemplateSchema,
  listFaqsSchema,
  replayDeadLetterSchema,
  replaceCustomRolePermissionsSchema,
  scheduleBroadcastSchema,
  setFaqStateSchema,
  updateCustomRoleSchema,
  updateFaqSchema,
  updateMaintenanceSchema,
} from '../apps/api/src/administration/stage11-request.schemas.js';

/**
 * Stage 11 administration: content, custom roles, maintenance and dead-letter replay.
 *
 * These are the request/response boundaries a portal actually calls. The rules
 * asserted here are the ones that cannot be re-checked by the database, because a
 * malformed request must be refused before it ever reaches SQL.
 */

const ID = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d80';
const AT = new Date('2026-07-31T08:00:00.000Z');

test('FAQ listing defaults to the full administrative view, not the published subset', () => {
  // Defaulting to published-only would silently hide drafts from the editor who
  // just created them.
  assert.deepEqual(listFaqsSchema.parse({}), { published_only: 'false' });
  assert.equal(listFaqsSchema.parse({ published_only: 'true' }).published_only, 'true');
  assert.equal(listFaqsSchema.safeParse({ published_only: 'yes' }).success, false);
  assert.equal(listFaqsSchema.safeParse({ published_only: 'false', extra: 1 }).success, false);
});

test('FAQ slugs are restricted to a stable URL shape', () => {
  const body = { question: 'How do I book?', answer: 'Open the appointments tab.' };
  assert.equal(createFaqSchema.safeParse({ ...body, slug: 'how-to-book' }).success, true);
  for (const slug of ['How-To-Book', 'how_to_book', '-leading', 'trailing-', 'double--dash', '']) {
    assert.equal(createFaqSchema.safeParse({ ...body, slug }).success, false, `accepted slug: ${slug}`);
  }
  // Unknown keys are refused so a client cannot smuggle a field the service ignores.
  assert.equal(createFaqSchema.safeParse({ ...body, slug: 'ok', publish_state: 'published' }).success, false);
});

test('every FAQ mutation carries an expected version so concurrent edits cannot be lost', () => {
  const base = { slug: 'ok', question: 'Q', answer: 'A' };
  assert.equal(updateFaqSchema.safeParse(base).success, false);
  assert.equal(updateFaqSchema.safeParse({ ...base, expected_version: 0 }).success, true);
  assert.equal(updateFaqSchema.safeParse({ ...base, expected_version: -1 }).success, false);
  assert.equal(updateFaqSchema.safeParse({ ...base, expected_version: 1.5 }).success, false);
  assert.equal(archiveFaqSchema.safeParse({}).success, false);
  assert.equal(archiveFaqSchema.safeParse({ expected_version: 3 }).success, true);
});

test('the publish-state endpoint cannot be used to archive', () => {
  // Archiving is a separate, deliberate action; allowing it here would let a
  // routine publish toggle destroy the published history.
  assert.equal(setFaqStateSchema.safeParse({ publish_state: 'published', expected_version: 1 }).success, true);
  assert.equal(setFaqStateSchema.safeParse({ publish_state: 'draft', expected_version: 1 }).success, true);
  assert.equal(setFaqStateSchema.safeParse({ publish_state: 'archived', expected_version: 1 }).success, false);
});

test('notification templates are keyed and categorised from a closed vocabulary', () => {
  const body = { title_template: 'Hello', body_template: 'Body' };
  assert.equal(createTemplateSchema.safeParse({
    ...body, template_key: 'appointment.reminder', category: 'appointments',
  }).success, true);
  assert.equal(createTemplateSchema.safeParse({
    ...body, template_key: 'appointment.reminder', category: 'marketing',
  }).success, false);
  assert.equal(createTemplateSchema.safeParse({
    ...body, template_key: 'Appointment.Reminder', category: 'appointments',
  }).success, false);
  // Template versions start at 1, so activating version 0 is meaningless.
  assert.equal(activateTemplateVersionSchema.safeParse({ version: 1 }).success, true);
  assert.equal(activateTemplateVersionSchema.safeParse({ version: 0 }).success, false);
});

test('a broadcast is bound to one immutable template version and a known audience', () => {
  const body = { template_key: 'system.notice', template_version: 2 };
  assert.equal(createBroadcastSchema.safeParse({ ...body, audience: 'patients' }).success, true);
  assert.equal(createBroadcastSchema.safeParse({ ...body, audience: 'everyone' }).success, false);
  // Pinning a version is what stops an edit to the template rewriting a message
  // that has already been sent.
  assert.equal(createBroadcastSchema.safeParse({ template_key: 'system.notice', audience: 'all' }).success, false);
});

test('broadcast scheduling requires an offset-qualified timestamp', () => {
  // A bare local timestamp would be interpreted differently by server and client.
  assert.equal(scheduleBroadcastSchema.safeParse({
    scheduled_at: '2026-08-01T09:00:00.000Z', expected_version: 0,
  }).success, true);
  assert.equal(scheduleBroadcastSchema.safeParse({
    scheduled_at: '2026-08-01 09:00:00', expected_version: 0,
  }).success, false);
});

test('custom roles derive from a system base role only', () => {
  const body = { role_key: 'ward_clerk', display_name: 'Ward Clerk' };
  assert.equal(createCustomRoleSchema.safeParse({ ...body, base_role_id: 'admin' }).success, true);
  assert.equal(createCustomRoleSchema.safeParse({ ...body, base_role_id: 'superuser' }).success, false);
  assert.equal(createCustomRoleSchema.safeParse({ ...body, role_key: 'Ward Clerk', base_role_id: 'admin' }).success, false);
  assert.equal(updateCustomRoleSchema.safeParse({ display_name: 'X', active: false, expected_version: 2 }).success, true);
  assert.equal(updateCustomRoleSchema.safeParse({ display_name: 'X', active: false }).success, false);
});

test('a permission set is replaced as a whole and cannot contain duplicates', () => {
  assert.equal(replaceCustomRolePermissionsSchema.safeParse({
    permission_ids: ['content:manage:organization', 'support.ticket:read:organization'], expected_version: 1,
  }).success, true);
  // A duplicate would make the granted set ambiguous and the count misleading.
  assert.equal(replaceCustomRolePermissionsSchema.safeParse({
    permission_ids: ['content:manage:organization', 'content:manage:organization'], expected_version: 1,
  }).success, false);
  assert.equal(replaceCustomRolePermissionsSchema.safeParse({
    permission_ids: Array.from({ length: 201 }, (_, index) => `permission:${index}:organization`),
    expected_version: 1,
  }).success, false);
  assert.equal(replaceCustomRolePermissionsSchema.safeParse({ permission_ids: [], expected_version: 1 }).success, true);
});

test('assigning a custom role accepts an explicit null to restore the system role', () => {
  assert.equal(assignCustomRoleSchema.safeParse({ custom_role_id: ID, expected_version: 0 }).success, true);
  // Null is the documented way to clear an assignment; omitting the field is not,
  // because that would make "leave unchanged" and "clear" indistinguishable.
  assert.equal(assignCustomRoleSchema.safeParse({ custom_role_id: null, expected_version: 0 }).success, true);
  assert.equal(assignCustomRoleSchema.safeParse({ expected_version: 0 }).success, false);
  assert.equal(assignCustomRoleSchema.safeParse({
    custom_role_id: '018f5f5d-4f7b-4d20-9c8a-7e4b5f7e2d80', expected_version: 0,
  }).success, false, 'accepted a non-v7 UUID');
});

test('disabling maintenance must clear its reason and start time', () => {
  assert.equal(updateMaintenanceSchema.safeParse({
    enabled: true, reason_code: 'database_upgrade',
    starts_at: '2026-08-01T02:00:00.000Z', expected_version: 0,
  }).success, true);
  assert.equal(updateMaintenanceSchema.safeParse({ enabled: false, expected_version: 1 }).success, true);
  // Leaving a stale reason attached to disabled maintenance would surface a
  // banner reason for an outage that is already over.
  assert.equal(updateMaintenanceSchema.safeParse({
    enabled: false, reason_code: 'database_upgrade', expected_version: 1,
  }).success, false);
  assert.equal(updateMaintenanceSchema.safeParse({
    enabled: false, starts_at: '2026-08-01T02:00:00.000Z', expected_version: 1,
  }).success, false);
  assert.deepEqual(updateMaintenanceSchema.parse({ enabled: false, expected_version: 1 }), {
    enabled: false, reason_code: null, starts_at: null, expected_version: 1,
  });
});

test('dead-letter replay demands a machine-readable reason and nothing else', () => {
  // Replay re-triggers real side effects, so the audit trail must always say why.
  assert.equal(replayDeadLetterSchema.safeParse({ reason_code: 'transient_provider_outage' }).success, true);
  assert.equal(replayDeadLetterSchema.safeParse({}).success, false);
  assert.equal(replayDeadLetterSchema.safeParse({ reason_code: 'Because I said so' }).success, false);
  assert.equal(replayDeadLetterSchema.safeParse({
    reason_code: 'transient_provider_outage', force: true,
  }).success, false);
});

test('administration responses expose snake_case wire fields and preserve nulls', () => {
  const faq: FaqRecord = {
    faqEntryId: ID, slug: 'how-to-book', question: 'Q', answer: 'A',
    publishState: 'draft', publishedAt: null, version: 0, updatedAt: AT,
  };
  assert.deepEqual(faqResponse(faq), {
    faq_entry_id: ID, slug: 'how-to-book', question: 'Q', answer: 'A',
    publish_state: 'draft', published_at: null, version: 0,
    updated_at: '2026-07-31T08:00:00.000Z',
  });

  const template: TemplateRecord = {
    notificationTemplateId: ID, templateKey: 'system.notice', category: 'system',
    activeVersion: null, updatedAt: AT,
  };
  // A template with no active version must report null, not 0: version 0 does
  // not exist and a client would render it as a real version.
  assert.equal(templateResponse(template).active_version, null);

  const version: TemplateVersionRecord = {
    notificationTemplateVersionId: ID, version: 3,
    titleTemplate: 'T', bodyTemplate: 'B', createdAt: AT,
  };
  assert.deepEqual(templateVersionResponse(version), {
    notification_template_version_id: ID, version: 3,
    title_template: 'T', body_template: 'B', created_at: '2026-07-31T08:00:00.000Z',
  });

  const broadcast: BroadcastRecord = {
    broadcastMessageId: ID, templateVersionId: ID, audience: 'patients',
    status: 'draft', scheduledAt: null, dispatchedAt: null, version: 0, createdAt: AT,
  };
  const wire = broadcastResponse(broadcast);
  assert.equal(wire.scheduled_at, null);
  assert.equal(wire.dispatched_at, null);
  assert.equal(wire.notification_template_version_id, ID);

  const role: CustomRoleRecord = {
    customRoleId: ID, roleKey: 'ward_clerk', displayName: 'Ward Clerk',
    baseRoleId: 'admin', active: true, permissions: ['content:manage:organization'],
    version: 1, updatedAt: AT,
  };
  assert.deepEqual(customRoleResponse(role).permission_ids, ['content:manage:organization']);
});

test('every privileged administration action is step-up guarded at its call site', () => {
  const source = readFileSync(
    new URL('../apps/api/src/administration/stage11.service.ts', import.meta.url), 'utf8',
  );
  // Each of these can widen access or re-fire side effects, so a stolen session
  // cookie alone must not be enough to invoke them.
  const privileged = [
    'createCustomRole', 'updateCustomRole', 'replaceCustomRolePermissions',
    'assignCustomRole', 'updateMaintenance', 'replayDeadLetter',
  ];
  for (const method of privileged) {
    const start = source.indexOf(`async ${method}(`);
    assert.notEqual(start, -1, `${method} is missing from the service`);
    const body = source.slice(start, source.indexOf('\n  }', start));
    assert.match(body, /this\.requireStepUp\(current\)/,
      `${method} performs a privileged change without requiring step-up`);
  }
});

test('read-only administration queries do not demand step-up', () => {
  const source = readFileSync(
    new URL('../apps/api/src/administration/stage11.service.ts', import.meta.url), 'utf8',
  );
  // Over-guarding reads would push operators toward re-authenticating constantly
  // and train them to approve step-up prompts without reading them.
  for (const method of ['listFaqs', 'listTemplates', 'listBroadcasts', 'listCustomRoles', 'settingVersions']) {
    const start = source.indexOf(`async ${method}(`);
    assert.notEqual(start, -1, `${method} is missing from the service`);
    const body = source.slice(start, source.indexOf('\n  }', start));
    assert.doesNotMatch(body, /this\.requireStepUp\(current\)/, `${method} needlessly requires step-up`);
  }
});
