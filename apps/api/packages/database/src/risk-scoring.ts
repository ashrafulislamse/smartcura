/**
 * RiskScoringEngine & AdvancedAnomalyDetector — predictive risk scoring and
 * advanced anomaly detection for the SmartCura AI pipeline.
 *
 * Phase AI-9 of the SmartCura AI Master Plan. This module sits alongside
 * HealthContextBuilder and LongitudinalAnalyzer in the AI pipeline:
 *
 *   - HealthContextBuilder: last 24h snapshot of patient data
 *   - LongitudinalAnalyzer: 7-30 day statistical trends and anomalies
 *   - RiskScoringEngine: multi-domain risk scores derived from vitals + conditions
 *   - AdvancedAnomalyDetector: condition-aware anomaly pattern detection
 *
 * All scores and anomalies are derived at query time and never cached. Every
 * query is scoped to a single patientProfileId — cross-patient access is
 * impossible by construction, matching the authorization model of
 * HealthContextBuilder and LongitudinalAnalyzer.
 *
 * Schema notes (same as health-context and longitudinal-analysis):
 *   - vital_readings has NO source column. Source is inferred from
 *     devices.device_type via the shared `inferSource` helper.
 *   - profiles has NO date_of_birth or sex column. Age and sex are not
 *     available; the fall risk score skips the age factor for this reason.
 *   - patient_conditions are soft-deleted (filter deleted_at IS NULL).
 *   - Medications come from prescriptions (status='signed') JOIN
 *     prescription_items — there is no patient_medications table.
 *
 * Medical disclaimer: all scores and recommendations are NON-DIAGNOSTIC.
 * They are care suggestions for the LLM to reference, not clinical
 * assessments. Every recommendation says "consider consulting your doctor",
 * never "you have X".
 */

import type { PostgresConnection } from './connection.js';
import type { QueryResultRow } from 'pg';
import { inferSource } from './health-context.js';
import { mean, stddev, linearRegressionSlope, zScore } from './longitudinal-analysis.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RiskFactor {
  readonly name: string;
  readonly contribution: number;
  readonly detail: string;
}

export interface RiskScore {
  readonly riskType: string;
  readonly score: number;
  readonly level: 'low' | 'moderate' | 'high' | 'critical';
  readonly factors: readonly RiskFactor[];
  readonly recommendation: string;
  readonly computedAt: string;
}

export interface PatientRiskProfile {
  readonly patientProfileId: string;
  readonly overallRiskScore: number;
  readonly overallRiskLevel: 'low' | 'moderate' | 'high' | 'critical';
  readonly riskScores: readonly RiskScore[];
  readonly computedAt: string;
}

export interface AdvancedAnomaly {
  readonly metric: string;
  readonly anomalyType: string;
  readonly severity: 'mild' | 'moderate' | 'severe';
  readonly startTime: string;
  readonly endTime: string;
  readonly description: string;
  readonly relatedConditions: readonly string[];
}

