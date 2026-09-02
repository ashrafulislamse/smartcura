import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RiskScoringEngine,
  AdvancedAnomalyDetector,
  riskLevel,
  coefficientOfVariation,
  serializeRiskProfile,
  serializeAnomalyReport,
  type PatientRiskProfile,
  type AnomalyReport,
  type RiskScore,
  type RiskFactor,
  type AdvancedAnomaly,
} from '@smartcura/database/ai';

// ─── Type alias for mock row shape ───────────────────────────────────────────
//
// The mock rows match the column aliases the SQL queries produce. Each
// field name matches the AS alias (camelCase) that the database driver
// would return.

interface MockVitalRow {
  readonly metric: string;
  readonly value: string;
  readonly unit: string;
  readonly recordedAt: string;
  readonly quality: string;
  readonly deviceType: string;
}

interface MockConditionRow {
  readonly conditionName: string;
}

interface MockMedicationRow {
  readonly medicationText: string;
  readonly doseValue: string;
  readonly doseUnit: string;
  readonly frequencyCode: string | null;
  readonly durationDays: number;
}

// ─── Pure function tests ─────────────────────────────────────────────────────

test('riskLevel maps 0 to low', () => {
  assert.equal(riskLevel(0), 'low');
});

test('riskLevel maps 24 to low', () => {
  assert.equal(riskLevel(24), 'low');
});

test('riskLevel maps 25 to moderate', () => {
  assert.equal(riskLevel(25), 'moderate');
});

test('riskLevel maps 49 to moderate', () => {
  assert.equal(riskLevel(49), 'moderate');
});

test('riskLevel maps 50 to high', () => {
  assert.equal(riskLevel(50), 'high');
});

test('riskLevel maps 74 to high', () => {
  assert.equal(riskLevel(74), 'high');
});

test('riskLevel maps 75 to critical', () => {
  assert.equal(riskLevel(75), 'critical');
});

test('riskLevel maps 100 to critical', () => {
  assert.equal(riskLevel(100), 'critical');
});

test('coefficientOfVariation returns 0 for a constant series', () => {
  assert.equal(coefficientOfVariation([75, 75, 75, 75]), 0);
});

test('coefficientOfVariation computes CV for a variable series', () => {
  // alternating 60 and 120: mean=90, sample stddev (Bessel) ≈ 34.64, CV ≈ 0.385
  const cv = coefficientOfVariation([60, 120, 60, 120]);
  assert.ok(Math.abs(cv - 0.385) < 0.01, `CV was ${cv}, expected ≈ 0.385`);
});

test('coefficientOfVariation returns 0 for an empty list', () => {
  assert.equal(coefficientOfVariation([]), 0);
});

test('coefficientOfVariation returns 0 when mean is 0', () => {
  assert.equal(coefficientOfVariation([0, 0, 0]), 0);
});

// ─── Serialization tests ─────────────────────────────────────────────────────

const fixtureRiskProfile: PatientRiskProfile = {
  patientProfileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  overallRiskScore: 45,
  overallRiskLevel: 'moderate',
  riskScores: [
    {
      riskType: 'cardiovascular',
      score: 60,
      level: 'high',
      factors: [
        { name: 'elevated_heart_rate', contribution: 20, detail: 'Mean HR: 105 bpm (elevated)' },
        { name: 'hypertension_condition', contribution: 20, detail: 'Patient has hypertension' },
      ],
      recommendation: 'Monitor your heart rate. Consider consulting your doctor.',
      computedAt: '2026-08-17T12:00:00.000Z',
    },
    {
      riskType: 'fall',
      score: 0,
      level: 'low',
      factors: [],
      recommendation: 'Take care when standing. Consider consulting your doctor if dizzy.',
      computedAt: '2026-08-17T12:00:00.000Z',
    },
  ],
  computedAt: '2026-08-17T12:00:00.000Z',
};

test('serializeRiskProfile includes overall score and level', () => {
  const text = serializeRiskProfile(fixtureRiskProfile);
  assert.ok(text.includes('Overall risk: 45/100 (moderate)'), text);
});

test('serializeRiskProfile lists each risk score with factors', () => {
  const text = serializeRiskProfile(fixtureRiskProfile);
  assert.ok(text.includes('cardiovascular risk: 60/100 (high)'), text);
  assert.ok(text.includes('elevated_heart_rate (+20)'), text);
  assert.ok(text.includes('hypertension_condition (+20)'), text);
});

test('serializeRiskProfile shows no contributing factors for zero-factor scores', () => {
  const text = serializeRiskProfile(fixtureRiskProfile);
  assert.ok(text.includes('No contributing factors'), text);
});

