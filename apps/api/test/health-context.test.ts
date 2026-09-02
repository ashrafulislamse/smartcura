import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MockLlmProvider,
  type LlmGenerationRequest,
} from '@smartcura/database/ai';
import {
  HealthContextBuilder,
  inferSource,
  serializeHealthContext,
  type HealthContext,
} from '@smartcura/database/ai';

const chunkId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d63';

const baseRequest: LlmGenerationRequest = {
  artifactType: 'symptom_summary',
  turns: [{ role: 'patient', content: 'I have been feeling dizzy today.' }],
  citations: [{ chunkId, rank: 1, similarity: null }],
  promptTemplateKey: 'symptom_summary_v1',
  promptTemplateVersion: 1,
};

// ─── Test fixtures ───────────────────────────────────────────────────────────

const sampleContext: HealthContext = {
  profile: { displayName: 'Aisha Rahman' },
  conditions: [
    {
      conditionName: 'Hypertension',
      status: 'active',
      onsetDate: '2023-06-15',
      notes: 'Controlled with medication',
    },
    {
      conditionName: 'Type 2 Diabetes',
      status: 'active',
      onsetDate: '2022-03-01',
      notes: null,
    },
  ],
  allergies: [
    {
      substance: 'Penicillin',
      reaction: 'Rash',
      severity: 'moderate',
    },
  ],
  medications: [
    {
      medicationText: 'Amlodipine 5mg',
      doseValue: '5',
      doseUnit: 'mg',
      frequencyCode: 'OD',
      durationDays: 90,
    },
  ],
  recentVitals: [
    {
      metric: 'heart_rate',
      value: '82',
      unit: 'bpm',
      recordedAt: '2026-08-17T10:45:53Z',
      quality: 'valid',
      source: 'esp32',
      deviceId: '019ff4b0-4292-7a57-ac13-e2ee56c02272',
      stale: false,
    },
    {
      metric: 'oxygen_saturation',
      value: '98',
      unit: '%',
      recordedAt: '2026-08-17T10:45:53Z',
      quality: 'valid',
      source: 'esp32',
      deviceId: '019ff4b0-4292-7a57-ac13-e2ee56c02272',
      stale: false,
    },
  ],
  deviceStatus: [
    {
      deviceId: '019ff4b0-4292-7a57-ac13-e2ee56c02272',
      deviceType: 'vitals_monitor',
      source: 'esp32',
      state: 'active',
      lastSeenAt: '2026-08-17T10:45:53Z',
      online: true,
    },
  ],
};

const emptyContext: HealthContext = {
  profile: { displayName: 'New Patient' },
  conditions: [],
  allergies: [],
  medications: [],
  recentVitals: [],
  deviceStatus: [],
};

// ─── inferSource tests ───────────────────────────────────────────────────────

test('inferSource maps ESP32 device types to esp32', () => {
  assert.equal(inferSource('vitals_monitor'), 'esp32');
  assert.equal(inferSource('pulse_oximeter'), 'esp32');
});

test('inferSource maps simulator to simulator', () => {
  assert.equal(inferSource('simulator'), 'simulator');
});

test('inferSource maps phone to health_connect', () => {
  assert.equal(inferSource('phone'), 'health_connect');
});

test('inferSource maps unknown device types to device', () => {
  assert.equal(inferSource('ecg'), 'device');
  assert.equal(inferSource('thermometer'), 'device');
  assert.equal(inferSource('unknown_type'), 'device');
});

// ─── serializeHealthContext tests ────────────────────────────────────────────

test('serializeHealthContext includes patient name', () => {
  const text = serializeHealthContext(sampleContext);
  assert.ok(text.includes('Aisha Rahman'), 'must include patient display name');
});

test('serializeHealthContext lists conditions with status', () => {
  const text = serializeHealthContext(sampleContext);
  assert.ok(text.includes('Hypertension'), 'must include condition name');
  assert.ok(text.includes('active'), 'must include condition status');
  assert.ok(text.includes('Type 2 Diabetes'), 'must include second condition');
});

test('serializeHealthContext lists allergies with severity', () => {
  const text = serializeHealthContext(sampleContext);
  assert.ok(text.includes('Penicillin'), 'must include allergy substance');
  assert.ok(text.includes('moderate'), 'must include allergy severity');
});

