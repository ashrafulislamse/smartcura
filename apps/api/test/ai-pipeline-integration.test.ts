import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MockLlmProvider,
  type LlmGenerationRequest,
  type PatientRiskProfile,
  type AnomalyReport,
  type RichLongitudinalAnalysis,
  evaluateSafety,
  safetyBlocks,
} from '@smartcura/database/ai';

const chunkId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d63';

const baseRequest: LlmGenerationRequest = {
  artifactType: 'symptom_summary',
  turns: [{ role: 'patient', content: 'I have been feeling dizzy today.' }],
  citations: [{ chunkId, rank: 1, similarity: null }],
  promptTemplateKey: 'symptom_summary_v1',
  promptTemplateVersion: 1,
};

// ─── AI-9 context fixtures ───────────────────────────────────────────────────

const sampleRiskProfile: PatientRiskProfile = {
  patientProfileId: '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d62',
  overallRiskScore: 42,
  overallRiskLevel: 'moderate',
  riskScores: [
    {
      riskType: 'cardiovascular',
      score: 35,
      level: 'moderate',
      factors: [
        { name: 'hypertension', contribution: 20, detail: 'Active condition' },
        { name: 'elevated_hr', contribution: 15, detail: 'Mean HR 95 bpm' },
      ],
      recommendation: 'Consider discussing blood pressure management with your doctor.',
      computedAt: '2026-08-18T10:00:00Z',
    },
    {
      riskType: 'fall',
      score: 12,
      level: 'low',
      factors: [],
      recommendation: 'No fall risk factors identified.',
      computedAt: '2026-08-18T10:00:00Z',
    },
  ],
  computedAt: '2026-08-18T10:00:00Z',
};

const sampleAnomalyReport: AnomalyReport = {
  anomalies: [
    {
      metric: 'heart_rate',
      anomalyType: 'sustained_elevation',
      severity: 'moderate',
      startTime: '2026-08-17T08:00:00Z',
      endTime: '2026-08-17T12:00:00Z',
      description: 'Heart rate remained above 100 bpm for 4 hours.',
      relatedConditions: ['hypertension'],
    },
    {
      metric: 'oxygen_saturation',
      anomalyType: 'acute_spike',
      severity: 'mild',
      startTime: '2026-08-17T14:00:00Z',
      endTime: '2026-08-17T14:05:00Z',
      description: 'Brief SpO₂ spike to 99%.',
      relatedConditions: [],
    },
  ],
  windowDays: 7,
  totalReadingsAnalyzed: 120,
};

const sampleRichLongitudinalAnalysis: RichLongitudinalAnalysis = {
  trends: [
    {
      metric: 'heart_rate',
      direction: 'increasing',
      slope: 0.5,
      rSquared: 0.72,
      meanValue: 82,
      stdDev: 8.5,
      unit: 'bpm',
      interpretation: 'Heart rate shows a gradual upward trend over the analysis window.',
    },
  ],
  anomalies: [],
  correlations: [],
  windowDays: 7,
  readingCount: 120,
  seasonalPatterns: [
    {
      metric: 'heart_rate',
      dayPattern: 'morning_high',
      morningMean: 88,
      afternoonMean: 80,
      eveningMean: 78,
      nightMean: 70,
      description: 'Heart rate is highest in the morning.',
    },
  ],
  windowComparison: [
    {
      metric: 'heart_rate',
      currentWindowMean: 84,
      previousWindowMean: 80,
      changePercent: 5.0,
      direction: 'worsening',
      interpretation: 'Heart rate has increased by 5% compared to the previous week.',
    },
  ],
  healthTrajectory: 'declining',
  trajectoryDescription: 'Overall health trajectory shows a slight decline driven by increasing heart rate.',
};

// ─── Mock provider echo tests ────────────────────────────────────────────────

test('mock provider echoes risk profile presence when provided', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({ ...baseRequest, riskProfile: sampleRiskProfile });
  assert.equal(result.content['risk_profile_present'], true);
  assert.ok(result.content['risk_profile_summary'] !== null, 'summary must not be null');
});

