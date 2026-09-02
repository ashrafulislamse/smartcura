import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LongitudinalAnalyzer,
  mean,
  stddev,
  pearsonCorrelation,
  linearRegressionSlope,
  zScore,
  serializeLongitudinalAnalysis,
  serializeRichLongitudinalAnalysis,
  type LongitudinalAnalysis,
  type RichLongitudinalAnalysis,
  type SeasonalPattern,
  type LongitudinalComparison,
  type VitalAnomaly,
  type VitalTrend,
  type MetricCorrelation,
} from '@smartcura/database/ai';

// ─── Pure-function statistics tests ──────────────────────────────────────────

test('mean returns the arithmetic average', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(mean([10]), 10);
  assert.equal(mean([1, 2, 3, 4, 5]), 3);
});

test('mean returns 0 for an empty list', () => {
  assert.equal(mean([]), 0);
});

test('stddev is zero for a constant series', () => {
  assert.equal(stddev([5, 5, 5, 5]), 0);
  assert.equal(stddev([42]), 0);
});

test('stddev matches the textbook formula for a small sample', () => {
  // [2, 4, 4, 4, 5, 5, 7, 9] → population-style example, sample stddev ≈ 2.138
  const s = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.ok(Math.abs(s - 2.138) < 0.01, `stddev was ${s}, expected ≈ 2.138`);
});

test('stddev returns 0 for an empty list', () => {
  assert.equal(stddev([]), 0);
});

test('pearsonCorrelation returns 1 for a perfect positive linear series', () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [2, 4, 6, 8, 10];
  assert.ok(Math.abs(pearsonCorrelation(xs, ys) - 1) < 1e-9);
});

test('pearsonCorrelation returns -1 for a perfect negative linear series', () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [10, 8, 6, 4, 2];
  assert.ok(Math.abs(pearsonCorrelation(xs, ys) + 1) < 1e-9);
});

test('pearsonCorrelation returns ~0 for an uncorrelated series', () => {
  // A truly uncorrelated series: y is a constant offset of x plus a large
  // pseudo-random term. The Pearson r should sit within a small tolerance
  // of zero, not drift toward 1 or -1.
  const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const ys = [55, 12, 87, 33, 71, 24, 66, 41, 58, 29];
  const r = pearsonCorrelation(xs, ys);
  assert.ok(
    Math.abs(r) < 0.3,
    `expected near-zero correlation, got ${r}`,
  );
});

test('pearsonCorrelation returns 0 for a constant series', () => {
  assert.equal(pearsonCorrelation([5, 5, 5], [1, 2, 3]), 0);
  assert.equal(pearsonCorrelation([1, 2, 3], [7, 7, 7]), 0);
});

test('pearsonCorrelation returns 0 for unequal-length or empty series', () => {
  assert.equal(pearsonCorrelation([], []), 0);
  assert.equal(pearsonCorrelation([1, 2], [1]), 0);
  assert.equal(pearsonCorrelation([1], [1, 2]), 0);
});

test('linearRegressionSlope returns the exact slope for a known series', () => {
  // y = 3x + 1
  const xs = [0, 1, 2, 3, 4, 5];
  const ys = [1, 4, 7, 10, 13, 16];
  const slope = linearRegressionSlope(xs, ys);
  assert.ok(Math.abs(slope - 3) < 1e-9, `slope was ${slope}, expected 3`);
});

test('linearRegressionSlope returns 0 for a horizontal line', () => {
  assert.equal(linearRegressionSlope([1, 2, 3, 4, 5], [7, 7, 7, 7, 7]), 0);
});

test('linearRegressionSlope returns 0 for a vertical line (constant x)', () => {
  assert.equal(linearRegressionSlope([3, 3, 3, 3], [1, 2, 3, 4]), 0);
});

test('linearRegressionSlope returns 0 for fewer than two points', () => {
  assert.equal(linearRegressionSlope([1], [5]), 0);
  assert.equal(linearRegressionSlope([], []), 0);
});

test('zScore returns 0 for the mean of the distribution', () => {
  assert.equal(zScore(75, 75, 8), 0);
});

test('zScore is +1 and -1 for one standard deviation away', () => {
  assert.ok(Math.abs(zScore(83, 75, 8) - 1) < 1e-9);
  assert.ok(Math.abs(zScore(67, 75, 8) + 1) < 1e-9);
});

test('zScore returns 0 when standard deviation is 0', () => {
  assert.equal(zScore(100, 50, 0), 0);
});

// ─── Serialization tests ─────────────────────────────────────────────────────

const fixtureAnalysis: LongitudinalAnalysis = {
  trends: [
    {
      metric: 'heart_rate',
      direction: 'stable',
      slope: -0.3,
      baselineMean: 75,
      baselineStdDev: 8,
      currentValue: 72,
      deviationFromBaseline: -0.4,
      windowDays: 7,
      dataPoints: 42,
    },
    {
      metric: 'oxygen_saturation',
      direction: 'decreasing',
      slope: -0.1,
      baselineMean: 97,
      baselineStdDev: 1,
      currentValue: 95,
      deviationFromBaseline: -2.0,
      windowDays: 7,
      dataPoints: 42,
    },
  ],
  anomalies: [
    {
      metric: 'heart_rate',
      recordedAt: '2026-08-15T14:30:00Z',
      value: 120,
      baselineMean: 75,
      baselineStdDev: 8,
      zScore: 5.6,
      severity: 'severe',
    },
  ],
  correlations: [
    {
      metricA: 'heart_rate',
      metricB: 'oxygen_saturation',
      correlation: -0.72,
      interpretation: 'negative',
    },
  ],
  windowDays: 7,
  totalReadings: 42,
};