test('serializeHealthContext lists medications with dose', () => {
  const text = serializeHealthContext(sampleContext);
  assert.ok(text.includes('Amlodipine'), 'must include medication name');
  assert.ok(text.includes('5mg'), 'must include dose');
});

test('serializeHealthContext lists vitals with source and timestamp', () => {
  const text = serializeHealthContext(sampleContext);
  assert.ok(text.includes('heart_rate'), 'must include metric');
  assert.ok(text.includes('82'), 'must include value');
  assert.ok(text.includes('esp32'), 'must include source');
  assert.ok(text.includes('2026-08-17'), 'must include timestamp');
});

test('serializeHealthContext marks suspect-quality readings', () => {
  const contextWithSuspect: HealthContext = {
    ...sampleContext,
    recentVitals: [
      {
        metric: 'heart_rate',
        value: '150',
        unit: 'bpm',
        recordedAt: '2026- SUSPECT-TIME',
        quality: 'suspect',
        source: 'esp32',
        deviceId: 'test-device',
        stale: false,
      },
    ],
  };
  const text = serializeHealthContext(contextWithSuspect);
  assert.ok(text.includes('[SUSPECT]'), 'must mark suspect readings');
});

test('serializeHealthContext marks stale readings', () => {
  const contextWithStale: HealthContext = {
    ...sampleContext,
    recentVitals: [
      {
        metric: 'heart_rate',
        value: '72',
        unit: 'bpm',
        recordedAt: '2026-08-17T06:00:00Z',
        quality: 'valid',
        source: 'esp32',
        deviceId: 'test-device',
        stale: true,
      },
    ],
  };
  const text = serializeHealthContext(contextWithStale);
  assert.ok(text.includes('[STALE]'), 'must mark stale readings');
});

test('serializeHealthContext does not mark fresh readings as stale', () => {
  const text = serializeHealthContext(sampleContext);
  assert.ok(!text.includes('[STALE]'), 'must not mark fresh readings as stale');
});

test('serializeHealthContext includes device status section', () => {
  const text = serializeHealthContext(sampleContext);
  assert.ok(text.includes('Device status:'), 'must include device status section');
  assert.ok(text.includes('vitals_monitor'), 'must include device type');
  assert.ok(text.includes('esp32'), 'must include device source in status');
  assert.ok(text.includes('active'), 'must include device state');
  assert.ok(text.includes('online'), 'must include online status');
  assert.ok(text.includes('last seen:'), 'must include last seen label');
});

test('serializeHealthContext shows offline and never for unreported devices', () => {
  const contextWithOfflineDevice: HealthContext = {
    ...sampleContext,
    deviceStatus: [
      {
        deviceId: 'test-device-offline',
        deviceType: 'phone',
        source: 'health_connect',
        state: 'provisioned',
        lastSeenAt: null,
        online: false,
      },
    ],
  };
  const text = serializeHealthContext(contextWithOfflineDevice);
  assert.ok(text.includes('offline'), 'must show offline for unreported device');
  assert.ok(text.includes('never'), 'must show never for null lastSeenAt');
  assert.ok(text.includes('health_connect'), 'must include health_connect source');
});

test('serializeHealthContext handles empty context gracefully', () => {
  const text = serializeHealthContext(emptyContext);
  assert.ok(text.includes('none recorded') || text.includes('none'), 'empty context must say none');
  assert.ok(!text.includes('undefined'), 'must not contain undefined');
  assert.ok(!text.includes('null'), 'must not contain raw null');
  assert.ok(text.includes('no assigned devices'), 'empty context must say no assigned devices');
});

// ─── MockLlmProvider with health context tests ──────────────────────────────

test('mock provider echoes health context presence when provided', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({ ...baseRequest, healthContext: sampleContext });
  assert.equal(result.content['health_context_present'], true);
  assert.ok(result.content['health_context_summary'] !== null, 'summary must not be null');
});

test('mock provider reports absent health context when not provided', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate(baseRequest);
  assert.equal(result.content['health_context_present'], false);
  assert.equal(result.content['health_context_summary'], null);
});