test('mock provider reports absent risk profile when not provided', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate(baseRequest);
  assert.equal(result.content['risk_profile_present'], false);
  assert.equal(result.content['risk_profile_summary'], null);
});

test('mock provider risk profile summary has correct fields', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({ ...baseRequest, riskProfile: sampleRiskProfile });
  const summary = result.content['risk_profile_summary'] as Record<string, unknown>;
  assert.equal(summary['overall_score'], 42);
  assert.equal(summary['overall_level'], 'moderate');
  assert.equal(summary['domain_count'], 2);
  assert.deepEqual(summary['domains'], ['cardiovascular', 'fall']);
});

test('mock provider echoes anomaly report presence when provided', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({ ...baseRequest, anomalyReport: sampleAnomalyReport });
  assert.equal(result.content['anomaly_report_present'], true);
  assert.ok(result.content['anomaly_report_summary'] !== null, 'summary must not be null');
});

test('mock provider reports absent anomaly report when not provided', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate(baseRequest);
  assert.equal(result.content['anomaly_report_present'], false);
  assert.equal(result.content['anomaly_report_summary'], null);
});

test('mock provider anomaly report summary has correct fields', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({ ...baseRequest, anomalyReport: sampleAnomalyReport });
  const summary = result.content['anomaly_report_summary'] as Record<string, unknown>;
  assert.equal(summary['anomaly_count'], 2);
  assert.equal(summary['window_days'], 7);
  assert.equal(summary['total_readings'], 120);
});

test('mock provider echoes longitudinal analysis presence when provided', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({
    ...baseRequest,
    richLongitudinalAnalysis: sampleRichLongitudinalAnalysis,
  });
  assert.equal(result.content['longitudinal_analysis_present'], true);
  assert.ok(result.content['longitudinal_analysis_summary'] !== null, 'summary must not be null');
});

test('mock provider reports absent longitudinal analysis when not provided', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate(baseRequest);
  assert.equal(result.content['longitudinal_analysis_present'], false);
  assert.equal(result.content['longitudinal_analysis_summary'], null);
});

test('mock provider longitudinal analysis summary has correct fields', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({
    ...baseRequest,
    richLongitudinalAnalysis: sampleRichLongitudinalAnalysis,
  });
  const summary = result.content['longitudinal_analysis_summary'] as Record<string, unknown>;
  assert.equal(summary['trajectory'], 'declining');
  assert.equal(summary['trend_count'], 1);
  assert.equal(summary['seasonal_pattern_count'], 1);
  assert.equal(summary['window_comparison_count'], 1);
});

// ─── Combined context tests ──────────────────────────────────────────────────

test('mock provider with all AI-9 context fields still passes safety filter', async () => {
  const provider = new MockLlmProvider();
  const result = await provider.generate({
    ...baseRequest,
    riskProfile: sampleRiskProfile,
    anomalyReport: sampleAnomalyReport,
    richLongitudinalAnalysis: sampleRichLongitudinalAnalysis,
  });
  assert.equal(safetyBlocks(evaluateSafety(result.content)), false);
});

test('mock provider with all AI-9 context fields remains deterministic', async () => {
  const provider = new MockLlmProvider();
  const left = await provider.generate({
    ...baseRequest,
    riskProfile: sampleRiskProfile,
    anomalyReport: sampleAnomalyReport,
    richLongitudinalAnalysis: sampleRichLongitudinalAnalysis,
  });
  const right = await provider.generate({
    ...baseRequest,
    riskProfile: sampleRiskProfile,
    anomalyReport: sampleAnomalyReport,
    richLongitudinalAnalysis: sampleRichLongitudinalAnalysis,
  });
  assert.deepEqual(left, right);
});

test('mock provider prompt tokens increase with AI-9 context fields', async () => {
  const provider = new MockLlmProvider();
  const without = await provider.generate(baseRequest);
  const withAll = await provider.generate({
    ...baseRequest,
    riskProfile: sampleRiskProfile,
    anomalyReport: sampleAnomalyReport,
    richLongitudinalAnalysis: sampleRichLongitudinalAnalysis,
  });
  assert.ok(
    withAll.promptTokens > without.promptTokens,
    'prompt tokens must increase when AI-9 context is added',
  );
});