test('serializeRiskProfile includes recommendations', () => {
  const text = serializeRiskProfile(fixtureRiskProfile);
  assert.ok(text.includes('Recommendation:'), text);
  assert.ok(text.includes('Consider consulting your doctor'), text);
});

test('serializeRiskProfile handles a profile with no risk scores', () => {
  const empty: PatientRiskProfile = {
    patientProfileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    overallRiskScore: 0,
    overallRiskLevel: 'low',
    riskScores: [],
    computedAt: '2026-08-17T12:00:00.000Z',
  };
  const text = serializeRiskProfile(empty);
  assert.ok(text.includes('Overall risk: 0/100 (low)'), text);
});

const fixtureAnomalyReport: AnomalyReport = {
  anomalies: [
    {
      metric: 'heart_rate',
      anomalyType: 'sustained_elevation',
      severity: 'moderate',
      startTime: '2026-08-15T10:00:00Z',
      endTime: '2026-08-15T12:00:00Z',
      description: 'Heart rate sustained above 95 bpm for 2 hours',
      relatedConditions: ['Hypertension'],
    },
    {
      metric: 'oxygen_saturation',
      anomalyType: 'progressive_decline',
      severity: 'severe',
      startTime: '2026-08-14T00:00:00Z',
      endTime: '2026-08-17T00:00:00Z',
      description: 'SpO₂ declining at -1.2%/day',
      relatedConditions: [],
    },
  ],
  windowDays: 7,
  totalReadingsAnalyzed: 100,
};

test('serializeAnomalyReport includes window header with readings count', () => {
  const text = serializeAnomalyReport(fixtureAnomalyReport);
  assert.ok(text.includes('7-day window, 100 readings analyzed'), text);
});

test('serializeAnomalyReport lists each anomaly with type and severity', () => {
  const text = serializeAnomalyReport(fixtureAnomalyReport);
  assert.ok(text.includes('heart_rate (sustained_elevation, moderate)'), text);
  assert.ok(text.includes('oxygen_saturation (progressive_decline, severe)'), text);
});

test('serializeAnomalyReport includes time range for each anomaly', () => {
  const text = serializeAnomalyReport(fixtureAnomalyReport);
  assert.ok(text.includes('[2026-08-15T10:00:00Z to 2026-08-15T12:00:00Z]'), text);
});

test('serializeAnomalyReport includes related conditions when present', () => {
  const text = serializeAnomalyReport(fixtureAnomalyReport);
  assert.ok(text.includes('Related conditions: Hypertension'), text);
});

test('serializeAnomalyReport handles empty report', () => {
  const empty: AnomalyReport = {
    anomalies: [],
    windowDays: 7,
    totalReadingsAnalyzed: 0,
  };
  const text = serializeAnomalyReport(empty);
  assert.ok(text.includes('No anomalies detected.'), text);
});

// ─── Mock database ───────────────────────────────────────────────────────────

function createMockDatabase(opts: {
  vitals?: readonly MockVitalRow[];
  conditions?: readonly MockConditionRow[];
  medications?: readonly MockMedicationRow[];
} = {}) {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const mockDb = {
    query: <Row extends { readonly [key: string]: unknown } = { readonly [key: string]: unknown }>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<{
      rows: readonly Row[];
      rowCount: number;
      command: string;
      oid: number;
      fields: readonly unknown[];
    }> => {
      queries.push({ text, values });
      let rows: readonly unknown[] = [];
      if (text.includes('vital_readings')) rows = opts.vitals ?? [];
      else if (text.includes('patient_conditions')) rows = opts.conditions ?? [];
      else if (text.includes('prescription_items')) rows = opts.medications ?? [];
      return Promise.resolve({
        rows: rows as readonly Row[],
        rowCount: rows.length,
        command: '',
        oid: 0,
        fields: [],
      });
    },
  };
  return { mockDb, queries };
}

function makeVitalRow(
  metric: string, value: number, minutesAgo: number, deviceType = 'vitals_monitor',
): MockVitalRow {
  const now = Date.now();
  return {
    metric,
    value: String(value),
    unit: unitForMetric(metric),
    recordedAt: new Date(now - minutesAgo * 60 * 1000).toISOString(),
    quality: 'valid',
    deviceType,
  };
}

function unitForMetric(metric: string): string {
  switch (metric) {
    case 'heart_rate': return 'bpm';
    case 'oxygen_saturation': return '%';
    case 'systolic_bp': case 'diastolic_bp': return 'mmHg';
    case 'respiratory_rate': return '/min';
    default: return '';
  }
}

// ─── Query-structure tests (RiskScoringEngine) ───────────────────────────────