export interface AnomalyReport {
  readonly anomalies: readonly AdvancedAnomaly[];
  readonly windowDays: number;
  readonly totalReadingsAnalyzed: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RISK_WINDOW_DAYS = 7;
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const MIN_POINTS = 3;
const SUSTAINED_ELEVATION_HOURS = 1;
const SUSTAINED_ELEVATION_Z = 2;
const ACUTE_SPIKE_Z = 4;
const PROGRESSIVE_DECLINE_SLOPE = -0.5;
const ERRATIC_CV_THRESHOLD = 0.30;
const CYCLICAL_VARIATION_FRACTION = 0.15;

const RISK_WEIGHTS: Readonly<Record<string, number>> = {
  cardiovascular: 0.30,
  fall: 0.20,
  medication_adherence: 0.20,
  respiratory: 0.30,
};

const METRIC_CONDITION_KEYWORDS: ReadonlyMap<string, readonly string[]> = new Map([
  ['heart_rate', ['hypertension', 'arrhythmia', 'coronary', 'heart', 'cardiac', 'tachycardia', 'bradycardia']],
  ['oxygen_saturation', ['asthma', 'copd', 'sleep apnea', 'respiratory', 'pulmonary', 'lung', 'pneumonia']],
  ['systolic_bp', ['hypertension', 'blood pressure', 'cardiac']],
  ['diastolic_bp', ['hypertension', 'blood pressure', 'cardiac']],
  ['respiratory_rate', ['asthma', 'copd', 'respiratory', 'pulmonary', 'pneumonia']],
  ['body_temperature', ['infection', 'fever', 'sepsis', 'thyroid']],
]);

// ─── Query row types ─────────────────────────────────────────────────────────

interface VitalRow extends QueryResultRow {
  readonly metric: string;
  readonly value: string;
  readonly unit: string;
  readonly recordedAt: string;
  readonly quality: string;
  readonly deviceType: string;
}

interface ConditionNameRow extends QueryResultRow {
  readonly conditionName: string;
}

interface MedicationRow extends QueryResultRow {
  readonly medicationText: string;
  readonly doseValue: string;
  readonly doseUnit: string;
  readonly frequencyCode: string | null;
  readonly durationDays: number;
}

// ─── Internal data model ─────────────────────────────────────────────────────

interface RiskVital {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly recordedAt: string;
  readonly quality: string;
  readonly stale: boolean;
}

interface AnomalyReading {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly recordedAt: string;
  readonly source: string;
}

// ─── RiskScoringEngine ───────────────────────────────────────────────────────

export class RiskScoringEngine {
  constructor(private readonly database: PostgresConnection) {}

  async computeRiskProfile(patientProfileId: string, now: Date): Promise<PatientRiskProfile> {
    const [vitals, conditions, medications] = await Promise.all([
      this.fetchVitals(patientProfileId, now),
      this.fetchConditions(patientProfileId),
      this.fetchMedications(patientProfileId),
    ]);

    const computedAt = now.toISOString();
    const riskScores: RiskScore[] = [
      this.computeCardiovascularRisk(vitals, conditions, computedAt),
      this.computeFallRisk(vitals, computedAt),
      this.computeMedicationAdherenceRisk(medications, conditions, vitals, computedAt),
      this.computeRespiratoryRisk(vitals, computedAt),
    ];

    const overallRiskScore = clampScore(
      riskScores.reduce((sum, rs) => sum + rs.score * (RISK_WEIGHTS[rs.riskType] ?? 0), 0),
    );

    return {
      patientProfileId,
      overallRiskScore,
      overallRiskLevel: riskLevel(overallRiskScore),
      riskScores,
      computedAt,
    };
  }

  private async fetchVitals(patientProfileId: string, now: Date): Promise<readonly RiskVital[]> {
    const windowStart = new Date(now.getTime() - RISK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_MS);
    const result = await this.database.query<VitalRow>(
      `SELECT vr.metric, vr.value::text AS "value", vr.unit,
              vr.recorded_at::text AS "recordedAt", vr.quality,
              d.device_type AS "deviceType"
       FROM vital_readings vr
       JOIN devices d ON d.device_id = vr.device_id
       WHERE vr.patient_profile_id = $1
         AND vr.quality IN ('valid', 'suspect')
         AND vr.recorded_at >= $2
       ORDER BY vr.recorded_at ASC`,
      [patientProfileId, windowStart],
    );
    return result.rows.map((row) => ({
      metric: row.metric,
      value: Number.parseFloat(row.value),
      unit: row.unit,
      recordedAt: row.recordedAt,
      quality: row.quality,
      stale: new Date(row.recordedAt).getTime() < staleThreshold.getTime(),
    }));
  }

  private async fetchConditions(patientProfileId: string): Promise<readonly string[]> {
    const result = await this.database.query<ConditionNameRow>(
      `SELECT condition_name AS "conditionName"
       FROM patient_conditions
       WHERE profile_id = $1 AND deleted_at IS NULL
         AND status IN ('active', 'in_remission')
       ORDER BY condition_name`,
      [patientProfileId],
    );
    return result.rows.map((r) => r.conditionName);
  }

