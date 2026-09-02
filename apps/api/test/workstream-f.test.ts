import test from 'node:test';
import assert from 'node:assert/strict';
import { patientQuerySchema, assignedPatientQuerySchema, verificationQuerySchema, auditQuerySchema } from '../apps/api/src/workstream-f/workstream-f.schemas.js';

test('Workstream F query schemas enforce bounded filters', () => {
  assert.deepEqual(patientQuerySchema.parse({}), { limit: 50 });
  assert.equal(verificationQuerySchema.parse({ status: 'pending_review' }).status, 'pending_review');
  assert.equal(auditQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(patientQuerySchema.safeParse({ extra: true }).success, false);
  assert.deepEqual(assignedPatientQuerySchema.parse({}), { page_size: 25 });
  assert.equal(assignedPatientQuerySchema.safeParse({ page_size: 101 }).success, false);
  assert.equal(assignedPatientQuerySchema.safeParse({ cursor: '' }).success, false);
});