test('serializeLongitudinalAnalysis includes the window header', () => {
  const text = serializeLongitudinalAnalysis(fixtureAnalysis);
  assert.ok(text.startsWith('Longitudinal analysis (7-day window, 42 readings)'));
});

test('serializeLongitudinalAnalysis lists each trend with slope, baseline and deviation', () => {
  const text = serializeLongitudinalAnalysis(fixtureAnalysis);
  assert.ok(
    text.includes('heart_rate: stable (slope: -0.3/day, baseline: 75±8 bpm, current: 72, deviation: -0.4σ)'),
  );
  assert.ok(
    text.includes('oxygen_saturation: decreasing (slope: -0.1/day, baseline: 97±1 %, current: 95, deviation: -2σ)'),
  );
});

test('serializeLongitudinalAnalysis lists each anomaly with severity', () => {
  const text = serializeLongitudinalAnalysis(fixtureAnalysis);
  assert.ok(
    text.includes('heart_rate at 2026-08-15T14:30:00Z: 120 (baseline: 75±8, z-score: +5.6, severe)'),
  );
});

test('serializeLongitudinalAnalysis lists each correlation with sign and interpretation', () => {
  const text = serializeLongitudinalAnalysis(fixtureAnalysis);
  assert.ok(
    text.includes('heart_rate vs oxygen_saturation: negative (r=-0.72)'),
  );
});

test('serializeLongitudinalAnalysis handles empty results with explanatory lines', () => {
  const empty: LongitudinalAnalysis = {
    trends: [],
    anomalies: [],
    correlations: [],
    windowDays: 7,
    totalReadings: 0,
  };
  const text = serializeLongitudinalAnalysis(empty);
  assert.ok(text.includes('Trends: insufficient data'));
  assert.ok(text.includes('Anomalies: none detected'));
  assert.ok(text.includes('Correlations: insufficient data'));
});

// ─── Mock database ───────────────────────────────────────────────────────────
//
// Same pattern as health-context.test.ts: a stub PostgresConnection that
// captures every query the analyzer emits so we can assert the SQL is
// properly scoped to the patient and the time window.

function createMockDatabase() {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const mockDb = {
    query: (text: string, values: readonly unknown[] = []) => {
      queries.push({ text, values });
      return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
    },
  };
  return { mockDb, queries };
}

// ─── Query-structure tests ───────────────────────────────────────────────────

test('LongitudinalAnalyzer only queries the given patientProfileId', async () => {
  const { mockDb, queries } = createMockDatabase();
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const patientA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await analyzer.analyze(patientA, new Date('2026-08-17T12:00:00Z'), 7);

  // Every query must use patientA as its first parameter ($1).
  for (const q of queries) {
    assert.equal(
      q.values[0], patientA,
      `query must be scoped to patient A, but was: ${q.values[0]}`,
    );
  }
  assert.ok(queries.length >= 1, 'must execute at least one vitals query');
});

test('LongitudinalAnalyzer passes the window start as the second parameter', async () => {
  const { mockDb, queries } = createMockDatabase();
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const now = new Date('2026-08-17T12:00:00Z');
  await analyzer.analyze('11111111-1111-1111-1111-111111111111', now, 7);

  // $2 must be the window start: now - 7 days.
  const expectedStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  for (const q of queries) {
    assert.ok(
      q.values[1] instanceof Date,
      'second parameter must be a Date (window start)',
    );
    assert.equal(
      (q.values[1] as Date).getTime(), expectedStart.getTime(),
      'second parameter must be exactly now - windowDays',
    );
  }
});

test('LongitudinalAnalyzer passes now as the third parameter', async () => {
  const { mockDb, queries } = createMockDatabase();
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const now = new Date('2026-08-17T12:00:00Z');
  await analyzer.analyze('22222222-2222-2222-2222-222222222222', now, 7);

  for (const q of queries) {
    assert.equal(
      q.values[2], now,
      'third parameter must be the reference now',
    );
  }
});

test('LongitudinalAnalyzer vitals query filters to valid and suspect quality only', async () => {
  const { mockDb, queries } = createMockDatabase();
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  await analyzer.analyze('33333333-3333-3333-3333-333333333333', new Date('2026-08-17T12:00:00Z'), 7);

  const vitalsQuery = queries.find((q) => q.text.includes('vital_readings'));
  assert.ok(vitalsQuery, 'must have a vitals query');
  assert.ok(
    vitalsQuery!.text.includes("'valid'") && vitalsQuery!.text.includes("'suspect'"),
    'vitals query must filter to valid and suspect quality only',
  );
  assert.ok(
    !vitalsQuery!.text.match(/\b'invalid'\b/) || vitalsQuery!.text.includes('NOT IN'),
    'vitals query must not include invalid quality',
  );
});

test('LongitudinalAnalyzer vitals query joins devices for source provenance', async () => {
  const { mockDb, queries } = createMockDatabase();
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  await analyzer.analyze('44444444-4444-4444-4444-444444444444', new Date('2026-08-17T12:00:00Z'), 7);

  const vitalsQuery = queries.find((q) => q.text.includes('vital_readings'));
  assert.ok(vitalsQuery, 'must have a vitals query');
  assert.ok(
    vitalsQuery!.text.includes('JOIN devices'),
    'vitals query must join devices for source inference',
  );
  assert.ok(
    vitalsQuery!.text.includes('device_type'),
    'vitals query must select device_type for source inference',
  );
});