  private async fetchMedications(patientProfileId: string): Promise<readonly MedicationRow[]> {
    const result = await this.database.query<MedicationRow>(
      `SELECT item.medication_text AS "medicationText",
              item.dose_value::text AS "doseValue",
              item.dose_unit AS "doseUnit",
              item.frequency_code AS "frequencyCode",
              item.duration_days AS "durationDays"
       FROM prescription_items item
       JOIN prescriptions rx ON rx.prescription_id = item.prescription_id
       WHERE rx.patient_profile_id = $1 AND rx.status = 'signed'
       ORDER BY item.position`,
      [patientProfileId],
    );
    return result.rows;
  }

  private computeCardiovascularRisk(
    vitals: readonly RiskVital[], conditions: readonly string[], computedAt: string,
  ): RiskScore {
    const factors: RiskFactor[] = [];
    const hr = valuesForMetric(vitals, 'heart_rate');
    const spo2 = valuesForMetric(vitals, 'oxygen_saturation');
    const sys = valuesForMetric(vitals, 'systolic_bp');
    const dia = valuesForMetric(vitals, 'diastolic_bp');

    if (hr.length > 0) {
      const m = mean(hr), sd = stddev(hr);
      let c = 0, d = `Mean HR: ${formatNumber(m)} bpm`;
      if (m > 120) { c = 30; d += ' (significantly elevated)'; }
      else if (m > 100) { c = 20; d += ' (elevated)'; }
      else if (m > 90) { c = 10; d += ' (borderline elevated)'; }
      if (c > 0) factors.push({ name: 'elevated_heart_rate', contribution: c, detail: d });

      if (sd > 25) factors.push({ name: 'high_hr_variability', contribution: 15, detail: `HR variability: ±${formatNumber(sd)} bpm (high)` });
      else if (sd > 15) factors.push({ name: 'high_hr_variability', contribution: 10, detail: `HR variability: ±${formatNumber(sd)} bpm (moderate)` });
    }

    if (sys.length > 0 || dia.length > 0) {
      const sm = sys.length > 0 ? mean(sys) : 0;
      const dm = dia.length > 0 ? mean(dia) : 0;
      let c = 0, d = '';
      if (sm > 160 || dm > 100) { c = 25; d = `BP: ${formatNumber(sm)}/${formatNumber(dm)} mmHg (stage 2 range)`; }
      else if (sm > 140 || dm > 90) { c = 15; d = `BP: ${formatNumber(sm)}/${formatNumber(dm)} mmHg (stage 1 range)`; }
      if (c > 0) factors.push({ name: 'high_blood_pressure', contribution: c, detail: d });
    }

    if (conditions.some((c) => c.toLowerCase().includes('hypertension')))
      factors.push({ name: 'hypertension_condition', contribution: 20, detail: 'Patient has hypertension recorded as an active condition' });
    if (conditions.some((c) => c.toLowerCase().includes('diabetes')))
      factors.push({ name: 'diabetes_condition', contribution: 10, detail: 'Patient has diabetes recorded as an active condition' });

    if (spo2.length > 0) {
      const m = mean(spo2);
      let c = 0, d = `Mean SpO₂: ${formatNumber(m)}%`;
      if (m < 88) { c = 20; d += ' (very low)'; }
      else if (m < 92) { c = 15; d += ' (low)'; }
      else if (m < 95) { c = 10; d += ' (below normal)'; }
      if (c > 0) factors.push({ name: 'low_oxygen_saturation', contribution: c, detail: d });
    }

    return buildRiskScore('cardiovascular', factors,
      'Monitor your heart rate and blood pressure regularly. Consider consulting your doctor if elevated readings persist.', computedAt);
  }

