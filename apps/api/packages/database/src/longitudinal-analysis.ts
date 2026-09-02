/**
 * LongitudinalAnalyzer — statistical analysis engine for patient vitals over time.
 *
 * This is Phase AI-7 of the SmartCura AI Master Plan. Where HealthContextBuilder
 * looks at the last 24 hours of vitals, LongitudinalAnalyzer opens the window
 * out to 7-30 days and computes:
 *
 *   - Per-metric trend: linear regression slope (change per day), direction
 *     (increasing / decreasing / stable), and the current value's deviation
 *     from the window's mean in standard deviations (z-score).
 *   - Anomalies: any reading whose z-score exceeds 2 is flagged, with a
 *     severity tier (mild 2-3, moderate 3-4, severe >4).
 *   - Correlations: for every pair of metrics with enough data, the Pearson
 *     correlation coefficient, interpreted as positive / negative / none.
 *
 * The analyzer is a read-only projection. Statistics are derived at query
 * time and never cached — a patient with active monitoring may have
 * thousands of readings per day and the window is intentionally wide so a
 * cached baseline would be stale within hours.
 *
 * Authorization model:
 *   Like HealthContextBuilder, the `patientProfileId` is always a method
 *   parameter and every query is scoped to it. There is no path by which the
 *   analyzer can read another patient's vitals.
 *
 * Schema notes:
 *   - `vital_readings` has no `source` column. Source is inferred from
 *     `devices.device_type` via the shared `inferSource` helper in
 *     `health-context.ts`. We re-derive it here for parity.
 *   - `quality` is filtered to 'valid' and 'suspect'. 'invalid' and 'unknown'
 *     readings are excluded — a sensor artifact must not anchor a baseline.
 */

import type { PostgresConnection } from './connection.js';
import type { QueryResultRow } from 'pg';
import { inferSource } from './health-context.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A single metric's trend over the analysis window. The trend is the
 * least-squares slope of `value` regressed on `daysSinceWindowStart`,
 * expressed in the metric's own units (e.g. bpm/day).
 */
export interface VitalTrend {
  readonly metric: string;
  readonly direction: 'increasing' | 'decreasing' | 'stable';
  readonly slope: number;
  readonly baselineMean: number;
  readonly baselineStdDev: number;
  readonly currentValue: number;
  readonly deviationFromBaseline: number;
  readonly windowDays: number;
  readonly dataPoints: number;
}

/**
 * A single reading that is statistically unusual relative to the window's
 * baseline for its metric. A z-score is the number of standard deviations
 * the reading sits from the mean.
 */
export interface VitalAnomaly {
  readonly metric: string;
  readonly recordedAt: string;
  readonly value: number;
  readonly baselineMean: number;
  readonly baselineStdDev: number;
  readonly zScore: number;
  readonly severity: 'mild' | 'moderate' | 'severe';
}

/**
 * The Pearson correlation coefficient between two metrics, paired with a
 * coarse interpretation suitable for LLM consumption.
 */
export interface MetricCorrelation {
  readonly metricA: string;
  readonly metricB: string;
  readonly correlation: number;
  readonly interpretation: 'positive' | 'negative' | 'none';
}

/**
 * The full longitudinal analysis for a single patient over a single window.
 * All four collections are derived from the same underlying reading set.
 */
export interface LongitudinalAnalysis {
  readonly trends: readonly VitalTrend[];
  readonly anomalies: readonly VitalAnomaly[];
  readonly correlations: readonly MetricCorrelation[];
  readonly windowDays: number;
  readonly totalReadings: number;
}

/**
 * A within-day pattern for a single metric. Readings are grouped into four
 * six-hour blocks (morning, afternoon, evening, night) and the mean of each
 * block is computed. The `dayPattern` classifies which block, if any, tends
 * to carry the highest values.
 */
export interface SeasonalPattern {
  readonly metric: string;
  readonly dayPattern: 'morning_high' | 'evening_high' | 'night_high' | 'flat' | 'variable';
  readonly morningMean: number;
  readonly afternoonMean: number;
  readonly eveningMean: number;
  readonly nightMean: number;
  readonly description: string;
}

/**
 * A metric-level comparison between the current analysis window and the
 * immediately preceding window of the same length. `changePercent` is signed:
 * positive means the current window mean is higher than the previous.
 * `direction` interprets the change through a clinical lens — lower heart
 * rate is improving, higher SpO₂ is improving, etc.
 */
export interface LongitudinalComparison {
  readonly metric: string;
  readonly currentWindowMean: number;
  readonly previousWindowMean: number;
  readonly changePercent: number;
  readonly direction: 'improving' | 'worsening' | 'stable';
  readonly interpretation: string;
}