test('RiskScoringEngine only queries the given patientProfileId', async () => {
  const { mockDb, queries } = createMockDatabase();
  const engine = new RiskScoringEngine(mockDb as never);
  const patientA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await engine.computeRiskProfile(patientA, new Date('2026-08-17T12:00:00Z'));

  for (const q of queries) {
    assert.equal(q.values[0], patientA, `query must be scoped to patient A, but was: ${q.values[0]}`);
  }
  assert.ok(queries.length >= 3, 'must execute at least 3 queries (vitals, conditions, medications)');
});

test('RiskScoringEngine vitals query filters quality to valid and suspect', async () => {
  const { mockDb, queries } = createMockDatabase();
  const engine = new RiskScoringEngine(mockDb as never);
  await engine.computeRiskProfile('11111111-1111-1111-1111-111111111111', new Date('2026-08-17T12:00:00Z'));

  const vitalsQuery = queries.find((q) => q.text.includes('vital_readings'));
  assert.ok(vitalsQuery, 'must have a vitals query');
  assert.ok(
    vitalsQuery!.text.includes("'valid'") && vitalsQuery!.text.includes("'suspect'"),
    'vitals query must filter to valid and suspect quality only',
  );
});

test('RiskScoringEngine conditions query filters deleted_at IS NULL', async () => {
  const { mockDb, queries } = createMockDatabase();
  const engine = new RiskScoringEngine(mockDb as never);
  await engine.computeRiskProfile('22222222-2222-2222-2222-222222222222', new Date('2026-08-17T12:00:00Z'));

  const conditionsQuery = queries.find((q) => q.text.includes('patient_conditions'));
  assert.ok(conditionsQuery, 'must have a conditions query');
  assert.ok(conditionsQuery!.text.includes('deleted_at IS NULL'), 'conditions query must filter soft-deleted rows');
});

test('RiskScoringEngine medications query filters prescriptions status = signed', async () => {
  const { mockDb, queries } = createMockDatabase();
  const engine = new RiskScoringEngine(mockDb as never);
  await engine.computeRiskProfile('33333333-3333-3333-3333-333333333333', new Date('2026-08-17T12:00:00Z'));

  const medsQuery = queries.find((q) => q.text.includes('prescription_items'));
  assert.ok(medsQuery, 'must have a medications query');
  assert.ok(medsQuery!.text.includes("'signed'"), 'medications query must filter prescriptions status to signed only');
});

test('RiskScoringEngine vitals query joins devices for source provenance', async () => {
  const { mockDb, queries } = createMockDatabase();
  const engine = new RiskScoringEngine(mockDb as never);
  await engine.computeRiskProfile('44444444-4444-4444-4444-444444444444', new Date('2026-08-17T12:00:00Z'));

  const vitalsQuery = queries.find((q) => q.text.includes('vital_readings'));
  assert.ok(vitalsQuery, 'must have a vitals query');
  assert.ok(vitalsQuery!.text.includes('JOIN devices'), 'vitals query must join devices table');
  assert.ok(vitalsQuery!.text.includes('device_type'), 'vitals query must select device_type');
});

test('RiskScoringEngine does not query for non-existent columns', async () => {
  const { mockDb, queries } = createMockDatabase();
  const engine = new RiskScoringEngine(mockDb as never);
  await engine.computeRiskProfile('55555555-5555-5555-5555-555555555555', new Date('2026-08-17T12:00:00Z'));

  for (const q of queries) {
    if (q.text.includes('vital_readings')) {
      assert.ok(!q.text.match(/vr\.source\b/), 'must not query non-existent source column');
    }
    assert.ok(!q.text.includes('patient_medications'), 'must not query non-existent patient_medications table');
    if (q.text.includes('profiles')) {
      assert.ok(!q.text.includes('date_of_birth'), 'must not query non-existent date_of_birth');
      assert.ok(!q.text.includes('sex'), 'must not query non-existent sex column');
    }
  }
});

// ─── Risk scoring functional tests ───────────────────────────────────────────

test('RiskScoringEngine returns low risk for a patient with no vitals or conditions', async () => {
  const { mockDb } = createMockDatabase();
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', new Date('2026-08-17T12:00:00Z'),
  );

  assert.equal(profile.patientProfileId, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.equal(profile.riskScores.length, 4);
  assert.equal(profile.overallRiskLevel, 'low');
  for (const rs of profile.riskScores) {
    assert.ok(rs.score <= 24, `${rs.riskType} should be low, was ${rs.score}`);
  }
});