  private computeFallRisk(vitals: readonly RiskVital[], computedAt: string): RiskScore {
    const factors: RiskFactor[] = [];
    const hr = valuesForMetric(vitals, 'heart_rate');
    const spo2 = valuesForMetric(vitals, 'oxygen_saturation');
    const sys = valuesForMetric(vitals, 'systolic_bp');

    if (hr.length >= MIN_POINTS) {
      const cv = coefficientOfVariation(hr);
      if (cv > 0.35) factors.push({ name: 'erratic_heart_rate', contribution: 25, detail: `HR coefficient of variation: ${formatNumber(cv * 100)}% (highly erratic)` });
      else if (cv > 0.25) factors.push({ name: 'erratic_heart_rate', contribution: 15, detail: `HR coefficient of variation: ${formatNumber(cv * 100)}% (moderately erratic)` });
    }

    if (sys.length >= MIN_POINTS) {
      const sd = stddev(sys);
      if (sd > 25) factors.push({ name: 'bp_variability', contribution: 30, detail: `Systolic BP variability: ±${formatNumber(sd)} mmHg (high)` });
      else if (sd > 15) factors.push({ name: 'bp_variability', contribution: 20, detail: `Systolic BP variability: ±${formatNumber(sd)} mmHg (moderate)` });
    }

    if (spo2.length > 0) {
      const m = mean(spo2);
      if (m < 90) factors.push({ name: 'low_oxygen_saturation', contribution: 20, detail: `Mean SpO₂: ${formatNumber(m)}% (very low, may cause dizziness)` });
      else if (m < 93) factors.push({ name: 'low_oxygen_saturation', contribution: 10, detail: `Mean SpO₂: ${formatNumber(m)}% (low)` });
    }

    if (vitals.length > 0 && !vitals.some((v) => !v.stale))
      factors.push({ name: 'stale_device_readings', contribution: 15, detail: 'All device readings are stale (older than 5 minutes); patient may not be actively monitoring' });

    return buildRiskScore('fall', factors,
      'Take care when changing positions and ensure your surroundings are free of hazards. Consider consulting your doctor if you experience dizziness or unsteadiness.', computedAt);
  }

  private computeMedicationAdherenceRisk(
    medications: readonly MedicationRow[], conditions: readonly string[],
    vitals: readonly RiskVital[], computedAt: string,
  ): RiskScore {
    const factors: RiskFactor[] = [];
    const medCount = medications.length;

    let medC = 0, medD = '';
    if (medCount === 0) { medC = 5; medD = 'No active medications recorded'; }
    else if (medCount <= 2) { medC = 10; medD = `${medCount} active medication${medCount > 1 ? 's' : ''} (low complexity)`; }
    else if (medCount <= 4) { medC = 20; medD = `${medCount} active medications (moderate complexity)`; }
    else { medC = 40; medD = `${medCount} active medications (high complexity, polypharmacy range)`; }
    factors.push({ name: 'medication_complexity', contribution: medC, detail: medD });

    const chronicKeywords = ['hypertension', 'diabetes', 'asthma', 'copd', 'cardiac', 'heart', 'renal', 'thyroid'];
    const chronicCount = conditions.filter((c) => chronicKeywords.some((kw) => c.toLowerCase().includes(kw))).length;
    if (chronicCount > 0) {
      factors.push({ name: 'chronic_conditions', contribution: Math.min(30, chronicCount * 10),
        detail: `${chronicCount} chronic condition${chronicCount > 1 ? 's' : ''} recorded (each adds adherence burden)` });
    }

    if (medCount === 0 && chronicCount > 0)
      factors.push({ name: 'conditions_without_medication', contribution: 10, detail: 'Patient has chronic conditions but no active medications recorded (potential non-adherence or gap in care)' });

    if (vitals.length > 0) {
      if (!vitals.some((v) => !v.stale))
        factors.push({ name: 'stale_device_readings', contribution: 20, detail: 'All device readings are stale; patient may not be actively monitoring their health' });
    } else if (chronicCount > 0) {
      factors.push({ name: 'no_health_monitoring', contribution: 15, detail: 'No device readings in the last 7 days despite chronic conditions; patient is not monitoring' });
    }

    return buildRiskScore('medication_adherence', factors,
      'Keep a consistent medication schedule and use reminders. Consider consulting your doctor or pharmacist about your medication regimen.', computedAt);
  }