/**
 * The full rich longitudinal analysis: the base trend / anomaly / correlation
 * picture plus seasonal patterns, window-over-window comparison, and an
 * overall health trajectory assessment.
 */
export interface RichLongitudinalAnalysis extends LongitudinalAnalysis {
  readonly seasonalPatterns: readonly SeasonalPattern[];
  readonly windowComparison: readonly LongitudinalComparison[];
  readonly healthTrajectory: 'improving' | 'stable' | 'declining' | 'volatile';
  readonly trajectoryDescription: string;
}

// ─── Query row types ─────────────────────────────────────────────────────────

interface ReadingRow extends QueryResultRow {
  readonly metric: string;
  readonly value: string;
  readonly unit: string;
  readonly recordedAt: string;
  readonly deviceType: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Minimum data points for a metric to receive a trend. Three readings are the
 * bare minimum to fit a line at all (the slope has one degree of freedom);
 * anything less is overfit and would mislead the LLM.
 */
const MIN_POINTS_FOR_TREND = 3;

/**
 * Minimum data points for a pair of metrics to receive a correlation.
 * Five is the conventional floor for a Pearson r to be interpretable; with
 * fewer than five points the coefficient is dominated by individual
 * readings.
 */
const MIN_POINTS_FOR_CORRELATION = 5;

/**
 * A trend is "stable" if |slope / mean| is below this fraction of the mean
 * per day. 0.005 = 0.5% of the mean per day, which is below the noise floor
 * of any consumer wearable and below the day-to-day biological variation of
 * any vital sign we track.
 */
const STABLE_SLOPE_FRACTION = 0.005;

/** Z-score floor for a reading to be considered an anomaly. */
const ANOMALY_Z_THRESHOLD = 2;

/** Milliseconds in one day — used for window arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Minimum percent change between windows for a comparison to be considered
 * significant. Below this the direction is 'stable' regardless of the
 * metric's clinical polarity.
 */
const STABLE_CHANGE_PERCENT = 5;

/**
 * Maximum spread (as a fraction of the overall mean) between the four
 * time-of-day period means for a seasonal pattern to be classified 'flat'.
 * 0.05 = 5% of the overall mean.
 */
const FLAT_PATTERN_SPREAD = 0.05;

/**
 * Metrics where a lower value is clinically favourable (reducing
 * cardiovascular load, fever, or respiratory effort).
 */
const LOWER_IS_BETTER = new Set([
  'heart_rate',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'respiratory_rate',
  'body_temperature',
]);

/**
 * Metrics where a higher value is clinically favourable (improving oxygen
 * saturation).
 */
const HIGHER_IS_BETTER = new Set(['oxygen_saturation']);

// ─── Analyzer ────────────────────────────────────────────────────────────────

/**
 * Computes longitudinal statistics for a single patient over a single window.
 *
 * The analyzer is constructed with a database connection; the patient and
 * window are passed to `analyze()`. There is no state that outlives a
 * single call, so the analyzer is safe to share across requests.
 */
export class LongitudinalAnalyzer {
  constructor(
    private readonly database: PostgresConnection,
  ) {}

  /**
   * Runs the full analysis for the given patient.
   *
   * @param patientProfileId — the patient whose readings to analyze. From the
   *   `ai_generations` work row, never from user input.
   * @param now — the reference instant. The window is `[now - windowDays, now]`.
   * @param windowDays — width of the analysis window in days. Must be a
   *   positive integer. Defaults to 7 (one week).
   */
  async analyze(
    patientProfileId: string,
    now: Date,
    windowDays: number = 7,
  ): Promise<LongitudinalAnalysis> {
    const readings = await this.fetchReadings(patientProfileId, now, windowDays);
    return this.analyzeReadings(readings, windowDays);
  }

  /**
   * Runs the full rich analysis for the given patient, including seasonal
   * patterns, window-over-window comparison, and an overall health trajectory.
   *
   * The current window is `[now - windowDays, now]` and the previous window
   * is `[now - 2*windowDays, now - windowDays]`. Both windows are the same
   * length so the comparison is apples-to-apples.
   *
   * @param patientProfileId — the patient whose readings to analyze. From the
   *   `ai_generations` work row, never from user input.
   * @param now — the reference instant.
   * @param windowDays — width of each analysis window in days. Must be a
   *   positive integer. Defaults to 7 (one week).
   */
  async analyzeRich(
    patientProfileId: string,
    now: Date,
    windowDays: number = 7,
  ): Promise<RichLongitudinalAnalysis> {
    const currentReadings = await this.fetchReadings(patientProfileId, now, windowDays);
    const base = this.analyzeReadings(currentReadings, windowDays);

    const prevNow = new Date(now.getTime() - windowDays * MS_PER_DAY);
    const previousReadings = await this.fetchReadings(patientProfileId, prevNow, windowDays);
    const previousAnalysis = this.analyzeReadings(previousReadings, windowDays);

    const seasonalPatterns = computeSeasonalPatterns(currentReadings);
    const windowComparison = computeWindowComparison(currentReadings, previousReadings);
    const { healthTrajectory, trajectoryDescription } = computeHealthTrajectory(
      base,
      previousAnalysis,
      windowComparison,
    );

    return {
      ...base,
      seasonalPatterns,
      windowComparison,
      healthTrajectory,
      trajectoryDescription,
    };
  }