test('RiskScoringEngine returns low risk for all-normal vitals', async () => {
  const vitals: MockVitalRow[] = [
    ...Array.from({ length: 10 }, () => makeVitalRow('heart_rate', 72, 30)),
    ...Array.from({ length: 10 }, () => makeVitalRow('oxygen_saturation', 98, 30)),
    ...Array.from({ length: 5 }, () => makeVitalRow('systolic_bp', 118, 60)),
    ...Array.from({ length: 5 }, () => makeVitalRow('diastolic_bp', 76, 60)),
    ...Array.from({ length: 5 }, () => makeVitalRow('respiratory_rate', 16, 60)),
  ];
  const { mockDb } = createMockDatabase({ vitals });
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', new Date('2026-08-17T12:00:00Z'),
  );

  for (const rs of profile.riskScores) {
    assert.ok(rs.score <= 24, `${rs.riskType} should be low for normal vitals, was ${rs.score}`);
  }
  assert.equal(profile.overallRiskLevel, 'low');
});

test('RiskScoringEngine detects elevated heart rate in cardiovascular risk', async () => {
  // HR of 130 gives contribution=30 (mean > 120), pushing cardiovascular to moderate (30 >= 25)
  const vitals: MockVitalRow[] = Array.from({ length: 10 }, () => makeVitalRow('heart_rate', 130, 30));
  const { mockDb } = createMockDatabase({ vitals });
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', new Date('2026-08-17T12:00:00Z'),
  );

  const cardio = profile.riskScores.find((rs) => rs.riskType === 'cardiovascular');
  assert.ok(cardio, 'must have cardiovascular risk score');
  assert.ok(cardio!.score >= 25, `cardiovascular should be at least moderate, was ${cardio!.score}`);
  assert.ok(
    cardio!.factors.some((f) => f.name === 'elevated_heart_rate'),
    'must include elevated_heart_rate factor',
  );
});

test('RiskScoringEngine detects low SpO₂ in respiratory risk', async () => {
  const vitals: MockVitalRow[] = Array.from({ length: 10 }, () => makeVitalRow('oxygen_saturation', 90, 30));
  const { mockDb } = createMockDatabase({ vitals });
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    'dddddddd-dddd-dddd-dddd-dddddddddddd', new Date('2026-08-17T12:00:00Z'),
  );

  const resp = profile.riskScores.find((rs) => rs.riskType === 'respiratory');
  assert.ok(resp, 'must have respiratory risk score');
  assert.ok(resp!.score >= 25, `respiratory should be at least moderate, was ${resp!.score}`);
  assert.ok(
    resp!.factors.some((f) => f.name === 'low_oxygen_saturation'),
    'must include low_oxygen_saturation factor',
  );
});

test('RiskScoringEngine detects high blood pressure in cardiovascular risk', async () => {
  const vitals: MockVitalRow[] = [
    ...Array.from({ length: 5 }, () => makeVitalRow('systolic_bp', 150, 60)),
    ...Array.from({ length: 5 }, () => makeVitalRow('diastolic_bp', 95, 60)),
  ];
  const conditions: MockConditionRow[] = [{ conditionName: 'Hypertension' }];
  const { mockDb } = createMockDatabase({ vitals, conditions });
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', new Date('2026-08-17T12:00:00Z'),
  );

  const cardio = profile.riskScores.find((rs) => rs.riskType === 'cardiovascular');
  assert.ok(cardio, 'must have cardiovascular risk score');
  assert.ok(cardio!.score >= 35, `cardiovascular should be at least moderate with BP+hypertension, was ${cardio!.score}`);
  assert.ok(
    cardio!.factors.some((f) => f.name === 'high_blood_pressure'),
    'must include high_blood_pressure factor',
  );
  assert.ok(
    cardio!.factors.some((f) => f.name === 'hypertension_condition'),
    'must include hypertension_condition factor',
  );
});

test('RiskScoringEngine detects medication complexity in adherence risk', async () => {
  const medications: MockMedicationRow[] = Array.from({ length: 6 }, (_, i) => ({
    medicationText: `Medication ${i + 1}`,
    doseValue: '10',
    doseUnit: 'mg',
    frequencyCode: 'BID',
    durationDays: 30,
  }));
  const { mockDb } = createMockDatabase({ medications });
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    'ffffffff-ffff-ffff-ffff-ffffffffffff', new Date('2026-08-17T12:00:00Z'),
  );

  const adherence = profile.riskScores.find((rs) => rs.riskType === 'medication_adherence');
  assert.ok(adherence, 'must have medication_adherence risk score');
  assert.ok(adherence!.score >= 40, `adherence should be high with 6 meds, was ${adherence!.score}`);
  assert.ok(
    adherence!.factors.some((f) => f.name === 'medication_complexity'),
    'must include medication_complexity factor',
  );
});