test('mock provider health context summary has correct counts', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({ ...baseRequest, healthContext: sampleContext });
  const summary = result.content['health_context_summary'] as Record<string, unknown>;
  assert.equal(summary['conditions_count'], 2);
  assert.equal(summary['allergies_count'], 1);
  assert.equal(summary['medications_count'], 1);
  assert.equal(summary['vitals_count'], 2);
  assert.equal(summary['patient_name'], 'Aisha Rahman');
});

test('mock provider with health context still passes safety filter', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({ ...baseRequest, healthContext: sampleContext });
  const { evaluateSafety, safetyBlocks } = await import('@smartcura/database/ai');
  assert.equal(safetyBlocks(evaluateSafety(result.content)), false);
});

test('mock provider with health context remains deterministic', async () => {
  const provider = new MockLlmProvider();
  const left = await provider.generate({ ...baseRequest, healthContext: sampleContext });
  const right = await provider.generate({ ...baseRequest, healthContext: sampleContext });
  assert.deepEqual(left, right);
});

test('mock provider with health context has higher prompt tokens than without', async () => {
  const provider = new MockLlmProvider();
  const withoutContext = await provider.generate(baseRequest);
  const withContext = await provider.generate({ ...baseRequest, healthContext: sampleContext });
  assert.ok(
    withContext.promptTokens >= withoutContext.promptTokens,
    'prompt tokens must not decrease when health context is added',
  );
});

// ─── Cross-patient isolation tests ───────────────────────────────────────────
//
// The HealthContextBuilder receives patientProfileId as a method parameter
// from the generation work row, never from user input. These tests verify
// that the builder's query structure enforces isolation by design.
//
// We use a mock PostgresConnection that captures the parameters passed to
// each query, so we can assert that ONLY the given patientProfileId is used.

function createMockDatabase() {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const mockDb = {
    query: (text: string, values: readonly unknown[] = []) => {
      queries.push({ text, values });
      // Return empty rows by default; specific tests can override.
      return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
    },
  };
  return { mockDb, queries };
}

test('HealthContextBuilder only queries the given patientProfileId', async () => {
  const { mockDb, queries } = createMockDatabase();
  const builder = new HealthContextBuilder(mockDb as never);
  const patientA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await builder.build(patientA, new Date('2026-08-17T12:00:00Z'));

  // Every query must use patientA as its first parameter ($1).
  for (const q of queries) {
    assert.equal(
      q.values[0], patientA,
      `query must be scoped to patient A, but was: ${q.values[0]}`,
    );
  }
  assert.ok(queries.length >= 5, 'must execute at least 5 queries (profile, conditions, allergies, medications, vitals, deviceStatus)');
});

test('HealthContextBuilder does not accept a patientProfileId from the response', async () => {
  // The builder has no method that returns a profileId or accepts one from
  // external input. The only way to specify which patient to build context
  // for is the `build(patientProfileId, now)` method parameter.
  const { mockDb } = createMockDatabase();
  const builder = new HealthContextBuilder(mockDb as never);
  const patientB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  // The builder.build() method is the ONLY public method. There is no
  // setProfileId, no constructor parameter for profileId, and no way to
  // override the patientProfileId after construction.
  const context = await builder.build(patientB, new Date('2026-08-17T12:00:00Z'));
  // The returned context has no profileId field — it only has the display name.
  assert.equal('profileId' in context, false, 'context must not expose profileId');
  assert.equal('patientProfileId' in context, false, 'context must not expose patientProfileId');
});

test('HealthContextBuilder vitals query excludes invalid and unknown quality', async () => {
  const { mockDb, queries } = createMockDatabase();
  const builder = new HealthContextBuilder(mockDb as never);
  await builder.build('cccccccc-cccc-cccc-cccc-cccccccccccc', new Date('2026-08-17T12:00:00Z'));

  const vitalsQuery = queries.find((q) => q.text.includes('vital_readings'));
  assert.ok(vitalsQuery, 'must have a vitals query');
  assert.ok(
    vitalsQuery!.text.includes("'valid'") && vitalsQuery!.text.includes("'suspect'"),
    'vitals query must filter to valid and suspect quality only',
  );
  assert.ok(
    !vitalsQuery!.text.includes("'invalid'") || vitalsQuery!.text.includes("NOT IN"),
    'vitals query must not include invalid quality',
  );
});