  /**
   * Computes trends, anomalies, and correlations from a pre-fetched set of
   * readings. Extracted from `analyze()` so `analyzeRich()` can reuse the
   * exact same pipeline for the previous window without a second public
   * entrypoint.
   */
  private analyzeReadings(
    readings: readonly VitalPoint[],
    windowDays: number,
  ): LongitudinalAnalysis {
    if (readings.length === 0) {
      return {
        trends: [],
        anomalies: [],
        correlations: [],
        windowDays,
        totalReadings: 0,
      };
    }

    // Group by metric. Use insertion order so the output is deterministic
    // (tests rely on this) and the LLM sees the same order every call.
    const byMetric = new Map<string, VitalPoint[]>();
    for (const r of readings) {
      const list = byMetric.get(r.metric) ?? [];
      list.push(r);
      byMetric.set(r.metric, list);
    }

    const trends: VitalTrend[] = [];
    const anomalies: VitalAnomaly[] = [];

    for (const [metric, points] of byMetric) {
      if (points.length < MIN_POINTS_FOR_TREND) continue;

      const baseline = computeBaseline(points);
      const trend = computeTrend(metric, points, baseline, windowDays);
      trends.push(trend);

      for (const p of points) {
        const z = zScore(p.value, baseline.mean, baseline.stddev);
        if (Math.abs(z) > ANOMALY_Z_THRESHOLD) {
          anomalies.push({
            metric,
            recordedAt: p.recordedAt,
            value: p.value,
            baselineMean: baseline.mean,
            baselineStdDev: baseline.stddev,
            zScore: z,
            severity: classifyAnomaly(Math.abs(z)),
          });
        }
      }
    }

    // Sort anomalies most-severe first, then most-recent, so the LLM sees the
    // most actionable findings at the top of its context.
    anomalies.sort((a, b) => {
      const severityDiff = anomalyRank(b.severity) - anomalyRank(a.severity);
      if (severityDiff !== 0) return severityDiff;
      return b.recordedAt.localeCompare(a.recordedAt);
    });

    // Correlations are computed pairwise from the full point set; we
    // interpolate missing timestamps so a pair of metrics with different
    // sampling rates can still be correlated.
    const correlations = computeCorrelations(byMetric);

    return {
      trends,
      anomalies,
      correlations,
      windowDays,
      totalReadings: readings.length,
    };
  }