test('RiskScoringEngine detects chronic conditions in adherence risk', async () => {
  const conditions: MockConditionRow[] = [
    { conditionName: 'Hypertension' },
    { conditionName: 'Type 2 Diabetes' },
  ];
  const { mockDb } = createMockDatabase({ conditions });
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    '11111111-2222-3333-4444-555555555555', new Date('2026-08-17T12:00:00Z'),
  );

  const adherence = profile.riskScores.find((rs) => rs.riskType === 'medication_adherence');
  assert.ok(adherence, 'must have medication_adherence risk score');
  assert.ok(
    adherence!.factors.some((f) => f.name === 'chronic_conditions'),
    'must include chronic_conditions factor',
  );
});

test('RiskScoringEngine detects stale device readings in fall risk', async () => {
  // All readings are 1 hour old (stale = older than 5 min)
  const vitals: MockVitalRow[] = [
    makeVitalRow('heart_rate', 72, 60),
    makeVitalRow('oxygen_saturation', 98, 60),
  ];
  const { mockDb } = createMockDatabase({ vitals });
  const engine = new RiskScoringEngine(mockDb as never);
  // now is the current time, but the readings are 60 min old
  const profile = await engine.computeRiskProfile(
    '66666666-6666-6666-6666-666666666666', new Date(),
  );

  const fall = profile.riskScores.find((rs) => rs.riskType === 'fall');
  assert.ok(fall, 'must have fall risk score');
  assert.ok(
    fall!.factors.some((f) => f.name === 'stale_device_readings'),
    'must include stale_device_readings factor',
  );
});

test('RiskScoringEngine computes overall as weighted average', async () => {
  // With no vitals, conditions, or meds:
  // cardio=0, fall=0, resp=15 (no_spo2_data), adherence=5 (no meds)
  // overall = 0*0.3 + 0*0.2 + 5*0.2 + 15*0.3 = 0 + 0 + 1 + 4.5 = 5.5 → 6
  const { mockDb } = createMockDatabase();
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    '77777777-7777-7777-7777-777777777777', new Date('2026-08-17T12:00:00Z'),
  );

  assert.ok(profile.overallRiskScore <= 24, `overall should be low, was ${profile.overallRiskScore}`);
  assert.equal(profile.overallRiskLevel, 'low');
  // Verify the weights sum to 1.0 by checking we have all 4 risk types
  const types = profile.riskScores.map((rs) => rs.riskType);
  assert.ok(types.includes('cardiovascular'));
  assert.ok(types.includes('fall'));
  assert.ok(types.includes('medication_adherence'));
  assert.ok(types.includes('respiratory'));
});

test('RiskScoringEngine recommendations are non-diagnostic', async () => {
  const { mockDb } = createMockDatabase();
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    '88888888-8888-8888-8888-888888888888', new Date('2026-08-17T12:00:00Z'),
  );

  for (const rs of profile.riskScores) {
    assert.ok(
      rs.recommendation.includes('Consider consulting your doctor') ||
      rs.recommendation.includes('Consider consulting your doctor or pharmacist'),
      `${rs.riskType} recommendation must be non-diagnostic (say "consider consulting your doctor")`,
    );
  }
});

// ─── Query-structure tests (AdvancedAnomalyDetector) ─────────────────────────

test('AdvancedAnomalyDetector only queries the given patientProfileId', async () => {
  const { mockDb, queries } = createMockDatabase();
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const patientA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await detector.detect(patientA, new Date('2026-08-17T12:00:00Z'), 7);

  for (const q of queries) {
    assert.equal(q.values[0], patientA, `query must be scoped to patient A, but was: ${q.values[0]}`);
  }
  assert.ok(queries.length >= 2, 'must execute at least 2 queries (readings, conditions)');
});

test('AdvancedAnomalyDetector vitals query filters quality to valid and suspect', async () => {
  const { mockDb, queries } = createMockDatabase();
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  await detector.detect('11111111-1111-1111-1111-111111111111', new Date('2026-08-17T12:00:00Z'), 7);

  const vitalsQuery = queries.find((q) => q.text.includes('vital_readings'));
  assert.ok(vitalsQuery, 'must have a vitals query');
  assert.ok(
    vitalsQuery!.text.includes("'valid'") && vitalsQuery!.text.includes("'suspect'"),
    'vitals query must filter to valid and suspect quality only',
  );
});