test('HealthContextBuilder conditions query filters deleted_at IS NULL', async () => {
  const { mockDb, queries } = createMockDatabase();
  const builder = new HealthContextBuilder(mockDb as never);
  await builder.build('dddddddd-dddd-dddd-dddd-dddddddddddd', new Date('2026-08-17T12:00:00Z'));

  const conditionsQuery = queries.find((q) => q.text.includes('patient_conditions'));
  assert.ok(conditionsQuery, 'must have a conditions query');
  assert.ok(
    conditionsQuery!.text.includes('deleted_at IS NULL'),
    'conditions query must filter soft-deleted rows',
  );
});

test('HealthContextBuilder allergies query filters deleted_at IS NULL', async () => {
  const { mockDb, queries } = createMockDatabase();
  const builder = new HealthContextBuilder(mockDb as never);
  await builder.build('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', new Date('2026-08-17T12:00:00Z'));

  const allergiesQuery = queries.find((q) => q.text.includes('patient_allergies'));
  assert.ok(allergiesQuery, 'must have an allergies query');
  assert.ok(
    allergiesQuery!.text.includes('deleted_at IS NULL'),
    'allergies query must filter soft-deleted rows',
  );
});

test('HealthContextBuilder medications query filters prescriptions status = signed', async () => {
  const { mockDb, queries } = createMockDatabase();
  const builder = new HealthContextBuilder(mockDb as never);
  await builder.build('ffffffff-ffff-ffff-ffff-ffffffffffff', new Date('2026-08-17T12:00:00Z'));

  const medsQuery = queries.find((q) => q.text.includes('prescription_items'));
  assert.ok(medsQuery, 'must have a medications query');
  assert.ok(
    medsQuery!.text.includes("'signed'"),
    'medications query must filter prescriptions status to signed only',
  );
});

test('HealthContextBuilder vitals query joins devices for source provenance', async () => {
  const { mockDb, queries } = createMockDatabase();
  const builder = new HealthContextBuilder(mockDb as never);
  await builder.build('11111111-1111-1111-1111-111111111111', new Date('2026-08-17T12:00:00Z'));

  const vitalsQuery = queries.find((q) => q.text.includes('vital_readings'));
  assert.ok(vitalsQuery, 'must have a vitals query');
  assert.ok(
    vitalsQuery!.text.includes('JOIN devices'),
    'vitals query must join devices table for source inference',
  );
  assert.ok(
    vitalsQuery!.text.includes('device_type'),
    'vitals query must select device_type for source inference',
  );
});

test('HealthContextBuilder device status query joins device_assignments for patient scoping', async () => {
  const { mockDb, queries } = createMockDatabase();
  const builder = new HealthContextBuilder(mockDb as never);
  await builder.build('33333333-3333-3333-3333-333333333333', new Date('2026-08-17T12:00:00Z'));

  const deviceQuery = queries.find((q) => q.text.includes('device_assignments'));
  assert.ok(deviceQuery, 'must have a device status query');
  assert.ok(
    deviceQuery!.text.includes('patient_profile_id'),
    'device status query must scope by patient_profile_id',
  );
  assert.ok(
    deviceQuery!.text.includes('released_at IS NULL'),
    'device status query must filter to active assignments only',
  );
  assert.ok(
    deviceQuery!.text.includes('last_seen_at'),
    'device status query must select last_seen_at for online inference',
  );
});

test('HealthContextBuilder does not query for non-existent columns', async () => {
  const { mockDb, queries } = createMockDatabase();
  const builder = new HealthContextBuilder(mockDb as never);
  await builder.build('22222222-2222-2222-2222-222222222222', new Date('2026-08-17T12:00:00Z'));

  for (const q of queries) {
    // profiles has no date_of_birth or sex column
    if (q.text.includes('profiles')) {
      assert.ok(!q.text.includes('date_of_birth'), 'must not query non-existent date_of_birth');
      assert.ok(!q.text.includes('sex'), 'must not query non-existent sex column');
    }
    // vital_readings has no source column
    if (q.text.includes('vital_readings')) {
      assert.ok(
        !q.text.match(/vr\.source\b/),
        'must not query non-existent source column on vital_readings',
      );
    }
    // there is no patient_medications table
    assert.ok(!q.text.includes('patient_medications'), 'must not query non-existent patient_medications table');
  }
});