  private computeRespiratoryRisk(vitals: readonly RiskVital[], computedAt: string): RiskScore {
    const factors: RiskFactor[] = [];
    const spo2Readings = vitals.filter((v) => v.metric === 'oxygen_saturation');
    const rr = valuesForMetric(vitals, 'respiratory_rate');

    if (spo2Readings.length > 0) {
      const vals = spo2Readings.map((v) => v.value);
      const m = mean(vals);
      let c = 0, d = `Mean SpO₂: ${formatNumber(m)}%`;
      if (m < 88) { c = 40; d += ' (critically low)'; }
      else if (m < 92) { c = 25; d += ' (low)'; }
      else if (m < 95) { c = 15; d += ' (below normal)'; }
      if (c > 0) factors.push({ name: 'low_oxygen_saturation', contribution: c, detail: d });

      if (spo2Readings.length >= MIN_POINTS) {
        const sorted = [...spo2Readings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
        const startMs = new Date(sorted[0]!.recordedAt).getTime();
        const xs = sorted.map((r) => (new Date(r.recordedAt).getTime() - startMs) / (24 * 60 * 60 * 1000));
        const ys = sorted.map((r) => r.value);
        const slope = linearRegressionSlope(xs, ys);
        if (slope < PROGRESSIVE_DECLINE_SLOPE) {
          const sc = slope < -1.0 ? 25 : 15;
          factors.push({ name: 'spo2_declining_trend', contribution: sc, detail: `SpO₂ trend: ${formatSigned(slope)}%/day (declining)` });
        }
      }
    } else {
      factors.push({ name: 'no_spo2_data', contribution: 15, detail: 'No SpO₂ readings available; respiratory status cannot be assessed' });
    }

    if (rr.length > 0) {
      const m = mean(rr);
      if (m > 25) factors.push({ name: 'elevated_respiratory_rate', contribution: 20, detail: `Mean RR: ${formatNumber(m)}/min (elevated)` });
      else if (m > 20) factors.push({ name: 'elevated_respiratory_rate', contribution: 10, detail: `Mean RR: ${formatNumber(m)}/min (above normal)` });
    }

    return buildRiskScore('respiratory', factors,
      'Monitor your oxygen saturation levels. Consider consulting your doctor if you experience shortness of breath or persistently low readings.', computedAt);
  }
}

// ─── AdvancedAnomalyDetector ─────────────────────────────────────────────────

export class AdvancedAnomalyDetector {
  constructor(private readonly database: PostgresConnection) {}

  async detect(patientProfileId: string, now: Date, windowDays: number = 7): Promise<AnomalyReport> {
    const [readings, conditions] = await Promise.all([
      this.fetchReadings(patientProfileId, now, windowDays),
      this.fetchConditions(patientProfileId),
    ]);

    if (readings.length === 0) {
      return { anomalies: [], windowDays, totalReadingsAnalyzed: 0 };
    }

    const byMetric = new Map<string, AnomalyReading[]>();
    for (const r of readings) {
      const list = byMetric.get(r.metric) ?? [];
      list.push(r);
      byMetric.set(r.metric, list);
    }

    const anomalies: AdvancedAnomaly[] = [
      ...this.detectSustainedElevation(byMetric, conditions),
      ...this.detectAcuteSpike(byMetric, conditions),
      ...this.detectProgressiveDecline(byMetric, conditions),
      ...this.detectErraticPattern(byMetric, conditions),
      ...this.detectCyclicalPattern(byMetric, conditions),
    ];

    anomalies.sort((a, b) => {
      const rankDiff = anomalySeverityRank(b.severity) - anomalySeverityRank(a.severity);
      if (rankDiff !== 0) return rankDiff;
      return a.startTime.localeCompare(b.startTime);
    });

    return { anomalies, windowDays, totalReadingsAnalyzed: readings.length };
  }