test('LongitudinalAnalyzer vitals query scopes by patient_profile_id', async () => {
  const { mockDb, queries } = createMockDatabase();
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  await analyzer.analyze('55555555-5555-5555-5555-555555555555', new Date('2026-08-17T12:00:00Z'), 7);

  const vitalsQuery = queries.find((q) => q.text.includes('vital_readings'));
  assert.ok(vitalsQuery, 'must have a vitals query');
  assert.ok(
    vitalsQuery!.text.includes('patient_profile_id = $1'),
    'vitals query must scope by patient_profile_id = $1',
  );
  assert.ok(
    vitalsQuery!.text.includes('recorded_at >= $2'),
    'vitals query must filter recorded_at to the window start',
  );
  assert.ok(
    vitalsQuery!.text.includes('recorded_at <= $3'),
    'vitals query must filter recorded_at to the window end (now)',
  );
});

test('LongitudinalAnalyzer respects a 30-day window', async () => {
  const { mockDb, queries } = createMockDatabase();
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const now = new Date('2026-08-17T12:00:00Z');
  await analyzer.analyze('66666666-6666-6666-6666-666666666666', now, 30);

  const expectedStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  for (const q of queries) {
    assert.equal(
      (q.values[1] as Date).getTime(), expectedStart.getTime(),
      'second parameter must be now - 30 days for a 30-day window',
    );
  }
});

test('LongitudinalAnalyzer does not query for non-existent source column', async () => {
  const { mockDb, queries } = createMockDatabase();
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  await analyzer.analyze('77777777-7777-7777-7777-777777777777', new Date('2026-08-17T12:00:00Z'), 7);

  for (const q of queries) {
    if (q.text.includes('vital_readings')) {
      assert.ok(
        !q.text.match(/vr\.source\b/),
        'must not query non-existent source column on vital_readings',
      );
    }
  }
});

// ─── Functional tests with a mock that returns rows ──────────────────────────

test('LongitudinalAnalyzer returns empty results for a patient with no readings', async () => {
  const { mockDb } = createMockDatabase();
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyze(
    '88888888-8888-8888-8888-888888888888',
    new Date('2026-08-17T12:00:00Z'),
    7,
  );
  assert.equal(result.trends.length, 0);
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.correlations.length, 0);
  assert.equal(result.totalReadings, 0);
  assert.equal(result.windowDays, 7);
});

test('LongitudinalAnalyzer computes a stable trend for an unchanging metric', async () => {
  // 10 readings of heart_rate = 75, evenly spaced over the last 7 days.
  // The slope is 0, the deviation is 0, and the direction is 'stable'.
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  const rows = Array.from({ length: 10 }, (_, i) => ({
    metric: 'heart_rate',
    value: '75',
    unit: 'bpm',
    recordedAt: new Date(baseMs - (9 - i) * 12 * 60 * 60 * 1000).toISOString(),
    deviceType: 'vitals_monitor',
  }));

  const mockDb = {
    query: () => Promise.resolve({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }),
  };
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyze(
    '99999999-9999-9999-9999-999999999999',
    now,
    7,
  );

  assert.equal(result.trends.length, 1);
  const trend = result.trends[0]!;
  assert.equal(trend.metric, 'heart_rate');
  assert.equal(trend.direction, 'stable');
  assert.equal(trend.dataPoints, 10);
  assert.equal(trend.baselineMean, 75);
  assert.equal(trend.currentValue, 75);
  assert.equal(trend.deviationFromBaseline, 0);
  assert.equal(result.anomalies.length, 0, 'a constant series has no anomalies');
  assert.equal(result.correlations.length, 0, 'a single metric has no correlations');
});

test('LongitudinalAnalyzer detects an increasing trend with a positive slope', async () => {
  // 10 readings of body_temperature stepping up by 0.2 °C per day, over 7 days.
  // The slope should be approximately +0.2 / day, direction 'increasing'.
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  const rows = Array.from({ length: 10 }, (_, i) => ({
    metric: 'body_temperature',
    value: (36.5 + i * 0.2).toFixed(2),
    unit: '°C',
    recordedAt: new Date(baseMs - (9 - i) * 12 * 60 * 60 * 1000).toISOString(),
    deviceType: 'vitals_monitor',
  }));

  const mockDb = {
    query: () => Promise.resolve({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }),
  };
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyze(
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    now,
    7,
  );

  assert.equal(result.trends.length, 1);
  const trend = result.trends[0]!;
  assert.equal(trend.metric, 'body_temperature');
  assert.equal(trend.direction, 'increasing');
  assert.ok(
    trend.slope > 0.3 && trend.slope < 0.5,
    `slope was ${trend.slope}, expected approximately +0.4`,
  );
});

test('LongitudinalAnalyzer flags a single extreme reading as an anomaly', async () => {
  // 20 normal heart-rate readings at 75 bpm, then one extreme reading of 250.
  // 20 baseline values are enough to keep the stddev small relative to the
  // outlier, so 250 produces a z-score well above 4 (severe).
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  const normalValues = Array(20).fill(75);
  const rows = [
    ...normalValues.map((v, i) => ({
      metric: 'heart_rate',
      value: String(v),
      unit: 'bpm',
      recordedAt: new Date(baseMs - (normalValues.length - i) * 60 * 60 * 1000).toISOString(),
      deviceType: 'vitals_monitor',
    })),
    {
      metric: 'heart_rate',
      value: '250',
      unit: 'bpm',
      recordedAt: new Date(baseMs - 30 * 60 * 1000).toISOString(), // 30 minutes ago
      deviceType: 'vitals_monitor',
    },
  ];

  const mockDb = {
    query: () => Promise.resolve({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }),
  };
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyze(
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    now,
    7,
  );

  assert.equal(result.anomalies.length, 1, 'must detect exactly one anomaly');
  const anomaly = result.anomalies[0]!;
  assert.equal(anomaly.metric, 'heart_rate');
  assert.equal(anomaly.value, 250);
  assert.ok(anomaly.zScore > 2, 'anomaly z-score must exceed 2');
  assert.equal(
    anomaly.severity, 'severe',
    `anomaly should be severe, was ${anomaly.severity} (z=${anomaly.zScore})`,
  );
});