  /**
   * Fetches the raw readings for the window, joining `devices` for source
   * provenance and filtering to quality IN ('valid', 'suspect').
   *
   * The query orders by `recorded_at` so the consumer can rely on the
   * chronological ordering without re-sorting.
   */
  private async fetchReadings(
    patientProfileId: string,
    now: Date,
    windowDays: number,
  ): Promise<readonly VitalPoint[]> {
    const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const result = await this.database.query<ReadingRow>(
      `SELECT vr.metric,
              vr.value::text AS "value",
              vr.unit,
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
}

// ─── Internal data model ─────────────────────────────────────────────────────

interface VitalPoint {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly recordedAt: string;
  readonly source: string;
}

interface Baseline {
  readonly mean: number;
  readonly stddev: number;
}

// ─── Pure statistics ─────────────────────────────────────────────────────────

/**
 * Arithmetic mean of a non-empty list of numbers.
 *
 * Exposed for unit testing; the analyze pipeline uses it via
 * `computeBaseline`. Returns 0 for an empty input rather than NaN so a
 * caller that does not pre-check length still gets a deterministic number.
 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Sample standard deviation (Bessel's correction) of a non-empty list.
 *
 * Returns 0 when the list has fewer than 2 elements — a single sample has no
 * spread, and an empty list has no sample.
 */
export function stddev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sumSquaredDeviations = 0;
  for (const v of values) {
    const d = v - m;
    sumSquaredDeviations += d * d;
  }
  return Math.sqrt(sumSquaredDeviations / (values.length - 1));
}

/**
 * Pearson correlation coefficient between two equally-sized numeric series.
 *
 * Returns 0 when either series is constant (zero variance) or when the
 * series are of unequal length. A constant series is undefined for Pearson
 * r, and returning 0 is the safest default — neither a positive nor a
 * negative correlation is real.
 */
export function pearsonCorrelation(
  xs: readonly number[],
  ys: readonly number[],
): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const n = xs.length;
  const meanX = mean(xs);
  const meanY = mean(ys);

  let covXY = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    covXY += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denom = Math.sqrt(varX * varY);
  if (denom === 0) return 0;
  return covXY / denom;
}

/**
 * Ordinary-least-squares slope of `y` on `x`. The returned value is the
 * change in `y` per unit increase in `x`.
 *
 * Returns 0 for fewer than two points, a constant `y` series, or a
 * constant `x` series.
 */
export function linearRegressionSlope(
  xs: readonly number[],
  ys: readonly number[],
): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const n = xs.length;
  const meanX = mean(xs);
  const meanY = mean(ys);

  let covXY = 0;
  let varX = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    covXY += dx * dy;
    varX += dx * dx;
  }

  if (varX === 0) return 0;
  return covXY / varX;
}

/**
 * Standard-score (z-score) of `value` relative to a distribution with the
 * given mean and standard deviation. Returns 0 when the standard deviation
 * is 0 (constant distribution) — the value cannot be meaningfully compared.
 */
export function zScore(value: number, mean: number, stddev: number): number {
  if (stddev === 0) return 0;
  return (value - mean) / stddev;
}

// ─── Internal pipeline helpers ───────────────────────────────────────────────

function computeBaseline(points: readonly VitalPoint[]): Baseline {
  const values = points.map((p) => p.value);
  return { mean: mean(values), stddev: stddev(values) };
}

function computeTrend(
  metric: string,
  points: readonly VitalPoint[],
  baseline: Baseline,
  windowDays: number,
): VitalTrend {
  // Use the most recent reading as the "current" value, regardless of how
  // many points were collected. This is what the LLM and the patient most
  // plausibly mean by "what is it now?".
  const sorted = [...points].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const last = sorted[sorted.length - 1]!;

  // For the regression, use days-since-window-start as the x-axis. A linear
  // fit on the raw timestamp would still work, but the resulting slope
  // would be in units of "per millisecond", which the LLM and the UI both
  // have to rescale. Days is the unit every consumer of this analysis
  // expects.
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const windowStart = new Date(last.recordedAt).getTime() - windowMs;
  const xs = points.map((p) => (new Date(p.recordedAt).getTime() - windowStart) / (24 * 60 * 60 * 1000));
  const ys = points.map((p) => p.value);
  const slope = linearRegressionSlope(xs, ys);

  const direction: VitalTrend['direction'] =
    Math.abs(slope) < STABLE_SLOPE_FRACTION * baseline.mean
      ? 'stable'
      : slope > 0
        ? 'increasing'
        : 'decreasing';

  return {
    metric,
    direction,
    slope,
    baselineMean: baseline.mean,
    baselineStdDev: baseline.stddev,
    currentValue: last.value,
    deviationFromBaseline: zScore(last.value, baseline.mean, baseline.stddev),
    windowDays,
    dataPoints: points.length,
  };
}

function classifyAnomaly(absZ: number): VitalAnomaly['severity'] {
  if (absZ > 4) return 'severe';
  if (absZ > 3) return 'moderate';
  return 'mild';
}

function anomalyRank(severity: VitalAnomaly['severity']): number {
  switch (severity) {
    case 'severe': return 3;
    case 'moderate': return 2;
    case 'mild': return 1;
  }
}

/**
 * Builds a series of (timestampMs, value) pairs aligned across two metrics.
 * For each timestamp in `pointsA`, the value of `pointsB` at the nearest
 * preceding timestamp is used (LOCF — last observation carried forward).
 *
 * LOCF is the standard imputation for sparse clinical time series when the
 * underlying signal changes slowly relative to the sampling rate, which is
 * the case for heart rate, SpO₂ and body temperature at consumer-grade
 * sampling rates.
 *
 * Returns aligned arrays of equal length. Drops points in A that have no
 * prior point in B.
 */
function alignByTimestamp(
  pointsA: readonly VitalPoint[],
  pointsB: readonly VitalPoint[],
): { readonly xs: number[]; readonly ys: number[] } {
  const sortedB = [...pointsB].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const xs: number[] = [];
  const ys: number[] = [];
  let bIdx = -1;
  let lastBValue: number | null = null;

  for (const p of [...pointsA].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    // Advance the B index to the latest B point at or before this A point.
    while (
      bIdx + 1 < sortedB.length &&
      sortedB[bIdx + 1]!.recordedAt <= p.recordedAt
    ) {
      bIdx += 1;
      lastBValue = sortedB[bIdx]!.value;
    }
    if (lastBValue === null) continue; // No B reading yet at this time.
    xs.push(p.value);
    ys.push(lastBValue);
  }

  return { xs, ys };
}

function computeCorrelations(
  byMetric: ReadonlyMap<string, readonly VitalPoint[]>,
): readonly MetricCorrelation[] {
  const metrics = [...byMetric.keys()].sort();
  const out: MetricCorrelation[] = [];

  for (let i = 0; i < metrics.length; i += 1) {
    for (let j = i + 1; j < metrics.length; j += 1) {
      const metricA = metrics[i]!;
      const metricB = metrics[j]!;
      const pointsA = byMetric.get(metricA)!;
      const pointsB = byMetric.get(metricB)!;

      if (pointsA.length < MIN_POINTS_FOR_CORRELATION) continue;
      if (pointsB.length < MIN_POINTS_FOR_CORRELATION) continue;

      const { xs, ys } = alignByTimestamp(pointsA, pointsB);
      if (xs.length < MIN_POINTS_FOR_CORRELATION) continue;

      const r = pearsonCorrelation(xs, ys);
      out.push({
        metricA,
        metricB,
        correlation: r,
        interpretation: interpretCorrelation(r),
      });
    }
  }

  return out;
}

function interpretCorrelation(r: number): MetricCorrelation['interpretation'] {
  if (r > 0.5) return 'positive';
  if (r < -0.5) return 'negative';
  return 'none';
}

// ─── Serialization ───────────────────────────────────────────────────────────

/**
 * Serializes a `LongitudinalAnalysis` into a compact, LLM-readable text
 * block. The format mirrors `serializeHealthContext` — short, structured,
 * no JSON — so the model can scan it and quote specific numbers.
 *
 * Empty sections are emitted as a single line each so the LLM cannot mistake
 * an empty list for a missing section.
 */
export function serializeLongitudinalAnalysis(analysis: LongitudinalAnalysis): string {
  const lines: string[] = [];

  lines.push(
    `Longitudinal analysis (${analysis.windowDays}-day window, ${analysis.totalReadings} readings):`,
  );

  if (analysis.trends.length > 0) {
    lines.push('Trends:');
    for (const t of analysis.trends) {
      lines.push(
        `  - ${t.metric}: ${t.direction} ` +
          `(slope: ${formatSigned(t.slope)}/day, ` +
          `baseline: ${formatNumber(t.baselineMean)}±${formatNumber(t.baselineStdDev)} ${unitHint(t.metric)}, ` +
          `current: ${formatNumber(t.currentValue)}, ` +
          `deviation: ${formatSigned(t.deviationFromBaseline)}σ)`,
      );
    }
  } else {
    lines.push('Trends: insufficient data (need at least 3 readings per metric)');
  }

  if (analysis.anomalies.length > 0) {
    lines.push('Anomalies:');
    for (const a of analysis.anomalies) {
      lines.push(
        `  - ${a.metric} at ${a.recordedAt}: ${formatNumber(a.value)} ` +
          `(baseline: ${formatNumber(a.baselineMean)}±${formatNumber(a.baselineStdDev)}, ` +
          `z-score: ${formatSigned(a.zScore)}, ${a.severity})`,
      );
    }
  } else {
    lines.push('Anomalies: none detected');
  }

  if (analysis.correlations.length > 0) {
    lines.push('Correlations:');
    for (const c of analysis.correlations) {
      lines.push(
        `  - ${c.metricA} vs ${c.metricB}: ${c.interpretation} (r=${formatSigned(c.correlation)})`,
      );
    }
  } else {
    lines.push('Correlations: insufficient data (need at least 5 readings per metric)');
  }

  return lines.join('\n');
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

/**
 * Formats a number with up to two decimal places, dropping trailing zeros.
 * Numbers are never abbreviated with "k" / "M" — the LLM and the clinician
 * both need the exact figure.
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.parseFloat(n.toFixed(2)).toString();
}

/** Formats a signed number with an explicit leading + or -. */
function formatSigned(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = Number.parseFloat(n.toFixed(2)).toString();
  return n > 0 ? `+${s}` : s;
}

/**
 * Best-effort unit label for the LLM. We do not embed the canonical unit
 * in the trend because the source-of-truth unit lives on the underlying
 * readings and may vary per device; this label is a hint, not a contract.
 */
function unitHint(metric: string): string {
  switch (metric) {
    case 'heart_rate':
      return 'bpm';
    case 'oxygen_saturation':
      return '%';
    case 'body_temperature':
      return '°C';
    case 'blood_pressure_systolic':
    case 'blood_pressure_diastolic':
      return 'mmHg';
    case 'respiratory_rate':
      return '/min';
    default:
      return '';
  }
}

// ─── Rich analysis helpers ───────────────────────────────────────────────────

/**
 * Groups readings by metric name, preserving insertion order for deterministic
 * output.
 */
function groupByMetric(
  readings: readonly VitalPoint[],
): Map<string, VitalPoint[]> {
  const byMetric = new Map<string, VitalPoint[]>();
  for (const r of readings) {
    const list = byMetric.get(r.metric) ?? [];
    list.push(r);
    byMetric.set(r.metric, list);
  }
  return byMetric;
}

/**
 * Computes within-day seasonal patterns for each metric that has enough data.
 *
 * Readings are bucketed into four six-hour UTC blocks:
 *   morning   06:00–12:00
 *   afternoon 12:00–18:00
 *   evening   18:00–24:00
 *   night     00:00–06:00
 *
 * The mean of each bucket is computed and the pattern is classified by which
 * bucket, if any, carries the highest mean.
 */
function computeSeasonalPatterns(
  readings: readonly VitalPoint[],
): readonly SeasonalPattern[] {
  const byMetric = groupByMetric(readings);
  const patterns: SeasonalPattern[] = [];

  for (const [metric, points] of byMetric) {
    if (points.length < MIN_POINTS_FOR_TREND) continue;

    const morning: number[] = [];
    const afternoon: number[] = [];
    const evening: number[] = [];
    const night: number[] = [];

    for (const p of points) {
      const hour = new Date(p.recordedAt).getUTCHours();
      if (hour >= 6 && hour < 12) morning.push(p.value);
      else if (hour >= 12 && hour < 18) afternoon.push(p.value);
      else if (hour >= 18 && hour < 24) evening.push(p.value);
      else night.push(p.value);
    }

    const morningMean = morning.length > 0 ? mean(morning) : 0;
    const afternoonMean = afternoon.length > 0 ? mean(afternoon) : 0;
    const eveningMean = evening.length > 0 ? mean(evening) : 0;
    const nightMean = night.length > 0 ? mean(night) : 0;

    const dayPattern = classifySeasonalPattern(
      morningMean, afternoonMean, eveningMean, nightMean,
      { morning: morning.length, afternoon: afternoon.length, evening: evening.length, night: night.length },
      mean(points.map((p) => p.value)),
    );

    const description = describeSeasonalPattern(metric, dayPattern, {
      morning: morningMean, afternoon: afternoonMean, evening: eveningMean, night: nightMean,
    });

    patterns.push({
      metric,
      dayPattern,
      morningMean,
      afternoonMean,
      eveningMean,
      nightMean,
      description,
    });
  }

  return patterns;
}

/**
 * Classifies the within-day pattern by comparing the four period means.
 * Only periods that actually contain data are considered; a period with no
 * readings is excluded from the comparison.
 */
function classifySeasonalPattern(
  morningMean: number,
  afternoonMean: number,
  eveningMean: number,
  nightMean: number,
  counts: { morning: number; afternoon: number; evening: number; night: number },
  overallMean: number,
): SeasonalPattern['dayPattern'] {
  const periods: { name: 'morning' | 'afternoon' | 'evening' | 'night'; value: number }[] = [];
  if (counts.morning > 0) periods.push({ name: 'morning', value: morningMean });
  if (counts.afternoon > 0) periods.push({ name: 'afternoon', value: afternoonMean });
  if (counts.evening > 0) periods.push({ name: 'evening', value: eveningMean });
  if (counts.night > 0) periods.push({ name: 'night', value: nightMean });

  if (periods.length === 0) return 'flat';
  if (periods.length === 1) return 'flat';

  const values = periods.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const spread = overallMean !== 0 ? (max - min) / Math.abs(overallMean) : 0;

  if (spread < FLAT_PATTERN_SPREAD) return 'flat';

  const highest = periods.find((p) => p.value === max)!;
  if (overallMean !== 0 && max > overallMean * (1 + FLAT_PATTERN_SPREAD)) {
    switch (highest.name) {
      case 'morning': return 'morning_high';
      case 'evening': return 'evening_high';
      case 'night': return 'night_high';
      default: return 'variable';
    }
  }

  return 'variable';
}

/**
 * Produces a human-readable description of the seasonal pattern for LLM
 * consumption.
 */
function describeSeasonalPattern(
  metric: string,
  dayPattern: SeasonalPattern['dayPattern'],
  means: { morning: number; afternoon: number; evening: number; night: number },
): string {
  const label = metricLabel(metric);
  switch (dayPattern) {
    case 'morning_high':
      return `${label} tends to be highest in the morning (${formatNumber(means.morning)}), lower later in the day.`;
    case 'evening_high':
      return `${label} tends to be highest in the evening (${formatNumber(means.evening)}), suggesting end-of-day stress or fatigue.`;
    case 'night_high':
      return `${label} tends to be highest at night (${formatNumber(means.night)}), which may warrant further evaluation.`;
    case 'flat':
      return `${label} is relatively stable throughout the day.`;
    case 'variable':
      return `${label} varies throughout the day without a consistent peak period.`;
  }
}

/**
 * Computes per-metric window-over-window comparisons. For each metric that
 * appears in both windows, the mean of each window is computed and the
 * percent change is derived. The direction interprets the change clinically.
 */
function computeWindowComparison(
  currentReadings: readonly VitalPoint[],
  previousReadings: readonly VitalPoint[],
): readonly LongitudinalComparison[] {
  const currentByMetric = groupByMetric(currentReadings);
  const previousByMetric = groupByMetric(previousReadings);

  const comparisons: LongitudinalComparison[] = [];
  const allMetrics = new Set([...currentByMetric.keys(), ...previousByMetric.keys()]);

  for (const metric of [...allMetrics].sort()) {
    const currentPoints = currentByMetric.get(metric);
    const previousPoints = previousByMetric.get(metric);

    if (!currentPoints || currentPoints.length === 0) continue;
    if (!previousPoints || previousPoints.length === 0) continue;

    const currentWindowMean = mean(currentPoints.map((p) => p.value));
    const previousWindowMean = mean(previousPoints.map((p) => p.value));

    if (previousWindowMean === 0) continue;

    const changePercent =
      ((currentWindowMean - previousWindowMean) / Math.abs(previousWindowMean)) * 100;

    const direction = classifyChangeDirection(metric, changePercent);
    const interpretation = interpretChange(metric, direction, changePercent);

    comparisons.push({
      metric,
      currentWindowMean,
      previousWindowMean,
      changePercent,
      direction,
      interpretation,
    });
  }

  return comparisons;
}

/**
 * Classifies the direction of a window-over-window change using a simple
 * clinical polarity model: for cardiovascular and respiratory metrics lower
 * is better; for oxygen saturation higher is better; for everything else a
 * significant change in either direction is conservatively 'worsening'.
 */
function classifyChangeDirection(
  metric: string,
  changePercent: number,
): LongitudinalComparison['direction'] {
  if (Math.abs(changePercent) < STABLE_CHANGE_PERCENT) return 'stable';

  const lowerIsBetter = LOWER_IS_BETTER.has(metric);
  const higherIsBetter = HIGHER_IS_BETTER.has(metric);

  if (lowerIsBetter) {
    return changePercent < 0 ? 'improving' : 'worsening';
  }
  if (higherIsBetter) {
    return changePercent > 0 ? 'improving' : 'worsening';
  }

  // For unrecognised metrics, any significant change is conservatively
  // 'worsening' — we do not have enough domain knowledge to call it improving.
  return 'worsening';
}

/**
 * Produces a one-sentence clinical interpretation of the window comparison.
 */
function interpretChange(
  metric: string,
  direction: LongitudinalComparison['direction'],
  changePercent: number,
): string {
  const label = metricLabel(metric);
  const change = `${formatSigned(changePercent)}%`;
  switch (direction) {
    case 'improving':
      return `${label} improved by ${change} compared to the previous window.`;
    case 'worsening':
      return `${label} worsened by ${change} compared to the previous window.`;
    case 'stable':
      return `${label} remained stable (${change} change) compared to the previous window.`;
  }
}

/**
 * Computes the overall health trajectory from the current and previous
 * analyses plus the window comparisons.
 *
 * The algorithm weighs three signals:
 *   1. How many metrics are improving vs worsening (window comparison).
 *   2. Whether the anomaly count increased or decreased.
 *   3. The presence of strong inter-metric correlations (which, combined with
 *      mixed directional signals, indicates volatility).
 *
 * 'volatile' is returned when the signals conflict — some metrics improving,
 * some worsening, or anomaly counts rising — rather than forcing a single
 * direction.
 */
function computeHealthTrajectory(
  current: LongitudinalAnalysis,
  previous: LongitudinalAnalysis,
  windowComparison: readonly LongitudinalComparison[],
): { healthTrajectory: RichLongitudinalAnalysis['healthTrajectory']; trajectoryDescription: string } {
  const improving = windowComparison.filter((c) => c.direction === 'improving').length;
  const worsening = windowComparison.filter((c) => c.direction === 'worsening').length;

  const currentAnomalies = current.anomalies.length;
  const previousAnomalies = previous.anomalies.length;
  const anomalyDelta = currentAnomalies - previousAnomalies;

  const strongCorrelations = current.correlations.filter(
    (c) => Math.abs(c.correlation) > 0.7,
  ).length;

  let trajectory: RichLongitudinalAnalysis['healthTrajectory'];

  if (windowComparison.length === 0) {
    // No previous-window data for any metric — assess on current anomalies.
    if (currentAnomalies > 3) {
      trajectory = 'volatile';
    } else {
      trajectory = 'stable';
    }
  } else if (improving > worsening + 1 && anomalyDelta <= 0) {
    trajectory = 'improving';
  } else if (worsening > improving + 1 && anomalyDelta >= 0) {
    trajectory = 'declining';
  } else if (
    (improving > 0 && worsening > 0) ||
    currentAnomalies > 5 ||
    anomalyDelta > 2 ||
    (strongCorrelations > 0 && improving > 0 && worsening > 0)
  ) {
    trajectory = 'volatile';
  } else {
    trajectory = 'stable';
  }

  const description = describeTrajectory(
    trajectory, improving, worsening, currentAnomalies, previousAnomalies, anomalyDelta,
  );

  return { healthTrajectory: trajectory, trajectoryDescription: description };
}

/**
 * Produces a human-readable summary of the trajectory assessment.
 */
function describeTrajectory(
  trajectory: RichLongitudinalAnalysis['healthTrajectory'],
  improving: number,
  worsening: number,
  currentAnomalies: number,
  previousAnomalies: number,
  anomalyDelta: number,
): string {
  const anomalySummary =
    `anomalies: ${currentAnomalies} current vs ${previousAnomalies} previous` +
    (anomalyDelta !== 0 ? ` (${anomalyDelta > 0 ? '+' : ''}${anomalyDelta})` : '');
  const directionSummary =
    `metrics improving: ${improving}, worsening: ${worsening}`;

  switch (trajectory) {
    case 'improving':
      return `Health indicators are trending favourably (${directionSummary}; ${anomalySummary}).`;
    case 'stable':
      return `Health indicators are stable (${directionSummary}; ${anomalySummary}).`;
    case 'declining':
      return `Health indicators are trending unfavourably (${directionSummary}; ${anomalySummary}).`;
    case 'volatile':
      return `Health indicators show mixed or volatile patterns (${directionSummary}; ${anomalySummary}).`;
  }
}

/**
 * Maps a metric code to a human-readable label for LLM consumption.
 */
function metricLabel(metric: string): string {
  switch (metric) {
    case 'heart_rate':
      return 'Heart rate';
    case 'oxygen_saturation':
      return 'Oxygen saturation';
    case 'body_temperature':
      return 'Body temperature';
    case 'blood_pressure_systolic':
      return 'Blood pressure (systolic)';
    case 'blood_pressure_diastolic':
      return 'Blood pressure (diastolic)';
    case 'respiratory_rate':
      return 'Respiratory rate';
    default:
      return metric;
  }
}

// ─── Rich serialization ─────────────────────────────────────────────────────

/**
 * Serializes a `RichLongitudinalAnalysis` into a compact, LLM-readable text
 * block. Includes the base analysis (trends, anomalies, correlations) plus
 * seasonal patterns, window comparison, and health trajectory.
 */
export function serializeRichLongitudinalAnalysis(analysis: RichLongitudinalAnalysis): string {
  const lines: string[] = [];

  // Base analysis
  lines.push(serializeLongitudinalAnalysis(analysis));

  // Seasonal patterns
  lines.push('');
  lines.push('Seasonal patterns:');
  if (analysis.seasonalPatterns.length > 0) {
    for (const sp of analysis.seasonalPatterns) {
      lines.push(
        `  - ${sp.metric}: ${sp.dayPattern} ` +
          `(morning: ${formatNumber(sp.morningMean)}, ` +
          `afternoon: ${formatNumber(sp.afternoonMean)}, ` +
          `evening: ${formatNumber(sp.eveningMean)}, ` +
          `night: ${formatNumber(sp.nightMean)}) — ${sp.description}`,
      );
    }
  } else {
    lines.push('  insufficient data (need at least 3 readings per metric)');
  }

  // Window comparison
  lines.push('');
  lines.push('Window comparison:');
  if (analysis.windowComparison.length > 0) {
    for (const wc of analysis.windowComparison) {
      lines.push(
        `  - ${wc.metric}: ${wc.direction} ` +
          `(current: ${formatNumber(wc.currentWindowMean)}, ` +
          `previous: ${formatNumber(wc.previousWindowMean)}, ` +
          `change: ${formatSigned(wc.changePercent)}%) — ${wc.interpretation}`,
      );
    }
  } else {
    lines.push('  no previous window data available for comparison');
  }

  // Health trajectory
  lines.push('');
  lines.push(`Health trajectory: ${analysis.healthTrajectory}`);
  lines.push(`  ${analysis.trajectoryDescription}`);

  return lines.join('\n');
}