  private async fetchReadings(patientProfileId: string, now: Date, windowDays: number): Promise<readonly AnomalyReading[]> {
    const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const result = await this.database.query<VitalRow>(
      `SELECT vr.metric, vr.value::text AS "value", vr.unit,
              vr.recorded_at::text AS "recordedAt",
              d.device_type AS "deviceType"
       FROM vital_readings vr
       JOIN devices d ON d.device_id = vr.device_id
       WHERE vr.patient_profile_id = $1
         AND vr.quality IN ('valid', 'suspect')
         AND vr.recorded_at >= $2
         AND vr.recorded_at <= $3
       ORDER BY vr.recorded_at ASC`,
      [patientProfileId, windowStart, now],
    );
    return result.rows.map((row) => ({
      metric: row.metric,
      value: Number.parseFloat(row.value),
      unit: row.unit,
      recordedAt: row.recordedAt,
      source: inferSource(row.deviceType),
    }));
  }

  private async fetchConditions(patientProfileId: string): Promise<readonly string[]> {
    const result = await this.database.query<ConditionNameRow>(
      `SELECT condition_name AS "conditionName"
       FROM patient_conditions
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY condition_name`,
      [patientProfileId],
    );
    return result.rows.map((r) => r.conditionName);
  }

  private detectSustainedElevation(
    byMetric: ReadonlyMap<string, readonly AnomalyReading[]>, conditions: readonly string[],
  ): readonly AdvancedAnomaly[] {
    const anomalies: AdvancedAnomaly[] = [];
    const hr = byMetric.get('heart_rate');
    if (!hr || hr.length < MIN_POINTS) return anomalies;

    const sorted = [...hr].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const vals = sorted.map((r) => r.value);
    const m = mean(vals), sd = stddev(vals);
    if (sd === 0) return anomalies;
    const threshold = m + SUSTAINED_ELEVATION_Z * sd;

    let runStart: AnomalyReading | null = null;
    let runEnd: AnomalyReading | null = null;
    const checkRun = () => {
      if (!runStart || !runEnd) return;
      const durMs = new Date(runEnd.recordedAt).getTime() - new Date(runStart.recordedAt).getTime();
      if (durMs > SUSTAINED_ELEVATION_HOURS * 60 * 60 * 1000) {
        const hours = durMs / (60 * 60 * 1000);
        anomalies.push({
          metric: 'heart_rate', anomalyType: 'sustained_elevation',
          severity: hours > 3 ? 'severe' : 'moderate',
          startTime: runStart.recordedAt, endTime: runEnd.recordedAt,
          description: `Heart rate sustained above ${formatNumber(threshold)} bpm (baseline + ${SUSTAINED_ELEVATION_Z}σ) for ${formatNumber(hours)} hours`,
          relatedConditions: relatedConditionsFor('heart_rate', conditions),
        });
      }
    };

    for (const r of sorted) {
      if (r.value > threshold) {
        if (!runStart) runStart = r;
        runEnd = r;
      } else {
        checkRun();
        runStart = null; runEnd = null;
      }
    }
    checkRun();
    return anomalies;
  }

  private detectAcuteSpike(
    byMetric: ReadonlyMap<string, readonly AnomalyReading[]>, conditions: readonly string[],
  ): readonly AdvancedAnomaly[] {
    const anomalies: AdvancedAnomaly[] = [];
    for (const [metric, readings] of byMetric) {
      if (readings.length < MIN_POINTS) continue;
      const vals = readings.map((r) => r.value);
      const m = mean(vals), sd = stddev(vals);
      if (sd === 0) continue;
      for (const r of readings) {
        const z = zScore(r.value, m, sd);
        if (Math.abs(z) > ACUTE_SPIKE_Z) {
          anomalies.push({
            metric, anomalyType: 'acute_spike', severity: 'severe',
            startTime: r.recordedAt, endTime: r.recordedAt,
            description: `${metric} ${z > 0 ? 'spike' : 'drop'} to ${formatNumber(r.value)} (z-score: ${formatSigned(z)}, baseline: ${formatNumber(m)}±${formatNumber(sd)})`,
            relatedConditions: relatedConditionsFor(metric, conditions),
          });
        }
      }
    }
    return anomalies;
  }

