import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consentStatus,
  serializeConsentGrant,
  type ConsentGrantRecord,
} from '../packages/database/src/care-access-repository.js';
import { evaluatePermission } from '../packages/policy/src/permission-policy.js';
import {
  createCareAssignmentSchema,
  createConsentGrantSchema,
  endCareAssignmentSchema,
  revokeConsentGrantSchema,
} from '../apps/api/src/care-access/care-access-request.schemas.js';

const patient = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10';
const grantee = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11';
const clinician = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d12';

test('consent creation requires exactly one valid grantee and rejects unknown fields', () => {
  assert.equal(createConsentGrantSchema.safeParse({
    grantee_profile_id: grantee,
    scope: 'clinical_record',
    purpose: 'ongoing_care',
    expires_at: null,
  }).success, true);
  assert.equal(createConsentGrantSchema.safeParse({
    grantee_profile_id: grantee,
    grantee_membership_id: clinician,
    scope: 'clinical_record',
    purpose: 'ongoing_care',
  }).success, false);
  assert.equal(createConsentGrantSchema.safeParse({
    scope: 'clinical_record', purpose: 'ongoing_care', extra: true,
  }).success, false);
});

test('consent and assignment commands accept only structured transitions', () => {
  assert.equal(revokeConsentGrantSchema.safeParse({
    expected_version: 0, reason: 'grantor_request',
  }).success, true);
  assert.equal(revokeConsentGrantSchema.safeParse({
    expected_version: 0, reason: 'because patient has diagnosis X',
  }).success, false);
  assert.equal(createCareAssignmentSchema.safeParse({
    clinician_membership_id: clinician, patient_profile_id: patient,
  }).success, true);
  assert.equal(endCareAssignmentSchema.safeParse({
    expected_version: 2, status: 'revoked', reason: 'patient_request',
  }).success, true);
  assert.equal(endCareAssignmentSchema.safeParse({
    expected_version: 2, status: 'active', reason: 'patient_request',
  }).success, false);
  assert.equal(endCareAssignmentSchema.safeParse({
    expected_version: 2, status: 'completed', reason: 'patient_request',
  }).success, false);
  assert.equal(endCareAssignmentSchema.safeParse({
    expected_version: 2, status: 'completed', reason: 'care_completed',
  }).success, true);
});

test('care-access permissions preserve own, assigned, organization and global boundaries', () => {
  assert.equal(evaluatePermission(
    ['care.assignment:read:own'], 'care.assignment:read:own',
    { actorProfileId: patient, ownerProfileId: patient },
  ).allowed, true);
  assert.equal(evaluatePermission(
    ['care.assignment:read:own'], 'care.assignment:read:own',
    { actorProfileId: patient, ownerProfileId: grantee },
  ).allowed, false);
  assert.equal(evaluatePermission(
    ['care.assignment:read:assigned'], 'care.assignment:read:assigned',
    { actorProfileId: clinician, assigned: true },
  ).allowed, true);
  assert.equal(evaluatePermission(
    ['care.assignment:read:assigned'], 'care.assignment:read:assigned',
    { actorProfileId: clinician, assigned: false },
  ).allowed, false);
  assert.equal(evaluatePermission(
    ['care.assignment:create:organization'], 'care.assignment:create:organization',
    { actorProfileId: clinician, resourceOrganizationId: patient,
      membershipOrganizationId: grantee },
  ).allowed, false);
  assert.equal(evaluatePermission(
    ['care.assignment:create:global'], 'care.assignment:create:global',
    { actorProfileId: clinician, globalAllowed: false },
  ).allowed, false);
});

test('consent status and representation are deterministic at the expiry boundary', () => {
  const now = new Date('2026-07-29T00:00:00.000Z');
  const record: ConsentGrantRecord = {
    consentId: patient, organizationId: grantee, grantorProfileId: patient,
    granteeProfileId: null, granteeMembershipId: clinician,
    scope: 'iot_reading', purpose: 'remote_monitoring',
    grantedAt: new Date('2026-07-28T00:00:00.000Z'), expiresAt: now,
    revokedAt: null, revocationReason: null, version: 0,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
  };
  assert.equal(consentStatus(record, new Date(now.getTime() - 1)), 'active');
  assert.equal(consentStatus(record, now), 'expired');
  assert.equal(serializeConsentGrant(record, now).status, 'expired');
});


import {
  CARE_ASSIGNMENT_CHANGED_EVENT_TYPE,
  CONSENT_CHANGED_EVENT_TYPE,
} from '../packages/database/src/care-access-events.js';
import { OutboxProcessor } from '../apps/worker/src/outbox.processor.js';

test('worker accepts exact care-access events and rejects extra or invalid fields', async () => {
  const worker = new OutboxProcessor();
  assert.equal(await worker.process({
    eventId: patient, eventType: CONSENT_CHANGED_EVENT_TYPE, eventVersion: 1, attempts: 1,
    payload: { consent_id: patient, grantor_profile_id: grantee,
      scope: 'clinical_record', status: 'active' },
  }), true);
  assert.equal(await worker.process({
    eventId: patient, eventType: CARE_ASSIGNMENT_CHANGED_EVENT_TYPE, eventVersion: 1, attempts: 1,
    payload: { assignment_id: patient, patient_profile_id: grantee,
      clinician_membership_id: clinician, status: 'active' },
  }), true);
  assert.equal(await worker.process({
    eventId: patient, eventType: CONSENT_CHANGED_EVENT_TYPE, eventVersion: 1, attempts: 1,
    payload: { consent_id: patient, grantor_profile_id: grantee,
      scope: 'clinical_record', status: 'active', clinical_detail: 'must not fan out' },
  }), false);
  assert.equal(await worker.process({
    eventId: patient, eventType: CARE_ASSIGNMENT_CHANGED_EVENT_TYPE, eventVersion: 2, attempts: 1,
    payload: { assignment_id: patient, patient_profile_id: grantee,
      clinician_membership_id: clinician, status: 'active' },
  }), false);
});