test('LongitudinalAnalyzer classifies anomaly severity by z-score band', async () => {
  // 50 readings at exactly 75 bpm establish a very tight baseline, then
  // one extreme reading at 200 bpm. With 50 constant values in the
  // baseline, the stddev is only inflated by the single outlier, so its
  // z-score sits well above 4 and the reading is classified 'severe'.
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  const rows = [
    ...Array.from({ length: 50 }, (_, i) => ({
      metric: 'heart_rate',
      value: '75',
      unit: 'bpm',
      recordedAt: new Date(baseMs - (50 - i) * 60 * 60 * 1000).toISOString(),
      deviceType: 'vitals_monitor',
    })),
    {
      metric: 'heart_rate',
      value: '200',
      unit: 'bpm',
      recordedAt: new Date(baseMs - 10 * 60 * 1000).toISOString(),
      deviceType: 'vitals_monitor',
    },
  ];

  const mockDb = {
    query: () => Promise.resolve({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }),
  };
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyze(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    now,
    7,
  );

  // The 200 reading should be an anomaly with z-score > 4 → severe.
  assert.ok(result.anomalies.length >= 1, 'must detect at least one anomaly');
  const severe = result.anomalies.find((a) => a.severity === 'severe');
  assert.ok(severe, 'a z-score well above 4 must be classified as severe');
  assert.ok(severe!.zScore > 4, `severe anomaly z-score must exceed 4, was ${severe!.zScore}`);
});

test('LongitudinalAnalyzer computes a negative Pearson correlation', async () => {
  // Two metrics, each with 6 readings, negatively correlated.
  // heart_rate rises while oxygen_saturation falls, at matching timestamps.
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  const hr = [70, 75, 80, 85, 90, 95];
  const spo2 = [98, 97, 96, 95, 94, 93];
  const rows: { metric: string; value: string; unit: string; recordedAt: string; deviceType: string }[] = [];
  for (let i = 0; i < 6; i += 1) {
    const ts = new Date(baseMs - (5 - i) * 60 * 60 * 1000).toISOString();
    rows.push({ metric: 'heart_rate', value: String(hr[i]!), unit: 'bpm', recordedAt: ts, deviceType: 'vitals_monitor' });
    rows.push({ metric: 'oxygen_saturation', value: String(spo2[i]!), unit: '%', recordedAt: ts, deviceType: 'pulse_oximeter' });
  }

  const mockDb = {
    query: () => Promise.resolve({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }),
  };
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyze(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    now,
    7,
  );

  assert.equal(result.trends.length, 2);
  assert.equal(result.correlations.length, 1);
  const corr = result.correlations[0]!;
  assert.equal(corr.metricA, 'heart_rate');
  assert.equal(corr.metricB, 'oxygen_saturation');
  assert.equal(corr.interpretation, 'negative');
  assert.ok(
    corr.correlation < -0.9,
    `correlation was ${corr.correlation}, expected close to -1`,
  );
});

test('LongitudinalAnalyzer does not compute a correlation for a metric with fewer than 5 points', async () => {
  // 6 heart_rate readings, only 3 oxygen_saturation readings.
  // Correlations require ≥ 5 points per metric, so the pair is excluded.
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  const rows: { metric: string; value: string; unit: string; recordedAt: string; deviceType: string }[] = [];
  for (let i = 0; i < 6; i += 1) {
    const ts = new Date(baseMs - (5 - i) * 60 * 60 * 1000).toISOString();
    rows.push({ metric: 'heart_rate', value: String(70 + i), unit: 'bpm', recordedAt: ts, deviceType: 'vitals_monitor' });
  }
  // Only 3 SpO₂ readings, none at the same timestamps as the heart_rate ones.
  for (let i = 0; i < 3; i += 1) {
    const ts = new Date(baseMs - (5 - i) * 30 * 60 * 1000).toISOString();
    rows.push({ metric: 'oxygen_saturation', value: String(98 - i), unit: '%', recordedAt: ts, deviceType: 'pulse_oximeter' });
  }

  const mockDb = {
    query: () => Promise.resolve({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }),
  };
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyze(
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    now,
    7,
  );

  assert.equal(result.trends.length, 2);
  assert.equal(result.correlations.length, 0, 'fewer than 5 SpO₂ points → no correlation');
});

test('LongitudinalAnalyzer does not emit a trend for a metric with fewer than 3 points', async () => {
  // Only 2 heart_rate readings — below the trend floor of 3.
  const now = new Date('2026-08-17T12:00:00Z');
  const baseMs = now.getTime();
  const rows = [
    { metric: 'heart_rate', value: '70', unit: 'bpm', recordedAt: new Date(baseMs - 60 * 60 * 1000).toISOString(), deviceType: 'vitals_monitor' },
    { metric: 'heart_rate', value: '75', unit: 'bpm', recordedAt: new Date(baseMs - 30 * 60 * 1000).toISOString(), deviceType: 'vitals_monitor' },
  ];

  const mockDb = {
    query: () => Promise.resolve({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }),
  };
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyze(
    '11112222-3333-4444-5555-666677778888',
    now,
    7,
  );

  assert.equal(result.trends.length, 0, 'only 2 readings is below the trend floor');
  assert.equal(result.totalReadings, 2);
});

// ─── Cross-patient isolation ─────────────────────────────────────────────────