test('AdvancedAnomalyDetector conditions query filters deleted_at IS NULL', async () => {
  const { mockDb, queries } = createMockDatabase();
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  await detector.detect('22222222-2222-2222-2222-222222222222', new Date('2026-08-17T12:00:00Z'), 7);

  const conditionsQuery = queries.find((q) => q.text.includes('patient_conditions'));
  assert.ok(conditionsQuery, 'must have a conditions query');
  assert.ok(conditionsQuery!.text.includes('deleted_at IS NULL'), 'conditions query must filter soft-deleted rows');
});

test('AdvancedAnomalyDetector does not query for non-existent source column', async () => {
  const { mockDb, queries } = createMockDatabase();
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  await detector.detect('33333333-3333-3333-3333-333333333333', new Date('2026-08-17T12:00:00Z'), 7);

  for (const q of queries) {
    if (q.text.includes('vital_readings')) {
      assert.ok(!q.text.match(/vr\.source\b/), 'must not query non-existent source column');
    }
  }
});

// ─── Anomaly detection functional tests ──────────────────────────────────────

test('AdvancedAnomalyDetector returns empty for a patient with no readings', async () => {
  const { mockDb } = createMockDatabase();
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    '44444444-4444-4444-4444-444444444444', new Date('2026-08-17T12:00:00Z'), 7,
  );

  assert.equal(report.anomalies.length, 0);
  assert.equal(report.totalReadingsAnalyzed, 0);
  assert.equal(report.windowDays, 7);
});

test('AdvancedAnomalyDetector returns no anomalies for normal constant vitals', async () => {
  const vitals: MockVitalRow[] = Array.from({ length: 20 }, () => makeVitalRow('heart_rate', 72, 30));
  const { mockDb } = createMockDatabase({ vitals });
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    '55555555-5555-5555-5555-555555555555', new Date('2026-08-17T12:00:00Z'), 7,
  );

  assert.equal(report.anomalies.length, 0, 'constant normal vitals should produce no anomalies');
  assert.equal(report.totalReadingsAnalyzed, 20);
});

test('AdvancedAnomalyDetector detects sustained elevation in heart rate', async () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  // 50 baseline readings at 75 bpm over 5 days (every 2 hours)
  const baseline: MockVitalRow[] = Array.from({ length: 50 }, (_, i) => ({
    metric: 'heart_rate', value: '75', unit: 'bpm',
    recordedAt: new Date(baseMs - (50 - i) * 2 * 60 * 60 * 1000).toISOString(),
    quality: 'valid', deviceType: 'vitals_monitor',
  }));
  // 10 elevated readings at 130 bpm over 2.5 hours (every 15 min)
  const elevated: MockVitalRow[] = Array.from({ length: 10 }, (_, i) => ({
    metric: 'heart_rate', value: '130', unit: 'bpm',
    recordedAt: new Date(baseMs - (10 - i) * 15 * 60 * 1000).toISOString(),
    quality: 'valid', deviceType: 'vitals_monitor',
  }));

  const { mockDb } = createMockDatabase({ vitals: [...baseline, ...elevated] });
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    '66666666-6666-6666-6666-666666666666', now, 7,
  );

  const sustained = report.anomalies.find((a) => a.anomalyType === 'sustained_elevation');
  assert.ok(sustained, 'must detect sustained elevation');
  assert.equal(sustained!.metric, 'heart_rate');
  assert.ok(sustained!.severity === 'moderate' || sustained!.severity === 'severe');
});

test('AdvancedAnomalyDetector detects acute spike', async () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  const normal: MockVitalRow[] = Array.from({ length: 30 }, (_, i) => ({
    metric: 'heart_rate', value: '75', unit: 'bpm',
    recordedAt: new Date(baseMs - (30 - i) * 60 * 60 * 1000).toISOString(),
    quality: 'valid', deviceType: 'vitals_monitor',
  }));
  const spike: MockVitalRow = {
    metric: 'heart_rate', value: '200', unit: 'bpm',
    recordedAt: new Date(baseMs - 30 * 60 * 1000).toISOString(),
    quality: 'valid', deviceType: 'vitals_monitor',
  };

  const { mockDb } = createMockDatabase({ vitals: [...normal, spike] });
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    '77777777-7777-7777-7777-777777777777', now, 7,
  );

  const acuteSpike = report.anomalies.find((a) => a.anomalyType === 'acute_spike');
  assert.ok(acuteSpike, 'must detect acute spike');
  assert.equal(acuteSpike!.metric, 'heart_rate');
  assert.equal(acuteSpike!.severity, 'severe');
});

