import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEVICE_RELEASE_REASON_CODES,
  DeviceSimulator,
  PAIRED_VITAL_METRICS,
  SIMULATOR_HARDWARE_PROFILE,
  VITAL_METRIC_BOUNDS,
  VITAL_METRIC_UNITS,
  healthAlertTransitionAllowed,
  readingDrivesAlerts,
  vitalsTopic,
  type SimulatedVitalsPacket,
  type VitalMetricValue,
} from '@smartcura/database/iot';
import {
  transitionHealthAlertSchema,
} from '../apps/api/src/iot/iot-request.schemas.js';
import { evaluatePermission } from '../packages/policy/src/permission-policy.js';
import {
  ownAssignDeviceSchema,
  ownReleaseDeviceSchema,
} from '../apps/api/src/profiles/patient-self-request.schemas.js';

const deviceId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d50';
const membershipId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d51';

test('canonical vital vocabulary matches the frozen catalogue units and paired metrics', () => {
  assert.equal(VITAL_METRIC_UNITS.oxygen_saturation, '%');
  assert.equal(VITAL_METRIC_UNITS.ecg_voltage, 'mV');
  assert.equal(VITAL_METRIC_UNITS.blood_pressure, 'mm[Hg]');
  assert.equal(VITAL_METRIC_UNITS.blood_glucose, 'mg/dL');
  assert.equal(VITAL_METRIC_UNITS.body_weight, 'kg');
  // The retired spellings must be gone, not merely supplemented: two labels for
  // one metric would let two writers disagree about the same measurement.
  assert.equal('spo2' in VITAL_METRIC_UNITS, false);
  assert.equal('ecg_sample' in VITAL_METRIC_UNITS, false);
  assert.equal(PAIRED_VITAL_METRICS.has('blood_pressure'), true);
  assert.equal(PAIRED_VITAL_METRICS.has('heart_rate'), false);
  // Every metric with a unit must also have bounds, or an unbounded value could
  // be stored and corrupt aggregates.
  for (const metric of Object.keys(VITAL_METRIC_UNITS) as VitalMetricValue[]) {
    const bounds = VITAL_METRIC_BOUNDS[metric];
    assert.equal(typeof bounds.min, 'number');
    assert.ok(bounds.max > bounds.min);
  }
});

test('only validated readings drive alerts and terminal alert states never reopen', () => {
  assert.equal(readingDrivesAlerts('valid'), true);
  assert.equal(readingDrivesAlerts('suspect'), false);
  assert.equal(readingDrivesAlerts('invalid'), false);
  assert.equal(readingDrivesAlerts('unknown'), false);
  assert.equal(healthAlertTransitionAllowed('open', 'acknowledged'), true);
  assert.equal(healthAlertTransitionAllowed('open', 'escalated'), true);
  assert.equal(healthAlertTransitionAllowed('acknowledged', 'escalated'), true);
  assert.equal(healthAlertTransitionAllowed('escalated', 'acknowledged'), true);
  assert.equal(healthAlertTransitionAllowed('escalated', 'dismissed'), false);
  assert.equal(healthAlertTransitionAllowed('resolved', 'open'), false);
  assert.equal(healthAlertTransitionAllowed('dismissed', 'acknowledged'), false);
});

test('alert transition requests reject recipients on non-escalations and free-text reasons', () => {
  assert.equal(transitionHealthAlertSchema.safeParse({
    state: 'escalated', reason_code: 'no_response_from_patient',
    escalated_to_membership_id: membershipId, expected_version: 0,
  }).success, true);
  assert.equal(transitionHealthAlertSchema.safeParse({
    state: 'resolved', reason_code: 'vitals_returned_to_range',
    escalated_to_membership_id: membershipId, expected_version: 0,
  }).success, false);
  assert.equal(transitionHealthAlertSchema.safeParse({
    state: 'resolved', reason_code: 'Patient is fine now',
    escalated_to_membership_id: null, expected_version: 0,
  }).success, false);
  assert.equal(transitionHealthAlertSchema.safeParse({
    state: 'acknowledged', reason_code: 'seen', escalated_to_membership_id: null,
    expected_version: 0,
  }).success, false);
});