test('LongitudinalAnalyzer never queries with a different patientProfileId', async () => {
  // A controlled mock that records every patientProfileId the analyzer
  // touches, then asserts the analyzer never queries for patientB. This
  // mirrors the health-context cross-patient isolation test.
  const seenProfileIds: string[] = [];
  const mockDb = {
    query: (text: string, values: readonly unknown[] = []) => {
      // $1 is the patientProfileId in the vitals query.
      if (typeof values[0] === 'string') {
        seenProfileIds.push(values[0]);
      }
      return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
    },
  };
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const patientA = 'aaaaaaaa-1111-2222-3333-444444444444';
  const patientB = 'bbbbbbbb-1111-2222-3333-444444444444';

  await analyzer.analyze(patientA, new Date('2026-08-17T12:00:00Z'), 7);
  assert.ok(seenProfileIds.length >= 1, 'analyzer must execute at least one query');
  for (const id of seenProfileIds) {
    assert.equal(id, patientA, `analyzer queried with ${id}, expected only patientA`);
    assert.notEqual(id, patientB, 'analyzer must never query for patientB');
  }
});

// ─── Rich analysis (analyzeRich) tests ──────────────────────────────────────
//
// The mock databases below return different rows depending on which window is
// being queried. `fetchReadings` passes [patientProfileId, windowStart, now] as
// values; `values[2]` is the `now` parameter, which differs between the
// current window and the previous window. We use this to differentiate.

const RICH_PATIENT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const RICH_NOW = new Date('2026-08-17T12:00:00Z');
const RICH_WINDOW = 7;
const RICH_PREV_NOW = new Date(RICH_NOW.getTime() - RICH_WINDOW * 24 * 60 * 60 * 1000);

/**
 * Creates a mock database that returns `currentRows` for the current-window
 * query (values[2] === RICH_NOW) and `previousRows` for the previous-window
 * query (values[2] === RICH_PREV_NOW). This mirrors how `analyzeRich`
 * fetches two windows.
 */
function createRichMockDb(
  currentRows: readonly { metric: string; value: string; unit: string; recordedAt: string; deviceType: string }[],
  previousRows: readonly { metric: string; value: string; unit: string; recordedAt: string; deviceType: string }[] = [],
) {
  const mockDb = {
    query: (_text: string, values: readonly unknown[] = []) => {
      const nowParam = values[2];
      if (nowParam instanceof Date && nowParam.getTime() === RICH_PREV_NOW.getTime()) {
        return Promise.resolve({ rows: [...previousRows], rowCount: previousRows.length, command: '', oid: 0, fields: [] });
      }
      return Promise.resolve({ rows: [...currentRows], rowCount: currentRows.length, command: '', oid: 0, fields: [] });
    },
  };
  return mockDb;
}

/**
 * Builds N readings of a metric with the given values at the specified UTC
 * hours, spread across the window ending at RICH_NOW.
 */
function readingsAtHours(
  metric: string,
  unit: string,
  deviceType: string,
  hoursAndValues: { hour: number; value: number; dayOffset: number }[],
): { metric: string; value: string; unit: string; recordedAt: string; deviceType: string }[] {
  return hoursAndValues.map(({ hour, value, dayOffset }) => {
    const d = new Date(RICH_NOW.getTime() - dayOffset * 24 * 60 * 60 * 1000);
    d.setUTCHours(hour, 0, 0, 0);
    return {
      metric,
      value: String(value),
      unit,
      recordedAt: d.toISOString(),
      deviceType,
    };
  });
}

// ─── Seasonal pattern detection ─────────────────────────────────────────────

test('analyzeRich detects an evening_high seasonal pattern', async () => {
  // Heart rate readings across 3 days at different hours.
  // Evening (18:00) readings are consistently higher than other periods.
  const currentRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 8, value: 70, dayOffset: 2 },   // morning
    { hour: 8, value: 72, dayOffset: 1 },   // morning
    { hour: 8, value: 71, dayOffset: 0 },   // morning
    { hour: 14, value: 73, dayOffset: 2 },  // afternoon
    { hour: 14, value: 74, dayOffset: 1 },  // afternoon
    { hour: 14, value: 73, dayOffset: 0 },  // afternoon
    { hour: 20, value: 90, dayOffset: 2 },  // evening
    { hour: 20, value: 92, dayOffset: 1 },  // evening
    { hour: 20, value: 91, dayOffset: 0 },  // evening
    { hour: 2, value: 60, dayOffset: 2 },   // night
    { hour: 2, value: 62, dayOffset: 1 },   // night
    { hour: 2, value: 61, dayOffset: 0 },   // night
  ]);

  const mockDb = createRichMockDb(currentRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  assert.ok(result.seasonalPatterns.length > 0, 'must produce at least one seasonal pattern');
  const hrPattern = result.seasonalPatterns.find((sp) => sp.metric === 'heart_rate');
  assert.ok(hrPattern, 'must have a heart_rate seasonal pattern');
  assert.equal(hrPattern!.dayPattern, 'evening_high');
  assert.ok(hrPattern!.eveningMean > hrPattern!.morningMean, 'evening mean must exceed morning mean');
  assert.ok(hrPattern!.eveningMean > hrPattern!.afternoonMean, 'evening mean must exceed afternoon mean');
  assert.ok(hrPattern!.eveningMean > hrPattern!.nightMean, 'evening mean must exceed night mean');
});

test('analyzeRich detects a morning_high seasonal pattern', async () => {
  // Heart rate readings: morning is highest.
  const currentRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 8, value: 95, dayOffset: 2 },
    { hour: 8, value: 93, dayOffset: 1 },
    { hour: 8, value: 94, dayOffset: 0 },
    { hour: 14, value: 72, dayOffset: 2 },
    { hour: 14, value: 73, dayOffset: 1 },
    { hour: 14, value: 71, dayOffset: 0 },
    { hour: 20, value: 70, dayOffset: 2 },
    { hour: 20, value: 72, dayOffset: 1 },
    { hour: 20, value: 71, dayOffset: 0 },
    { hour: 2, value: 60, dayOffset: 2 },
    { hour: 2, value: 62, dayOffset: 1 },
    { hour: 2, value: 61, dayOffset: 0 },
  ]);

  const mockDb = createRichMockDb(currentRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  const hrPattern = result.seasonalPatterns.find((sp) => sp.metric === 'heart_rate');
  assert.ok(hrPattern, 'must have a heart_rate seasonal pattern');
  assert.equal(hrPattern!.dayPattern, 'morning_high');
});