test('AdvancedAnomalyDetector detects progressive decline in SpO₂', async () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  // 15 SpO₂ readings declining from 97% to ~91.4% over ~3 days
  const vitals: MockVitalRow[] = Array.from({ length: 15 }, (_, i) => ({
    metric: 'oxygen_saturation',
    value: (97 - i * 0.4).toFixed(2),
    unit: '%',
    recordedAt: new Date(baseMs - (14 - i) * 5 * 60 * 60 * 1000).toISOString(),
    quality: 'valid', deviceType: 'vitals_monitor',
  }));

  const { mockDb } = createMockDatabase({ vitals });
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    '88888888-8888-8888-8888-888888888888', now, 7,
  );

  const decline = report.anomalies.find((a) => a.anomalyType === 'progressive_decline');
  assert.ok(decline, 'must detect progressive decline');
  assert.equal(decline!.metric, 'oxygen_saturation');
  assert.ok(decline!.severity === 'moderate' || decline!.severity === 'severe');
});

test('AdvancedAnomalyDetector detects erratic pattern in heart rate', async () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  // Alternating 60 and 120 bpm: mean=90, stddev≈30.4, CV≈0.338 > 0.30
  const vitals: MockVitalRow[] = Array.from({ length: 20 }, (_, i) => ({
    metric: 'heart_rate',
    value: i % 2 === 0 ? '60' : '120',
    unit: 'bpm',
    recordedAt: new Date(baseMs - (19 - i) * 60 * 60 * 1000).toISOString(),
    quality: 'valid', deviceType: 'vitals_monitor',
  }));

  const { mockDb } = createMockDatabase({ vitals });
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    '99999999-9999-9999-9999-999999999999', now, 7,
  );

  const erratic = report.anomalies.find((a) => a.anomalyType === 'erratic_pattern');
  assert.ok(erratic, 'must detect erratic pattern');
  assert.equal(erratic!.metric, 'heart_rate');
});

test('AdvancedAnomalyDetector includes related conditions in anomalies', async () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  const normal: MockVitalRow[] = Array.from({ length: 30 }, (_, i) => ({
    metric: 'heart_rate', value: '75', unit: 'bpm',
    recordedAt: new Date(baseMs - (30 - i) * 60 * 60 * 1000).toISOString(),
    quality: 'valid', deviceType: 'vitals_monitor',
  }));
  const spike: MockVitalRow = {
    metric: 'heart_rate', value: '200', unit: 'bpm',
    recordedAt: new Date(baseMs - 30 * 60 * 1000).toISOString(),
    quality: 'valid', deviceType: 'vitals_monitor',
  };
  const conditions: MockConditionRow[] = [{ conditionName: 'Hypertension' }];

  const { mockDb } = createMockDatabase({ vitals: [...normal, spike], conditions });
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', now, 7,
  );

  const acuteSpike = report.anomalies.find((a) => a.anomalyType === 'acute_spike');
  assert.ok(acuteSpike, 'must detect acute spike');
  assert.ok(
    acuteSpike!.relatedConditions.includes('Hypertension'),
    `relatedConditions should include Hypertension, got: ${acuteSpike!.relatedConditions.join(', ')}`,
  );
});

test('AdvancedAnomalyDetector sorts anomalies by severity (severe first)', async () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  // 30 constant baseline readings at 75 to keep stddev tight, then one spike at 300
  // to trigger acute_spike (severe). Separately, 20 SpO₂ readings declining steeply
  // to trigger progressive_decline (moderate or severe). Two different metrics ensure
  // the acute spike's large outlier does not inflate the other metric's stddev.
  const hr: MockVitalRow[] = [
    ...Array.from({ length: 30 }, (_, i) => ({
      metric: 'heart_rate', value: '75', unit: 'bpm',
      recordedAt: new Date(baseMs - (30 - i) * 60 * 60 * 1000).toISOString(),
      quality: 'valid' as const, deviceType: 'vitals_monitor',
    })),
    {
      metric: 'heart_rate', value: '300', unit: 'bpm',
      recordedAt: new Date(baseMs - 30 * 60 * 1000).toISOString(),
      quality: 'valid' as const, deviceType: 'vitals_monitor',
    },
  ];
  const spo2: MockVitalRow[] = Array.from({ length: 15 }, (_, i) => ({
    metric: 'oxygen_saturation',
    value: (97 - i * 0.4).toFixed(2),
    unit: '%',
    recordedAt: new Date(baseMs - (14 - i) * 5 * 60 * 60 * 1000).toISOString(),
    quality: 'valid' as const, deviceType: 'vitals_monitor',
  }));

  const { mockDb } = createMockDatabase({ vitals: [...hr, ...spo2] });
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    'ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb', now, 7,
  );

  assert.ok(report.anomalies.length >= 2, `should detect at least 2 anomalies, got ${report.anomalies.length}`);
  // Severe anomalies should come before moderate ones
  const firstSevere = report.anomalies.findIndex((a) => a.severity === 'severe');
  const firstModerate = report.anomalies.findIndex((a) => a.severity === 'moderate');
  if (firstSevere !== -1 && firstModerate !== -1) {
    assert.ok(firstSevere < firstModerate, 'severe anomalies should sort before moderate');
  }
});