test('simulator emits canonical-topic packets and a QoS-1 replay is byte-identical', () => {
  const simulator = new DeviceSimulator({
    deviceId, bootId: 3, startedAt: new Date('2026-07-29T00:00:00.000Z'), suspectEvery: 4,
  });
  assert.equal(SIMULATOR_HARDWARE_PROFILE, 'smartcura_esp32_v1');
  const packet = simulator.packet(1);
  assert.equal(packet.topic, `smartcura/v1/devices/${deviceId}/vitals`);
  assert.equal(packet.topic, vitalsTopic(deviceId));
  assert.equal(packet.bootId, 3);
  assert.equal(packet.sequenceNo, 1);
  assert.equal(packet.recordedAt, '2026-07-29T00:01:00.000Z');
  // A device packet must never carry patient identity; ownership is resolved from
  // the time-valid assignment in PostgreSQL.
  assert.equal(JSON.stringify(packet).includes('patient'), false);
  for (const sample of packet.metrics) {
    assert.equal(sample.unit, VITAL_METRIC_UNITS[sample.metric]);
    const bounds = VITAL_METRIC_BOUNDS[sample.metric];
    assert.ok(sample.value >= bounds.min && sample.value <= bounds.max);
  }
  // Redelivery identity: the same sequence number must reproduce the same packet,
  // which is what lets the ledger prove a replay creates no second row.
  assert.deepEqual(simulator.packet(1), packet);
  const replayed = simulator.runWithReplay(5, 2);
  assert.equal(replayed.length, 7);
  const identities = new Set(replayed.map((entry) => `${entry.bootId}:${entry.sequenceNo}`));
  assert.equal(identities.size, 5);
  assert.equal(replayed[5]!.recordedAt, replayed[0]!.recordedAt);
  assert.deepEqual(replayed[5], replayed[0]);
});

test('simulator marks suspect samples and a reboot restarts sequence numbering', () => {
  const simulator = new DeviceSimulator({
    deviceId, bootId: 1, startedAt: new Date('2026-07-29T00:00:00.000Z'), suspectEvery: 3,
  });
  assert.equal(simulator.packet(3).metrics.every((entry) => entry.quality === 'suspect'), true);
  assert.equal(simulator.packet(2).metrics.every((entry) => entry.quality === 'valid'), true);
  const rebooted = simulator.reboot(2);
  const before = simulator.packet(0);
  const after = rebooted.packet(0);
  // Same sequence number, different boot: a distinct dedupe identity, so a reboot
  // never collides with readings from the previous power cycle.
  assert.equal(after.sequenceNo, before.sequenceNo);
  assert.notEqual(after.bootId, before.bootId);
  assert.throws(() => simulator.reboot(1));
  assert.throws(() => simulator.packet(-1));
});

test('WP-07 migrations split enum commits and add escalation, calibration, command and firmware invariants', () => {
  const vocabulary = readFileSync(new URL(
    '../packages/database/drizzle/0021_iot_canonical_vocabulary.sql', import.meta.url,
  ), 'utf8');
  const operations = readFileSync(new URL(
    '../packages/database/drizzle/0022_iot_operations_and_firmware.sql', import.meta.url,
  ), 'utf8');
  assert.match(vocabulary, /RENAME VALUE 'spo2' TO 'oxygen_saturation'/);
  assert.match(vocabulary, /RENAME VALUE 'ecg_sample' TO 'ecg_voltage'/);
  assert.match(vocabulary, /RENAME VALUE 'good' TO 'valid'/);
  assert.match(vocabulary, /ADD VALUE IF NOT EXISTS 'escalated'/);
  assert.match(vocabulary, /ADD VALUE IF NOT EXISTS 'dismissed'/);
  assert.match(vocabulary, /CREATE TYPE "public"\."reading_source"/);
  assert.match(vocabulary, /smartcura_esp32_v1/);
  // The split is load-bearing: PostgreSQL refuses to use a newly added enum value
  // in the same transaction, so no dependent object may live in 0021.
  assert.doesNotMatch(vocabulary, /CREATE TABLE|CREATE INDEX|INSERT INTO permissions/);
  assert.match(operations, /health_alert_escalations_reject_mutation/);
  assert.match(operations, /device_command_acks_command_uq/);
  assert.match(operations, /device_calibrations_live_uq/);
  assert.match(operations, /firmware_versions_sha_uq/);
  assert.match(operations, /vital_readings_secondary_value_check/);
  assert.match(operations, /iot\.alert:escalate:assigned/);
  assert.match(operations, /firmware management must remain super-admin only/);
  assert.match(operations, /'identity', 14/);
});