test('analyzeRich classifies a flat seasonal pattern when all periods are similar', async () => {
  // All readings are 75 bpm regardless of time of day.
  const currentRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 8, value: 75, dayOffset: 2 },
    { hour: 8, value: 75, dayOffset: 1 },
    { hour: 8, value: 75, dayOffset: 0 },
    { hour: 14, value: 75, dayOffset: 2 },
    { hour: 14, value: 75, dayOffset: 1 },
    { hour: 14, value: 75, dayOffset: 0 },
    { hour: 20, value: 75, dayOffset: 2 },
    { hour: 20, value: 75, dayOffset: 1 },
    { hour: 20, value: 75, dayOffset: 0 },
    { hour: 2, value: 75, dayOffset: 2 },
    { hour: 2, value: 75, dayOffset: 1 },
    { hour: 2, value: 75, dayOffset: 0 },
  ]);

  const mockDb = createRichMockDb(currentRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  const hrPattern = result.seasonalPatterns.find((sp) => sp.metric === 'heart_rate');
  assert.ok(hrPattern, 'must have a heart_rate seasonal pattern');
  assert.equal(hrPattern!.dayPattern, 'flat');
});

// ─── Window comparison ──────────────────────────────────────────────────────

test('analyzeRich computes window comparison with improving direction for lower HR', async () => {
  // Current window: HR around 70; previous window: HR around 80.
  // Lower HR is improving → direction should be 'improving'.
  const currentRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 10, value: 70, dayOffset: 2 },
    { hour: 10, value: 71, dayOffset: 1 },
    { hour: 10, value: 69, dayOffset: 0 },
  ]);
  const previousRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 10, value: 80, dayOffset: 5 },
    { hour: 10, value: 81, dayOffset: 4 },
    { hour: 10, value: 79, dayOffset: 3 },
  ]);

  const mockDb = createRichMockDb(currentRows, previousRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  assert.ok(result.windowComparison.length > 0, 'must have at least one window comparison');
  const hrComp = result.windowComparison.find((c) => c.metric === 'heart_rate');
  assert.ok(hrComp, 'must have a heart_rate comparison');
  assert.equal(hrComp!.direction, 'improving', 'lower HR should be improving');
  assert.ok(hrComp!.changePercent < 0, 'change should be negative (decrease)');
  assert.ok(hrComp!.currentWindowMean < hrComp!.previousWindowMean, 'current mean must be lower');
});

test('analyzeRich computes window comparison with worsening direction for lower SpO₂', async () => {
  // Current window: SpO₂ around 90; previous window: SpO₂ around 97.
  // Lower SpO₂ is worsening → direction should be 'worsening'.
  const currentRows = readingsAtHours('oxygen_saturation', '%', 'pulse_oximeter', [
    { hour: 10, value: 90, dayOffset: 2 },
    { hour: 10, value: 91, dayOffset: 1 },
    { hour: 10, value: 89, dayOffset: 0 },
  ]);
  const previousRows = readingsAtHours('oxygen_saturation', '%', 'pulse_oximeter', [
    { hour: 10, value: 97, dayOffset: 5 },
    { hour: 10, value: 98, dayOffset: 4 },
    { hour: 10, value: 96, dayOffset: 3 },
  ]);

  const mockDb = createRichMockDb(currentRows, previousRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  const spo2Comp = result.windowComparison.find((c) => c.metric === 'oxygen_saturation');
  assert.ok(spo2Comp, 'must have an oxygen_saturation comparison');
  assert.equal(spo2Comp!.direction, 'worsening', 'lower SpO₂ should be worsening');
  assert.ok(spo2Comp!.changePercent < 0, 'change should be negative (decrease)');
});

test('analyzeRich classifies stable when change is below the significance threshold', async () => {
  // Current window: HR around 75.5; previous window: HR around 75.
  // Change is < 1%, well below the 5% threshold → stable.
  const currentRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 10, value: 75, dayOffset: 2 },
    { hour: 10, value: 76, dayOffset: 1 },
    { hour: 10, value: 75, dayOffset: 0 },
  ]);
  const previousRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 10, value: 75, dayOffset: 5 },
    { hour: 10, value: 75, dayOffset: 4 },
    { hour: 10, value: 75, dayOffset: 3 },
  ]);

  const mockDb = createRichMockDb(currentRows, previousRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  const hrComp = result.windowComparison.find((c) => c.metric === 'heart_rate');
  assert.ok(hrComp, 'must have a heart_rate comparison');
  assert.equal(hrComp!.direction, 'stable', 'small change should be stable');
});

// ─── Health trajectory ──────────────────────────────────────────────────────

test('analyzeRich classifies improving trajectory when most metrics improve', async () => {
  // Two metrics, both improving: HR decreasing, SpO₂ increasing.
  const currentRows = [
    ...readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
      { hour: 10, value: 65, dayOffset: 2 },
      { hour: 10, value: 66, dayOffset: 1 },
      { hour: 10, value: 64, dayOffset: 0 },
    ]),
    ...readingsAtHours('oxygen_saturation', '%', 'pulse_oximeter', [
      { hour: 10, value: 98, dayOffset: 2 },
      { hour: 10, value: 99, dayOffset: 1 },
      { hour: 10, value: 98, dayOffset: 0 },
    ]),
  ];
  const previousRows = [
    ...readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
      { hour: 10, value: 85, dayOffset: 5 },
      { hour: 10, value: 86, dayOffset: 4 },
      { hour: 10, value: 84, dayOffset: 3 },
    ]),
    ...readingsAtHours('oxygen_saturation', '%', 'pulse_oximeter', [
      { hour: 10, value: 93, dayOffset: 5 },
      { hour: 10, value: 94, dayOffset: 4 },
      { hour: 10, value: 92, dayOffset: 3 },
    ]),
  ];

  const mockDb = createRichMockDb(currentRows, previousRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  assert.equal(result.healthTrajectory, 'improving');
  assert.ok(result.trajectoryDescription.length > 0, 'trajectory description must not be empty');
});