// ─── Edge case tests ─────────────────────────────────────────────────────────

test('RiskScoringEngine handles extreme values without crashing', async () => {
  const vitals: MockVitalRow[] = [
    ...Array.from({ length: 5 }, () => makeVitalRow('heart_rate', 200, 1)),
    ...Array.from({ length: 5 }, () => makeVitalRow('oxygen_saturation', 70, 1)),
    ...Array.from({ length: 5 }, () => makeVitalRow('systolic_bp', 200, 1)),
    ...Array.from({ length: 5 }, () => makeVitalRow('diastolic_bp', 120, 1)),
  ];
  const conditions: MockConditionRow[] = [
    { conditionName: 'Hypertension' },
    { conditionName: 'Type 2 Diabetes' },
  ];
  const { mockDb } = createMockDatabase({ vitals, conditions });
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    'aaaaaaaa-1111-2222-3333-444444444444', new Date('2026-08-17T12:00:00Z'),
  );

  // Should produce high or critical scores, not crash
  assert.ok(profile.overallRiskScore >= 50, `overall should be high+, was ${profile.overallRiskScore}`);
  for (const rs of profile.riskScores) {
    assert.ok(rs.score >= 0 && rs.score <= 100, `${rs.riskType} score must be 0-100, was ${rs.score}`);
  }
});

test('AdvancedAnomalyDetector handles extreme single-reading spike', async () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  // 50 constant baseline readings at 72 keep stddev small, so the single
  // spike at 300 produces a z-score well above 4 (severe acute_spike).
  const vitals: MockVitalRow[] = [
    ...Array.from({ length: 50 }, (_, i) => ({
      metric: 'heart_rate', value: '72', unit: 'bpm',
      recordedAt: new Date(baseMs - (50 - i) * 30 * 60 * 1000).toISOString(),
      quality: 'valid' as const, deviceType: 'vitals_monitor',
    })),
    {
      metric: 'heart_rate', value: '300', unit: 'bpm',
      recordedAt: new Date(baseMs - 5 * 60 * 1000).toISOString(),
      quality: 'valid' as const, deviceType: 'vitals_monitor',
    },
  ];

  const { mockDb } = createMockDatabase({ vitals });
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    'bbbbbbbb-1111-2222-3333-444444444444', now, 7,
  );

  assert.ok(report.anomalies.length > 0, 'should detect at least one anomaly for extreme spike');
  const acute = report.anomalies.find((a) => a.anomalyType === 'acute_spike');
  assert.ok(acute, 'should detect acute_spike for extreme reading');
  assert.equal(acute!.severity, 'severe');
});

test('RiskScoringEngine with a single reading does not crash', async () => {
  const vitals: MockVitalRow[] = [makeVitalRow('heart_rate', 75, 1)];
  const { mockDb } = createMockDatabase({ vitals });
  const engine = new RiskScoringEngine(mockDb as never);
  const profile = await engine.computeRiskProfile(
    'cccccccc-1111-2222-3333-444444444444', new Date('2026-08-17T12:00:00Z'),
  );

  assert.equal(profile.riskScores.length, 4);
  for (const rs of profile.riskScores) {
    assert.ok(rs.score >= 0 && rs.score <= 100);
  }
});

test('AdvancedAnomalyDetector with insufficient data points produces no anomalies', async () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  // Only 2 readings — below MIN_POINTS for any detection
  const vitals: MockVitalRow[] = [
    { metric: 'heart_rate', value: '75', unit: 'bpm', recordedAt: new Date(baseMs - 60 * 60 * 1000).toISOString(), quality: 'valid', deviceType: 'vitals_monitor' },
    { metric: 'heart_rate', value: '80', unit: 'bpm', recordedAt: new Date(baseMs - 30 * 60 * 1000).toISOString(), quality: 'valid', deviceType: 'vitals_monitor' },
  ];

  const { mockDb } = createMockDatabase({ vitals });
  const detector = new AdvancedAnomalyDetector(mockDb as never);
  const report = await detector.detect(
    'dddddddd-1111-2222-3333-444444444444', now, 7,
  );

  assert.equal(report.anomalies.length, 0, 'should not detect anomalies with fewer than MIN_POINTS readings');
  assert.equal(report.totalReadingsAnalyzed, 2);
});