test('canonical contracts expose the new vocabulary and never publish a raw device patient id', () => {
  const openapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url,
  ), 'utf8'));
  const asyncapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/asyncapi/asyncapi.json', import.meta.url,
  ), 'utf8'));
  const openText = JSON.stringify(openapi);
  assert.equal(openText.includes('"spo2"'), false);
  assert.equal(openText.includes('"ecg_sample"'), false);
  assert.equal(JSON.stringify(asyncapi).includes('"spo2"'), false);
  assert.equal(openapi.paths['/health-alerts/{alert_id}/state'].put.operationId, 'transitionHealthAlert');
  const metric = openapi.components.schemas.VitalMetric;
  assert.ok(metric.enum.includes('oxygen_saturation'));
  assert.ok(metric.enum.includes('blood_pressure'));
  // The canonical MQTT topics and QoS-1/retain rules the simulator targets.
  assert.equal(asyncapi.channels.mqttVitals.address, 'smartcura/v1/devices/{deviceId}/vitals');
  assert.equal(asyncapi.channels.mqttVitals['x-qos'], 1);
  assert.equal(asyncapi.channels.mqttStatus['x-retain'], true);
  const vitals = asyncapi.components.schemas.DeviceVitalsPacket;
  assert.equal('patient_id' in vitals.properties, false);
  assert.ok(vitals.required.includes('boot_id') && vitals.required.includes('sequence_no'));
});

const patientProfile = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10';
const otherProfile = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11';
const validReason = DEVICE_RELEASE_REASON_CODES[0]!;

test('patient self-assign schema accepts optional expected_version and rejects unknown fields', () => {
  assert.equal(ownAssignDeviceSchema.safeParse({}).success, true);
  assert.equal(ownAssignDeviceSchema.safeParse({ expected_version: 0 }).success, true);
  assert.equal(ownAssignDeviceSchema.safeParse({ expected_version: -1 }).success, false);
  assert.equal(ownAssignDeviceSchema.safeParse({ reason_code: validReason }).success, false);
});

test('patient self-release schema requires expected_version and a known reason_code', () => {
  assert.equal(ownReleaseDeviceSchema.safeParse({ expected_version: 0, reason_code: validReason }).success, true);
  assert.equal(ownReleaseDeviceSchema.safeParse({ expected_version: 0 }).success, false);
  assert.equal(ownReleaseDeviceSchema.safeParse({ reason_code: validReason }).success, false);
  assert.equal(ownReleaseDeviceSchema.safeParse({ expected_version: 0, reason_code: 'not_a_real_reason' }).success, false);
});

test('device:assign:own and device:release:own are enforced on the actor-own boundary', () => {
  for (const permission of ['device:assign:own', 'device:release:own'] as const) {
    assert.equal(evaluatePermission(
      [permission], permission, { actorProfileId: patientProfile, ownerProfileId: patientProfile },
    ).allowed, true);
    assert.equal(evaluatePermission(
      [permission], permission, { actorProfileId: patientProfile, ownerProfileId: otherProfile },
    ).allowed, false);
    assert.equal(evaluatePermission(
      [permission], permission, { actorProfileId: otherProfile, ownerProfileId: patientProfile },
    ).allowed, false);
  }
});