test('analyzeRich classifies declining trajectory when most metrics worsen', async () => {
  // Two metrics, both worsening: HR increasing, SpO₂ decreasing.
  const currentRows = [
    ...readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
      { hour: 10, value: 95, dayOffset: 2 },
      { hour: 10, value: 96, dayOffset: 1 },
      { hour: 10, value: 94, dayOffset: 0 },
    ]),
    ...readingsAtHours('oxygen_saturation', '%', 'pulse_oximeter', [
      { hour: 10, value: 90, dayOffset: 2 },
      { hour: 10, value: 91, dayOffset: 1 },
      { hour: 10, value: 89, dayOffset: 0 },
    ]),
  ];
  const previousRows = [
    ...readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
      { hour: 10, value: 70, dayOffset: 5 },
      { hour: 10, value: 71, dayOffset: 4 },
      { hour: 10, value: 69, dayOffset: 3 },
    ]),
    ...readingsAtHours('oxygen_saturation', '%', 'pulse_oximeter', [
      { hour: 10, value: 97, dayOffset: 5 },
      { hour: 10, value: 98, dayOffset: 4 },
      { hour: 10, value: 96, dayOffset: 3 },
    ]),
  ];

  const mockDb = createRichMockDb(currentRows, previousRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  assert.equal(result.healthTrajectory, 'declining');
});

test('analyzeRich classifies volatile trajectory with mixed improving and worsening', async () => {
  // HR worsening (increasing), SpO₂ improving (increasing) → mixed signals → volatile.
  const currentRows = [
    ...readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
      { hour: 10, value: 95, dayOffset: 2 },
      { hour: 10, value: 96, dayOffset: 1 },
      { hour: 10, value: 94, dayOffset: 0 },
    ]),
    ...readingsAtHours('oxygen_saturation', '%', 'pulse_oximeter', [
      { hour: 10, value: 98, dayOffset: 2 },
      { hour: 10, value: 99, dayOffset: 1 },
      { hour: 10, value: 98, dayOffset: 0 },
    ]),
  ];
  const previousRows = [
    ...readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
      { hour: 10, value: 70, dayOffset: 5 },
      { hour: 10, value: 71, dayOffset: 4 },
      { hour: 10, value: 69, dayOffset: 3 },
    ]),
    ...readingsAtHours('oxygen_saturation', '%', 'pulse_oximeter', [
      { hour: 10, value: 92, dayOffset: 5 },
      { hour: 10, value: 93, dayOffset: 4 },
      { hour: 10, value: 91, dayOffset: 3 },
    ]),
  ];

  const mockDb = createRichMockDb(currentRows, previousRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  assert.equal(result.healthTrajectory, 'volatile');
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

test('analyzeRich returns stable trajectory with no previous window data', async () => {
  // Current window has data, previous window is empty.
  const currentRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 10, value: 75, dayOffset: 2 },
    { hour: 10, value: 75, dayOffset: 1 },
    { hour: 10, value: 75, dayOffset: 0 },
  ]);

  const mockDb = createRichMockDb(currentRows, []);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  assert.equal(result.windowComparison.length, 0, 'no previous data → no comparisons');
  assert.equal(result.healthTrajectory, 'stable');
  assert.ok(result.seasonalPatterns.length > 0, 'seasonal patterns still computed from current data');
});

test('analyzeRich returns stable trajectory with all flat readings', async () => {
  // Both windows have constant readings at the same value.
  const currentRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 10, value: 75, dayOffset: 2 },
    { hour: 10, value: 75, dayOffset: 1 },
    { hour: 10, value: 75, dayOffset: 0 },
  ]);
  const previousRows = readingsAtHours('heart_rate', 'bpm', 'vitals_monitor', [
    { hour: 10, value: 75, dayOffset: 5 },
    { hour: 10, value: 75, dayOffset: 4 },
    { hour: 10, value: 75, dayOffset: 3 },
  ]);

  const mockDb = createRichMockDb(currentRows, previousRows);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  assert.equal(result.healthTrajectory, 'stable');
  assert.ok(result.windowComparison.length > 0, 'window comparison exists when both windows have data');
  const hrComp = result.windowComparison.find((c) => c.metric === 'heart_rate');
  assert.ok(hrComp, 'must have a heart_rate comparison');
  assert.equal(hrComp!.direction, 'stable', 'no change → stable');
  assert.equal(hrComp!.changePercent, 0, 'change percent must be exactly 0');
  const hrPattern = result.seasonalPatterns.find((sp) => sp.metric === 'heart_rate');
  assert.ok(hrPattern, 'must have a heart_rate seasonal pattern');
  assert.equal(hrPattern!.dayPattern, 'flat');
});

test('analyzeRich returns empty results for a patient with no readings at all', async () => {
  const mockDb = createRichMockDb([], []);
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const result = await analyzer.analyzeRich(RICH_PATIENT, RICH_NOW, RICH_WINDOW);

  assert.equal(result.trends.length, 0);
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.correlations.length, 0);
  assert.equal(result.seasonalPatterns.length, 0);
  assert.equal(result.windowComparison.length, 0);
  assert.equal(result.totalReadings, 0);
  assert.equal(result.healthTrajectory, 'stable');
});