  private detectProgressiveDecline(
    byMetric: ReadonlyMap<string, readonly AnomalyReading[]>, conditions: readonly string[],
  ): readonly AdvancedAnomaly[] {
    const anomalies: AdvancedAnomaly[] = [];
    const spo2 = byMetric.get('oxygen_saturation');
    if (!spo2 || spo2.length < MIN_POINTS) return anomalies;

    const sorted = [...spo2].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const spanMs = new Date(sorted[sorted.length - 1]!.recordedAt).getTime() - new Date(sorted[0]!.recordedAt).getTime();
    if (spanMs < 24 * 60 * 60 * 1000) return anomalies;

    const startMs = new Date(sorted[0]!.recordedAt).getTime();
    const xs = sorted.map((r) => (new Date(r.recordedAt).getTime() - startMs) / (24 * 60 * 60 * 1000));
    const ys = sorted.map((r) => r.value);
    const slope = linearRegressionSlope(xs, ys);

    if (slope < PROGRESSIVE_DECLINE_SLOPE) {
      anomalies.push({
        metric: 'oxygen_saturation', anomalyType: 'progressive_decline',
        severity: slope < -1.0 ? 'severe' : 'moderate',
        startTime: sorted[0]!.recordedAt, endTime: sorted[sorted.length - 1]!.recordedAt,
        description: `SpO₂ declining at ${formatSigned(slope)}%/day (baseline: ${formatNumber(mean(ys))}%)`,
        relatedConditions: relatedConditionsFor('oxygen_saturation', conditions),
      });
    }
    return anomalies;
  }