// ─── Rich serialization ─────────────────────────────────────────────────────

test('serializeRichLongitudinalAnalysis includes seasonal patterns section', () => {
  const analysis: RichLongitudinalAnalysis = {
    trends: [],
    anomalies: [],
    correlations: [],
    windowDays: 7,
    totalReadings: 0,
    seasonalPatterns: [
      {
        metric: 'heart_rate',
        dayPattern: 'evening_high',
        morningMean: 70,
        afternoonMean: 73,
        eveningMean: 91,
        nightMean: 61,
        description: 'Heart rate tends to be highest in the evening (91), suggesting end-of-day stress or fatigue.',
      },
    ],
    windowComparison: [],
    healthTrajectory: 'stable',
    trajectoryDescription: 'Health indicators are stable.',
  };
  const text = serializeRichLongitudinalAnalysis(analysis);
  assert.ok(text.includes('Seasonal patterns:'), 'must include seasonal patterns header');
  assert.ok(text.includes('heart_rate: evening_high'), 'must include the pattern classification');
  assert.ok(text.includes('morning: 70'), 'must include morning mean');
  assert.ok(text.includes('evening: 91'), 'must include evening mean');
});

test('serializeRichLongitudinalAnalysis includes window comparison section', () => {
  const analysis: RichLongitudinalAnalysis = {
    trends: [],
    anomalies: [],
    correlations: [],
    windowDays: 7,
    totalReadings: 0,
    seasonalPatterns: [],
    windowComparison: [
      {
        metric: 'heart_rate',
        currentWindowMean: 70,
        previousWindowMean: 80,
        changePercent: -12.5,
        direction: 'improving',
        interpretation: 'Heart rate improved by -12.5% compared to the previous window.',
      },
    ],
    healthTrajectory: 'improving',
    trajectoryDescription: 'Health indicators are trending favourably.',
  };
  const text = serializeRichLongitudinalAnalysis(analysis);
  assert.ok(text.includes('Window comparison:'), 'must include window comparison header');
  assert.ok(text.includes('heart_rate: improving'), 'must include the direction');
  assert.ok(text.includes('current: 70'), 'must include current window mean');
  assert.ok(text.includes('previous: 80'), 'must include previous window mean');
  assert.ok(text.includes('-12.5%'), 'must include the change percent');
});

test('serializeRichLongitudinalAnalysis includes health trajectory section', () => {
  const analysis: RichLongitudinalAnalysis = {
    trends: [],
    anomalies: [],
    correlations: [],
    windowDays: 7,
    totalReadings: 0,
    seasonalPatterns: [],
    windowComparison: [],
    healthTrajectory: 'declining',
    trajectoryDescription: 'Health indicators are trending unfavourably.',
  };
  const text = serializeRichLongitudinalAnalysis(analysis);
  assert.ok(text.includes('Health trajectory: declining'), 'must include trajectory label');
  assert.ok(text.includes('Health indicators are trending unfavourably.'), 'must include trajectory description');
});

test('serializeRichLongitudinalAnalysis handles empty sections gracefully', () => {
  const analysis: RichLongitudinalAnalysis = {
    trends: [],
    anomalies: [],
    correlations: [],
    windowDays: 7,
    totalReadings: 0,
    seasonalPatterns: [],
    windowComparison: [],
    healthTrajectory: 'stable',
    trajectoryDescription: 'Health indicators are stable.',
  };
  const text = serializeRichLongitudinalAnalysis(analysis);
  assert.ok(text.includes('insufficient data'), 'empty seasonal patterns must show insufficient data');
  assert.ok(text.includes('no previous window data'), 'empty window comparison must show no data message');
});

test('serializeRichLongitudinalAnalysis includes base analysis content', () => {
  const analysis: RichLongitudinalAnalysis = {
    trends: [
      {
        metric: 'heart_rate',
        direction: 'stable',
        slope: -0.3,
        baselineMean: 75,
        baselineStdDev: 8,
        currentValue: 72,
        deviationFromBaseline: -0.4,
        windowDays: 7,
        dataPoints: 42,
      },
    ],
    anomalies: [],
    correlations: [],
    windowDays: 7,
    totalReadings: 42,
    seasonalPatterns: [],
    windowComparison: [],
    healthTrajectory: 'stable',
    trajectoryDescription: 'Health indicators are stable.',
  };
  const text = serializeRichLongitudinalAnalysis(analysis);
  assert.ok(text.includes('Longitudinal analysis (7-day window'), 'must include base analysis header');
  assert.ok(text.includes('heart_rate: stable'), 'must include base trend content');
});

// ─── Rich analysis cross-patient isolation ──────────────────────────────────

test('analyzeRich never queries with a different patientProfileId', async () => {
  const seenProfileIds: string[] = [];
  const mockDb = {
    query: (_text: string, values: readonly unknown[] = []) => {
      if (typeof values[0] === 'string') {
        seenProfileIds.push(values[0]);
      }
      return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
    },
  };
  const analyzer = new LongitudinalAnalyzer(mockDb as never);
  const patientA = 'aaaaaaaa-1111-2222-3333-444444444444';
  const patientB = 'bbbbbbbb-1111-2222-3333-444444444444';

  await analyzer.analyzeRich(patientA, new Date('2026-08-17T12:00:00Z'), 7);
  assert.ok(seenProfileIds.length >= 2, 'analyzeRich must execute at least two queries (current + previous window)');
  for (const id of seenProfileIds) {
    assert.equal(id, patientA, `analyzeRich queried with ${id}, expected only patientA`);
    assert.notEqual(id, patientB, 'analyzeRich must never query for patientB');
  }
});