  private detectErraticPattern(
    byMetric: ReadonlyMap<string, readonly AnomalyReading[]>, conditions: readonly string[],
  ): readonly AdvancedAnomaly[] {
    const anomalies: AdvancedAnomaly[] = [];
    for (const [metric, readings] of byMetric) {
      if (readings.length < MIN_POINTS) continue;
      const cv = coefficientOfVariation(readings.map((r) => r.value));
      if (cv > ERRATIC_CV_THRESHOLD) {
        const sorted = [...readings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
        anomalies.push({
          metric, anomalyType: 'erratic_pattern',
          severity: cv > 0.5 ? 'severe' : 'moderate',
          startTime: sorted[0]!.recordedAt, endTime: sorted[sorted.length - 1]!.recordedAt,
          description: `${metric} coefficient of variation ${formatNumber(cv * 100)}% (threshold: ${ERRATIC_CV_THRESHOLD * 100}%), possible irregular rhythm`,
          relatedConditions: relatedConditionsFor(metric, conditions),
        });
      }
    }
    return anomalies;
  }

  private detectCyclicalPattern(
    byMetric: ReadonlyMap<string, readonly AnomalyReading[]>, conditions: readonly string[],
  ): readonly AdvancedAnomaly[] {
    const anomalies: AdvancedAnomaly[] = [];
    for (const [metric, readings] of byMetric) {
      if (readings.length < 5) continue;
      const sorted = [...readings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      const spanMs = new Date(sorted[sorted.length - 1]!.recordedAt).getTime() - new Date(sorted[0]!.recordedAt).getTime();
      if (spanMs < 24 * 60 * 60 * 1000) continue;

      const dayVals: number[] = [], nightVals: number[] = [];
      for (const r of sorted) {
        const hour = new Date(r.recordedAt).getUTCHours();
        if (hour >= 6 && hour < 18) dayVals.push(r.value);
        else nightVals.push(r.value);
      }
      if (dayVals.length < 2 || nightVals.length < 2) continue;

      const dayMean = mean(dayVals), nightMean = mean(nightVals);
      const overall = mean([...dayVals, ...nightVals]);
      if (overall === 0) continue;
      const variation = Math.abs(dayMean - nightMean) / Math.abs(overall);
      if (variation > CYCLICAL_VARIATION_FRACTION) {
        anomalies.push({
          metric, anomalyType: 'cyclical_pattern', severity: 'mild',
          startTime: sorted[0]!.recordedAt, endTime: sorted[sorted.length - 1]!.recordedAt,
          description: `${metric} shows day/night variation of ${formatNumber(variation * 100)}% (day: ${formatNumber(dayMean)}, night: ${formatNumber(nightMean)})`,
          relatedConditions: relatedConditionsFor(metric, conditions),
        });
      }
    }
    return anomalies;
  }
}

// ─── Serialization ───────────────────────────────────────────────────────────

export function serializeRiskProfile(profile: PatientRiskProfile): string {
  const lines: string[] = [];
  lines.push(`Patient risk profile (computed: ${profile.computedAt}):`);
  lines.push(`Overall risk: ${profile.overallRiskScore}/100 (${profile.overallRiskLevel})`);
  lines.push('');
  for (const rs of profile.riskScores) {
    lines.push(`${rs.riskType} risk: ${rs.score}/100 (${rs.level})`);
    if (rs.factors.length > 0) {
      for (const f of rs.factors) {
        lines.push(`  - ${f.name} (+${f.contribution}): ${f.detail}`);
      }
    } else {
      lines.push('  - No contributing factors');
    }
    lines.push(`  Recommendation: ${rs.recommendation}`);
  }
  return lines.join('\n');
}

export function serializeAnomalyReport(report: AnomalyReport): string {
  const lines: string[] = [];
  lines.push(`Anomaly report (${report.windowDays}-day window, ${report.totalReadingsAnalyzed} readings analyzed):`);
  if (report.anomalies.length > 0) {
    lines.push('Detected anomalies:');
    for (const a of report.anomalies) {
      lines.push(
        `  - ${a.metric} (${a.anomalyType}, ${a.severity}): ${a.description}` +
        ` [${a.startTime} to ${a.endTime}]`,
      );
      if (a.relatedConditions.length > 0) {
        lines.push(`    Related conditions: ${a.relatedConditions.join(', ')}`);
      }
    }
  } else {
    lines.push('No anomalies detected.');
  }
  return lines.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function riskLevel(score: number): 'low' | 'moderate' | 'high' | 'critical' {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'moderate';
  return 'low';
}

export function coefficientOfVariation(values: readonly number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stddev(values) / Math.abs(m);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildRiskScore(
  riskType: string, factors: readonly RiskFactor[], recommendation: string, computedAt: string,
): RiskScore {
  const score = clampScore(factors.reduce((s, f) => s + f.contribution, 0));
  return { riskType, score, level: riskLevel(score), factors, recommendation, computedAt };
}

function valuesForMetric(vitals: readonly RiskVital[], metric: string): number[] {
  return vitals.filter((v) => v.metric === metric).map((v) => v.value);
}

function relatedConditionsFor(metric: string, conditions: readonly string[]): readonly string[] {
  const keywords = METRIC_CONDITION_KEYWORDS.get(metric);
  if (!keywords) return [];
  return conditions.filter((c) => keywords.some((kw) => c.toLowerCase().includes(kw)));
}

function anomalySeverityRank(severity: 'mild' | 'moderate' | 'severe'): number {
  switch (severity) {
    case 'severe': return 3;
    case 'moderate': return 2;
    case 'mild': return 1;
  }
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.parseFloat(n.toFixed(2)).toString();
}

function formatSigned(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = Number.parseFloat(n.toFixed(2)).toString();
  return n > 0 ? `+${s}` : s;
}
