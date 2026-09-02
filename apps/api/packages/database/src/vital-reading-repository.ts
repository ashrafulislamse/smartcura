import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import { createNotification } from './notification-repository.js';
import {
  HEALTH_ALERT_CHANGED_EVENT_TYPE,
  HEALTH_ALERT_CHANGED_EVENT_VERSION,
  VITAL_READING_CHANGED_EVENT_TYPE,
  VITAL_READING_CHANGED_EVENT_VERSION,
} from './iot-events.js';
import {
  revalidateIotActor,
  type IotActorContext,
  type IotActorFailure,
} from './iot-actor.js';

export type VitalMetricValue =
  | 'heart_rate' | 'oxygen_saturation' | 'body_temperature' | 'systolic_bp'
  | 'diastolic_bp' | 'respiratory_rate' | 'ecg_voltage'
  | 'blood_pressure' | 'blood_glucose' | 'body_weight'
  | 'steps' | 'distance' | 'active_energy' | 'basal_energy' | 'sleep_duration';
export type VitalReadingQualityValue = 'valid' | 'suspect' | 'invalid' | 'unknown';
export type HealthAlertSeverityValue = 'info' | 'warning' | 'critical';
export type HealthAlertStateValue =
  'open' | 'acknowledged' | 'escalated' | 'resolved' | 'dismissed';
export type HealthThresholdComparatorValue = 'lt' | 'lte' | 'gt' | 'gte';
export type ReadingSourceValue = 'device' | 'manual' | 'imported' | 'derived';

/**
 * Metrics whose measurement is a PAIR. `blood_pressure` carries systolic as the
 * primary value and diastolic as the secondary, per the frozen catalogue; every
 * other metric must leave the secondary value absent.
 */
export const PAIRED_VITAL_METRICS: ReadonlySet<VitalMetricValue> =
  new Set<VitalMetricValue>(['blood_pressure']);

/** Canonical unit for each metric. Mirrors `vital_readings_unit_check`. */
export const VITAL_METRIC_UNITS: Readonly<Record<VitalMetricValue, string>> = Object.freeze({
  heart_rate: '/min',
  oxygen_saturation: '%',
  body_temperature: 'Cel',
  blood_pressure: 'mm[Hg]',
  systolic_bp: 'mm[Hg]',
  diastolic_bp: 'mm[Hg]',
  respiratory_rate: '/min',
  blood_glucose: 'mg/dL',
  body_weight: 'kg',
  ecg_voltage: 'mV',
  steps: 'count',
  distance: 'm',
  active_energy: 'kcal',
  basal_energy: 'kcal',
  sleep_duration: 'h',
});

/** Inclusive value bounds per metric. Mirrors `vital_readings_value_range_check`. */
export const VITAL_METRIC_BOUNDS: Readonly<Record<VitalMetricValue, {
  readonly min: number;
  readonly max: number;
}>> = Object.freeze({
  heart_rate: { min: 0.0001, max: 300 },
  oxygen_saturation: { min: 0, max: 100 },
  body_temperature: { min: 20, max: 45 },
  blood_pressure: { min: 0.0001, max: 300 },
  systolic_bp: { min: 0.0001, max: 300 },
  diastolic_bp: { min: 0.0001, max: 200 },
  respiratory_rate: { min: 0.0001, max: 120 },
  blood_glucose: { min: 0.0001, max: 1000 },
  body_weight: { min: 0.0001, max: 500 },
  ecg_voltage: { min: -50, max: 50 },
  steps: { min: 0, max: 100000 },
  distance: { min: 0, max: 100000 },
  active_energy: { min: 0, max: 50000 },
  basal_energy: { min: 0, max: 50000 },
  sleep_duration: { min: 0, max: 24 },
});

/**
 * Only a `valid` reading is clinical truth, so only a `valid` reading may open or
 * advance an alert. `suspect` is retained for data-quality review, `invalid` and
 * `unknown` are retained per ingestion policy but never drive care.
 */
export function readingDrivesAlerts(quality: VitalReadingQualityValue): boolean {
  return quality === 'valid';
}

/**
 * Canonical alert transitions from the frozen catalogue. `resolved` and
 * `dismissed` are terminal, so a closed alert can never silently reopen.
 */
export function healthAlertTransitionAllowed(
  current: HealthAlertStateValue,
  next: HealthAlertStateValue,
): boolean {
  if (current === 'open') {
    return next === 'acknowledged' || next === 'escalated' ||
      next === 'resolved' || next === 'dismissed';
  }
  if (current === 'acknowledged') {
    return next === 'escalated' || next === 'resolved' || next === 'dismissed';
  }
  if (current === 'escalated') return next === 'acknowledged' || next === 'resolved';
  return false;
}

export interface IngestReadingInput {
  /** Device power-cycle counter. Part of the packet identity. */
  readonly bootId: number;
  /** Monotonic per-boot reading counter. Part of the packet identity. */
  readonly sequenceNumber: number;
  readonly metric: VitalMetricValue;
  readonly value: number;
  readonly unit: string;
  readonly recordedAt: Date;
  readonly quality: VitalReadingQualityValue;
}

export interface IngestBatchInput {
  readonly deviceId: string;
  /** The organization the actor is acting under. The device must belong to it. */
  readonly organizationId: string;
  /**
   * The human whose action this is, or NULL when the actor is the device itself.
   *
   * MQTT ingestion has no person behind it. Inventing one would put a clinician's name on
   * data they never touched, and the audit trail would then assert something false about who
   * acted. Audit rows already permit a null actor for exactly this reason.
   */
  readonly actorProfileId: string | null;
  readonly actor: IotActorContext;
  readonly readings: readonly IngestReadingInput[];
  /**
   * Accepted replay window. A packet older than this is REJECTED rather than
   * stored: past the window its dedupe claim may already have been purged, so the
   * ledger can no longer prove the packet was not already accepted, and inserting
   * it would create exactly the duplicate the ledger exists to prevent.
   */
  readonly replayWindowMs: number;
  /** Tolerated device clock lead. A reading from the future is not accepted. */
  readonly clockSkewToleranceMs: number;
  readonly now: Date;
  readonly correlationId: string;
}

export interface AcceptedReading {
  readonly readingId: string;
  readonly metric: VitalMetricValue;
  readonly value: number;
  readonly unit: string;
  readonly recordedAt: Date;
  readonly quality: VitalReadingQualityValue;
}

export interface IngestBatchOutcome {
  readonly deviceId: string;
  readonly patientProfileId: string;
  /** Readings stored by this call. */
  readonly accepted: number;
  /**
   * Readings whose packet identity was already claimed. A replayed batch reports
   * every reading here and stores nothing, which is the observable proof that
   * QoS-1 redelivery cannot duplicate data.
   */
  readonly deduplicated: number;
  /** Readings outside the accepted replay window or clock tolerance. */
  readonly rejected: number;
  readonly alertsRaised: number;
  readonly acceptedReadings: readonly AcceptedReading[];
}

export type IngestBatchResult = IngestBatchOutcome |
  'device_not_found' | 'device_not_ingestible' | 'device_not_assigned' |
  'patient_mismatch' | IotActorFailure;

export interface HealthAlertRecord {
  readonly alertId: string;
  readonly organizationId: string;
  readonly patientProfileId: string;
  readonly deviceId: string;
  readonly metric: VitalMetricValue;
  readonly observedValue: number;
  readonly thresholdId: string;
  readonly severity: HealthAlertSeverityValue;
  readonly state: HealthAlertStateValue;
  readonly observedAt: Date;
  readonly acknowledgedByProfileId: string | null;
  readonly acknowledgedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface VitalReadingRecord {
  readonly readingId: string;
  readonly deviceId: string;
  readonly patientProfileId: string;
  readonly metric: VitalMetricValue;
  readonly value: number;
  readonly unit: string;
  readonly recordedAt: Date;
  readonly ingestedAt: Date;
  readonly quality: VitalReadingQualityValue;
}

export interface ListReadingsInput {
  readonly patientProfileId: string;
  readonly metric?: VitalMetricValue;
  readonly deviceId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly beforeRecordedAt?: Date;
  readonly beforeReadingId?: string;
  readonly limit: number;
}

export interface ListAlertsInput {
  readonly patientProfileId: string;
  readonly state?: HealthAlertStateValue;
  readonly beforeObservedAt?: Date;
  readonly beforeAlertId?: string;
  readonly limit: number;
}

export interface AcknowledgeAlertInput {
  readonly alertId: string;
  readonly organizationId: string;
  readonly actorProfileId: string;
  readonly actor: IotActorContext;
  /** Membership whose active care assignment authorises the acknowledgement. */
  readonly clinicianMembershipId: string;
  readonly expectedVersion: number;
  readonly now: Date;
  readonly correlationId: string;
}

export type AcknowledgeAlertResult = HealthAlertRecord |
  'not_found' | 'version_conflict' | 'alert_not_open' |
  'care_assignment_required' | IotActorFailure;

interface ThresholdRow extends QueryResultRow {
  readonly thresholdId: string;
  readonly metric: VitalMetricValue;
  readonly comparator: HealthThresholdComparatorValue;
  readonly thresholdValue: number;
  readonly severity: HealthAlertSeverityValue;
  readonly patientScoped: boolean;
}

interface StoredReadingRow extends QueryResultRow {
  readonly readingId: string;
  readonly metric: VitalMetricValue;
  readonly value: number;
  readonly unit: string;
  readonly recordedAt: Date;
  readonly quality: VitalReadingQualityValue;
}

interface DeviceIngestRow extends QueryResultRow {
  readonly organizationId: string;
  readonly state: string;
  readonly patientProfileId: string | null;
}

interface AlertRow extends QueryResultRow, HealthAlertRecord {}
interface ReadingRow extends QueryResultRow, VitalReadingRecord {}

export class VitalReadingRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * The organization a device belongs to.
   *
   * MQTT ingestion has no session to carry an organization, and the organization must not come
   * from the payload — a device that could name its own organization could write into another
   * tenant. So it is resolved from the device record itself.
   */
  async organizationForDevice(deviceId: string): Promise<string | undefined> {
    const found = await this.database.query<{ organizationId: string }>(
      'SELECT organization_id AS "organizationId" FROM devices WHERE device_id = $1',
      [deviceId],
    );
    return found.rows[0]?.organizationId;
  }

  /**
   * Ingests a batch of readings, evaluates thresholds and publishes, all in ONE
   * transaction.
   *
   * Threshold evaluation is inside the same transaction on purpose. If alerting
   * ran afterwards, a crash between the reading commit and the alert write would
   * leave a stored breach that nobody was ever told about — a silent clinical
   * failure. Committing together means an alert exists if and only if the reading
   * that triggered it exists.
   *
   * Idempotence comes from `vital_reading_ingest_claims`, whose primary key is
   * `(device_id, boot_id, sequence_number)`. The claim insert uses
   * `ON CONFLICT DO NOTHING`, so a redelivered packet claims nothing, stores no
   * reading, raises no alert and publishes no event; it is simply counted as
   * deduplicated.
   *
   * Lock order is actor session, then device — the same relative order
   * `DeviceRepository` takes, so ingestion cannot deadlock against assignment.
   */
  async ingestBatch(input: IngestBatchInput): Promise<IngestBatchResult> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateIotActor(
        client, input.actor, input.organizationId, input.now,
      );
      if (actorFailure !== undefined) return actorFailure;

      const device = await client.query<DeviceIngestRow>(
        `SELECT device.organization_id AS "organizationId", device.state,
         assignment.patient_profile_id AS "patientProfileId"
         FROM devices device
         LEFT JOIN device_assignments assignment
           ON assignment.device_id = device.device_id AND assignment.released_at IS NULL
         WHERE device.device_id = $1
         FOR NO KEY UPDATE OF device`,
        [input.deviceId],
      );
      const row = device.rows[0];
      // An organization mismatch is reported as "not found": telling a caller in
      // organization A that a serial in organization B exists is itself a leak.
      if (row === undefined || row.organizationId !== input.organizationId) {
        return 'device_not_found';
      }
      // Only an active device may ingest. A suspended or retired device that is
      // still physically connected must not be able to write clinical data.
      if (row.state !== 'active') return 'device_not_ingestible';
      const patientProfileId = row.patientProfileId;
      if (patientProfileId === null) return 'device_not_assigned';
      // A self actor may only ingest for the device currently assigned to them.
      // The patient identity is resolved server side from the assignment; a
      // client-supplied patient id is never trusted.
      if (input.actor.kind === 'self' && patientProfileId !== input.actorProfileId) {
        return 'patient_mismatch';
      }

      const admissible = admissibleReadings(input);
      const rejected = input.readings.length - admissible.length;
      if (admissible.length === 0) {
        await this.recordIngestAudit(client, input, patientProfileId, {
          accepted: 0, deduplicated: 0, rejected, alertsRaised: 0,
        });
        return {
          deviceId: input.deviceId,
          patientProfileId,
          accepted: 0,
          deduplicated: 0,
          rejected,
          alertsRaised: 0,
          acceptedReadings: [],
        };
      }

      const stored = await this.storeReadings(client, input, patientProfileId, admissible);
      const deduplicated = admissible.length - stored.length;
      if (stored.length > 0) {
        await this.updateAggregates(client, input, patientProfileId, stored);
        for (const reading of stored) {
          await appendReadingChangedEvent(
            client, input.deviceId, patientProfileId, reading, input.correlationId, input.now,
          );
        }
      }
      const alerts = await this.evaluateThresholds(
        client, input, row.organizationId, patientProfileId, stored,
      );
      await client.query(
        `UPDATE devices SET last_seen_at = $2, updated_at = $2
         WHERE device_id = $1 AND (last_seen_at IS NULL OR last_seen_at < $2)`,
        [input.deviceId, input.now],
      );
      await this.recordIngestAudit(client, input, patientProfileId, {
        accepted: stored.length,
        deduplicated,
        rejected,
        alertsRaised: alerts.length,
      });
      return {
        deviceId: input.deviceId,
        patientProfileId,
        accepted: stored.length,
        deduplicated,
        rejected,
        alertsRaised: alerts.length,
        acceptedReadings: stored.map((reading) => ({
          readingId: reading.readingId,
          metric: reading.metric,
          value: reading.value,
          unit: reading.unit,
          recordedAt: reading.recordedAt,
          quality: reading.quality,
        })),
      };
    });
  }

  /**
   * Claims each packet identity and stores the readings whose claim succeeded, in
   * a single statement. Batching matters for offline replay: a device that was
   * disconnected for an hour uploads its whole buffer at once, and a per-reading
   * round trip would multiply that into hundreds of network waits inside one
   * transaction.
   *
   * The claim insert is the arbiter. `vital_readings` is only inserted for rows
   * that claimed successfully, so the reading table can never contain a row whose
   * packet identity is unclaimed.
   */
  private async storeReadings(
    client: PoolClient,
    input: IngestBatchInput,
    patientProfileId: string,
    readings: readonly IngestReadingInput[],
  ): Promise<StoredReadingRow[]> {
    const claimExpiresAt = new Date(input.now.getTime() + input.replayWindowMs);
    const result = await client.query<StoredReadingRow>(
      `WITH incoming AS (
         SELECT * FROM unnest(
           $2::bigint[], $3::bigint[], $4::vital_metric[], $5::numeric[],
           $6::text[], $7::timestamptz[], $8::vital_reading_quality[]
         ) AS t(boot_id, sequence_number, metric, value, unit, recorded_at, quality)
       ), claimed AS (
         INSERT INTO vital_reading_ingest_claims
         (device_id, boot_id, sequence_number, reading_id, recorded_at,
          first_ingested_at, expires_at)
         SELECT $1, incoming.boot_id, incoming.sequence_number, uuidv7(),
           incoming.recorded_at, $9, $10
         FROM incoming
         ON CONFLICT (device_id, boot_id, sequence_number) DO NOTHING
         RETURNING boot_id, sequence_number, reading_id
       ), stored AS (
         INSERT INTO vital_readings
         (reading_id, device_id, patient_profile_id, metric, value, unit,
          recorded_at, ingested_at, boot_id, sequence_number, quality)
         SELECT claimed.reading_id, $1, $11, incoming.metric, incoming.value,
           incoming.unit, incoming.recorded_at,
           -- The vital_readings_ingested_order_check constraint forbids an ingest
           -- time earlier than the recorded time. Identifier names in SQL comments
           -- must not be wrapped in backticks: this string is a template literal,
           -- so a backtick here would terminate it and corrupt the surrounding code.
           -- the recorded time. A reading inside the tolerated clock lead is
           -- stamped with its own recorded time rather than aborting the whole
           -- batch on a constraint violation.
           greatest($9::timestamptz, incoming.recorded_at), incoming.boot_id,
           incoming.sequence_number, incoming.quality
         FROM claimed
         JOIN incoming ON incoming.boot_id = claimed.boot_id
           AND incoming.sequence_number = claimed.sequence_number
         ON CONFLICT DO NOTHING
         RETURNING reading_id, metric, value, unit, recorded_at, quality
       )
       SELECT reading_id AS "readingId", metric,
         value::double precision AS value, unit,
         recorded_at AS "recordedAt", quality
       FROM stored
       ORDER BY recorded_at, reading_id`,
      [
        input.deviceId,
        readings.map((reading) => reading.bootId),
        readings.map((reading) => reading.sequenceNumber),
        readings.map((reading) => reading.metric),
        readings.map((reading) => reading.value),
        readings.map((reading) => reading.unit),
        readings.map((reading) => reading.recordedAt),
        readings.map((reading) => reading.quality),
        input.now,
        claimExpiresAt,
        patientProfileId,
      ],
    );
    return result.rows;
  }

  /**
   * Extends the hourly rollups with the readings accepted by THIS call. Replays
   * contribute nothing because they never reach here, so a bucket can never
   * double count a redelivered packet.
   *
   * `bad` quality readings are excluded: an instrument-flagged failure is not a
   * measurement, and averaging it in would move a clinician's chart.
   */
  private async updateAggregates(
    client: PoolClient,
    input: IngestBatchInput,
    patientProfileId: string,
    stored: readonly StoredReadingRow[],
  ): Promise<void> {
    // `invalid` and `unknown` readings are retained as rows but must never reach a
    // chart: an instrument fault would otherwise move the average a clinician reads.
    // `suspect` is kept so a data-quality problem stays visible instead of vanishing.
    const usable = stored.filter(
      (reading) => reading.quality === 'valid' || reading.quality === 'suspect',
    );
    if (usable.length === 0) return;
    await client.query(
      `INSERT INTO vital_reading_aggregates
       (device_id, patient_profile_id, metric, bucket_start, sample_count,
        value_sum, value_min, value_max, updated_at)
       SELECT $1, $2, incoming.metric,
         date_trunc('hour', incoming.recorded_at, 'UTC'),
         count(*)::integer, sum(incoming.value), min(incoming.value),
         max(incoming.value), $3
       FROM unnest($4::vital_metric[], $5::numeric[], $6::timestamptz[])
         AS incoming(metric, value, recorded_at)
       GROUP BY incoming.metric, date_trunc('hour', incoming.recorded_at, 'UTC')
       ON CONFLICT (device_id, patient_profile_id, metric, bucket_start) DO UPDATE
       SET sample_count = vital_reading_aggregates.sample_count + EXCLUDED.sample_count,
           value_sum = vital_reading_aggregates.value_sum + EXCLUDED.value_sum,
           value_min = least(vital_reading_aggregates.value_min, EXCLUDED.value_min),
           value_max = greatest(vital_reading_aggregates.value_max, EXCLUDED.value_max),
           updated_at = EXCLUDED.updated_at`,
      [
        input.deviceId,
        patientProfileId,
        input.now,
        usable.map((reading) => reading.metric),
        usable.map((reading) => reading.value),
        usable.map((reading) => reading.recordedAt),
      ],
    );
  }

  /**
   * Evaluates every applicable threshold against the accepted readings and opens
   * an alert per breach, inside the ingestion transaction.
   *
   * A patient-scoped threshold overrides the organization default for the same
   * metric, comparator and severity. `bad` quality readings never raise an alert:
   * waking a clinician for a reading the instrument itself rejected trains people
   * to ignore alerts.
   */
  private async evaluateThresholds(
    client: PoolClient,
    input: IngestBatchInput,
    organizationId: string,
    patientProfileId: string,
    stored: readonly StoredReadingRow[],
  ): Promise<HealthAlertRecord[]> {
    // ASSERTION: only a `valid` reading is clinical truth, so only a `valid`
    // reading may open an alert. Admitting `suspect` here would let an instrument
    // fault page an on-call doctor about a patient who is fine.
    const usable = stored.filter((reading) => readingDrivesAlerts(reading.quality));
    if (usable.length === 0) return [];
    const metrics = [...new Set(usable.map((reading) => reading.metric))];
    const thresholds = await client.query<ThresholdRow>(
      `SELECT threshold_id AS "thresholdId", metric, comparator,
       threshold_value::double precision AS "thresholdValue", severity,
       (patient_profile_id IS NOT NULL) AS "patientScoped"
       FROM health_alert_thresholds
       WHERE organization_id = $1 AND retired_at IS NULL
         AND metric = ANY($3::vital_metric[])
         AND (patient_profile_id IS NULL OR patient_profile_id = $2)
       ORDER BY metric, comparator, severity, (patient_profile_id IS NOT NULL) DESC`,
      [organizationId, patientProfileId, metrics],
    );
    const effective = effectiveThresholds(thresholds.rows);
    const raised: HealthAlertRecord[] = [];
    for (const reading of usable) {
      for (const threshold of effective) {
        if (threshold.metric !== reading.metric) continue;
        if (!breaches(reading.value, threshold)) continue;
        const alert = await this.openAlert(
          client, input, organizationId, patientProfileId, reading, threshold,
        );
        if (alert !== undefined) raised.push(alert);
      }
    }
    return raised;
  }

  /**
   * Opens one alert. `ON CONFLICT DO NOTHING` against `health_alerts_live_uq` is
   * what makes a sustained breach raise exactly one alert instead of one per
   * reading: while an alert for the same patient, metric and threshold is still
   * open or acknowledged, later breaches add nothing and publish nothing.
   */
  private async openAlert(
    client: PoolClient,
    input: IngestBatchInput,
    organizationId: string,
    patientProfileId: string,
    reading: StoredReadingRow,
    threshold: ThresholdRow,
  ): Promise<HealthAlertRecord | undefined> {
    const inserted = await client.query<AlertRow>(
      `INSERT INTO health_alerts
       (alert_id, organization_id, patient_profile_id, device_id, metric,
        observed_value, threshold_id, severity, state, observed_at, updated_at)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, 'open', $8, $9)
       ON CONFLICT DO NOTHING
       ${alertReturning()}`,
      [
        organizationId, patientProfileId, input.deviceId, reading.metric,
        reading.value, threshold.thresholdId, threshold.severity,
        reading.recordedAt, input.now,
      ],
    );
    const alert = inserted.rows[0];
    if (alert === undefined) return undefined;
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, 'health_alert.opened', 'health_alert', $3, $4, $5, $6)`,
      [
        organizationId, input.actorProfileId, alert.alertId, 'threshold_breached',
        input.correlationId, {
          metric: alert.metric,
          severity: alert.severity,
          threshold_id: threshold.thresholdId,
          comparator: threshold.comparator,
          device_id: input.deviceId,
        },
      ],
    );
    await appendAlertChangedEvent(client, alert, input.correlationId, input.now);
    // A CRITICAL alert is the only reading-derived event a clinician must be
    // interrupted for. Warning/info alerts stay in the monitoring views. The
    // doctors notified are exactly those holding an active care assignment for
    // this patient; push is mandatory because a muted critical alert is the
    // failure mode the whole alerting path exists to prevent.
    if (alert.severity === 'critical') {
      const clinicians = (await client.query<{ readonly profileId: string }>(
        `SELECT membership.profile_id AS "profileId"
           FROM care_assignments assignment
           JOIN organization_memberships membership
             ON membership.membership_id = assignment.clinician_membership_id
          WHERE assignment.patient_profile_id = $1
            AND assignment.organization_id = $2
            AND assignment.status = 'active'`,
        [patientProfileId, organizationId],
      )).rows;
      for (const clinician of clinicians) {
        await createNotification(client, {
          profileId: clinician.profileId,
          category: 'vitals_alerts',
          resourceType: 'health_alert',
          // The patient profile id is the deep-link target: the doctor app's
          // patient-details screen (which shows the active alerts list with an
          // acknowledge action) is keyed by `?id=<patientProfileId>`. Using the
          // alert id here would not resolve to any screen.
          resourceId: patientProfileId,
          titleCode: 'health.alert.raised.title',
          bodyCode: 'health.alert.raised.body',
          priority: 'high',
          mandatoryPush: true,
          correlationId: input.correlationId,
          now: new Date(),
        });
      }
    }
    return alert;
  }

  private async recordIngestAudit(
    client: PoolClient,
    input: IngestBatchInput,
    patientProfileId: string,
    counts: {
      readonly accepted: number;
      readonly deduplicated: number;
      readonly rejected: number;
      readonly alertsRaised: number;
    },
  ): Promise<void> {
    // Counts only. No measured value ever enters an audit row: audit logs are
    // retained longer and read more widely than clinical records.
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, 'reading.ingested', 'device', $3, $4, $5)`,
      [
        input.organizationId, input.actorProfileId, input.deviceId,
        input.correlationId, {
          patient_profile_id: patientProfileId,
          submitted: input.readings.length,
          accepted: counts.accepted,
          deduplicated: counts.deduplicated,
          rejected: counts.rejected,
          alerts_raised: counts.alertsRaised,
        },
      ],
    );
  }

  /**
   * Newest-first keyset pagination on `(recorded_at, reading_id)`. Both columns
   * are in the key because `recorded_at` is not unique: a device reporting two
   * metrics in the same millisecond would otherwise repeat or skip a row at the
   * page boundary. A bounded time predicate also lets PostgreSQL prune partitions.
   */
  async listReadings(input: ListReadingsInput): Promise<VitalReadingRecord[]> {
    const result = await this.database.query<ReadingRow>(
      `SELECT reading.reading_id AS "readingId", reading.device_id AS "deviceId",
       reading.patient_profile_id AS "patientProfileId", reading.metric,
       reading.value::double precision AS value, reading.unit,
       reading.recorded_at AS "recordedAt", reading.ingested_at AS "ingestedAt",
       reading.quality
       FROM vital_readings reading
       WHERE reading.patient_profile_id = $1
         AND ($2::vital_metric IS NULL OR reading.metric = $2::vital_metric)
         AND ($3::uuid IS NULL OR reading.device_id = $3::uuid)
         AND ($4::timestamptz IS NULL OR reading.recorded_at >= $4)
         AND ($5::timestamptz IS NULL OR reading.recorded_at < $5)
         AND ($6::timestamptz IS NULL OR
           (reading.recorded_at, reading.reading_id) < ($6, $7::uuid))
       ORDER BY reading.recorded_at DESC, reading.reading_id DESC
       LIMIT $8`,
      [
        input.patientProfileId,
        input.metric ?? null,
        input.deviceId ?? null,
        input.from ?? null,
        input.to ?? null,
        input.beforeRecordedAt ?? null,
        input.beforeReadingId ?? null,
        input.limit,
      ],
    );
    return result.rows;
  }

  async listAlerts(input: ListAlertsInput): Promise<HealthAlertRecord[]> {
    const result = await this.database.query<AlertRow>(
      `${alertProjection()}
       WHERE alert.patient_profile_id = $1
         AND ($2::text IS NULL OR alert.state = $2::health_alert_state)
         AND ($3::timestamptz IS NULL OR
           (alert.observed_at, alert.alert_id) < ($3, $4::uuid))
       ORDER BY alert.observed_at DESC, alert.alert_id DESC
       LIMIT $5`,
      [
        input.patientProfileId,
        input.state ?? null,
        input.beforeObservedAt ?? null,
        input.beforeAlertId ?? null,
        input.limit,
      ],
    );
    return result.rows;
  }

  async getAlert(alertId: string): Promise<HealthAlertRecord | undefined> {
    const result = await this.database.query<AlertRow>(
      `${alertProjection()} WHERE alert.alert_id = $1`,
      [alertId],
    );
    return result.rows[0];
  }

  /**
   * Is this clinician membership actively assigned to this patient? `assigned`
   * scope in the policy engine means exactly this relationship, and
   * `care_assignments` is its only source of truth.
   */
  async hasActiveCareAssignment(
    clinicianMembershipId: string,
    patientProfileId: string,
  ): Promise<boolean> {
    const result = await this.database.query<{ readonly assigned: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM care_assignments
         WHERE clinician_membership_id = $1 AND patient_profile_id = $2
           AND status = 'active'
       ) AS assigned`,
      [clinicianMembershipId, patientProfileId],
    );
    return result.rows[0]?.assigned === true;
  }

  /**
   * Acknowledges an alert under optimistic concurrency. The care assignment is
   * re-proved inside the transaction: a clinician whose assignment ended between
   * the HTTP guard and the write must not be able to acknowledge.
   */
  async acknowledge(input: AcknowledgeAlertInput): Promise<AcknowledgeAlertResult> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateIotActor(
        client, input.actor, input.organizationId, input.now,
      );
      if (actorFailure !== undefined) return actorFailure;

      const current = await client.query<AlertRow>(
        `${alertProjection()}
         WHERE alert.alert_id = $1 AND alert.organization_id = $2
         FOR UPDATE OF alert`,
        [input.alertId, input.organizationId],
      );
      const alert = current.rows[0];
      if (alert === undefined) return 'not_found';
      // FOR SHARE pins the assignment for the rest of the transaction so a
      // concurrent revocation cannot slip in between this check and the write.
      // The lock is taken on rows in a deterministic order to keep the lock
      // sequence predictable.
      const assigned = await client.query(
        `SELECT assignment_id FROM care_assignments
         WHERE clinician_membership_id = $1 AND patient_profile_id = $2
           AND status = 'active'
         ORDER BY assignment_id
         FOR SHARE`,
        [input.clinicianMembershipId, alert.patientProfileId],
      );
      if (assigned.rows.length === 0) return 'care_assignment_required';
      if (alert.version !== input.expectedVersion) return 'version_conflict';
      // Already acknowledged is reported as-is rather than as an error: a retried
      // acknowledgement is not a failure, and the version check above already
      // rejected a stale writer.
      if (alert.state === 'acknowledged') return alert;
      if (alert.state !== 'open') return 'alert_not_open';

      await client.query(
        `UPDATE health_alerts
         SET state = 'acknowledged', acknowledged_by_profile_id = $2,
             acknowledged_at = $3, version = version + 1, updated_at = $3
         WHERE alert_id = $1 AND version = $4`,
        [input.alertId, input.actorProfileId, input.now, input.expectedVersion],
      );
      const refreshed = await client.query<AlertRow>(
        `${alertProjection()} WHERE alert.alert_id = $1 FOR UPDATE OF alert`,
        [input.alertId],
      );
      const updated = refreshed.rows[0];
      if (updated === undefined) throw new Error('Alert disappeared during acknowledgement');
      await client.query(
        `INSERT INTO audit_logs
         (audit_id, organization_id, actor_profile_id, action, object_type,
          object_id, reason, correlation_id, metadata)
         VALUES (uuidv7(), $1, $2, 'health_alert.acknowledged', 'health_alert',
          $3, 'clinician_acknowledged', $4, $5)`,
        [
          updated.organizationId, input.actorProfileId, updated.alertId,
          input.correlationId, {
            previous_state: alert.state,
            next_state: updated.state,
            severity: updated.severity,
            metric: updated.metric,
            version: updated.version,
          },
        ],
      );
      await appendAlertChangedEvent(client, updated, input.correlationId, input.now);
      return updated;
    });
  }

  /**
   * Escalates an alert to a named membership, or resolves/dismisses it.
   *
   * Escalation is recorded as an append-only `health_alert_escalations` row rather
   * than a column, because one alert may escalate more than once and each hop
   * needs its own actor, target and reason for later review. The transition itself
   * is checked against `healthAlertTransitionAllowed`, so a resolved alert can
   * never be reopened by a late writer.
   */
  async transitionAlert(input: {
    readonly alertId: string;
    readonly organizationId: string;
    readonly nextState: Extract<HealthAlertStateValue, 'escalated' | 'resolved' | 'dismissed'>;
    readonly reasonCode: string;
    readonly escalatedToMembershipId: string | null;
    readonly clinicianMembershipId: string;
    readonly actorProfileId: string;
    readonly actor: IotActorContext;
    readonly expectedVersion: number;
    readonly now: Date;
    readonly correlationId: string;
  }): Promise<AcknowledgeAlertResult> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateIotActor(
        client, input.actor, input.organizationId, input.now,
      );
      if (actorFailure !== undefined) return actorFailure;
      const current = await client.query<AlertRow>(
        `${alertProjection()}
         WHERE alert.alert_id = $1 AND alert.organization_id = $2
         FOR UPDATE OF alert`,
        [input.alertId, input.organizationId],
      );
      const alert = current.rows[0];
      if (alert === undefined) return 'not_found';
      const assigned = await client.query(
        `SELECT assignment_id FROM care_assignments
         WHERE clinician_membership_id = $1 AND patient_profile_id = $2
           AND status = 'active'
         ORDER BY assignment_id
         FOR SHARE`,
        [input.clinicianMembershipId, alert.patientProfileId],
      );
      if (assigned.rows.length === 0) return 'care_assignment_required';
      if (alert.version !== input.expectedVersion) return 'version_conflict';
      if (alert.state === input.nextState) return alert;
      if (!healthAlertTransitionAllowed(alert.state, input.nextState)) return 'alert_not_open';

      // Derived in TypeScript; see the `42P08` note in `pharmacy-repository`.
      const resolvedAt = input.nextState === 'resolved' || input.nextState === 'dismissed'
        ? input.now
        : null;
      await client.query(
        `UPDATE health_alerts
         SET state = $2,
             resolved_at = COALESCE($5, resolved_at),
             version = version + 1, updated_at = $3
         WHERE alert_id = $1 AND version = $4`,
        [input.alertId, input.nextState, input.now, input.expectedVersion, resolvedAt],
      );
      if (input.nextState === 'escalated') {
        await client.query(
          `INSERT INTO health_alert_escalations
           (alert_id, escalated_to_membership_id, reason_code, actor_profile_id,
            correlation_id, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [input.alertId, input.escalatedToMembershipId, input.reasonCode,
            input.actorProfileId, input.correlationId, input.now],
        );
      }
      const refreshed = await client.query<AlertRow>(
        `${alertProjection()} WHERE alert.alert_id = $1 FOR UPDATE OF alert`,
        [input.alertId],
      );
      const updated = refreshed.rows[0];
      if (updated === undefined) throw new Error('Alert disappeared during transition');
      await client.query(
        `INSERT INTO audit_logs
         (audit_id, organization_id, actor_profile_id, action, object_type,
          object_id, reason, correlation_id, metadata)
         VALUES (uuidv7(), $1, $2, $3, 'health_alert', $4, $5, $6, $7)`,
        [
          updated.organizationId, input.actorProfileId,
          `health_alert.${input.nextState}`, updated.alertId, input.reasonCode,
          input.correlationId, {
            previous_state: alert.state,
            next_state: updated.state,
            severity: updated.severity,
            metric: updated.metric,
            version: updated.version,
          },
        ],
      );
      await appendAlertChangedEvent(client, updated, input.correlationId, input.now);
      return updated;
    });
  }

  async recordDenial(
    organizationId: string | null,
    objectType: 'device' | 'health_alert' | 'profile',
    objectId: string | null,
    actorProfileId: string,
    action: string,
    code: string,
    correlationId: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(),
        CASE WHEN $1::uuid IS NOT NULL AND EXISTS (
          SELECT 1 FROM organizations WHERE organization_id = $1::uuid
        ) THEN $1::uuid ELSE NULL END,
        $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId, actorProfileId, action, objectType, objectId, code,
        correlationId, { denial_code: code },
      ],
    );
  }
}

/**
 * Filters the batch down to readings that may be stored, and removes intra-batch
 * duplicates deterministically.
 *
 * Intra-batch duplicates are dropped in application code as well as by the
 * ledger, so the accepted and deduplicated counts a client sees are the same on
 * every run for the same input.
 */
function admissibleReadings(input: IngestBatchInput): IngestReadingInput[] {
  const oldestAccepted = input.now.getTime() - input.replayWindowMs;
  const newestAccepted = input.now.getTime() + input.clockSkewToleranceMs;
  const seen = new Set<string>();
  const admissible: IngestReadingInput[] = [];
  for (const reading of input.readings) {
    const recordedAt = reading.recordedAt.getTime();
    if (recordedAt < oldestAccepted || recordedAt > newestAccepted) continue;
    const identity = `${reading.bootId}:${reading.sequenceNumber}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    admissible.push(reading);
  }
  return admissible;
}

/**
 * Collapses organization and patient thresholds so a patient-scoped row wins for
 * the same metric, comparator and severity. The organization default is left in
 * place in the database, so retiring the override restores it.
 */
function effectiveThresholds(rows: readonly ThresholdRow[]): ThresholdRow[] {
  const chosen = new Map<string, ThresholdRow>();
  for (const row of rows) {
    const key = `${row.metric}|${row.comparator}|${row.severity}`;
    const existing = chosen.get(key);
    if (existing === undefined || (row.patientScoped && !existing.patientScoped)) {
      chosen.set(key, row);
    }
  }
  return [...chosen.values()];
}

function breaches(value: number, threshold: ThresholdRow): boolean {
  switch (threshold.comparator) {
    case 'lt': return value < threshold.thresholdValue;
    case 'lte': return value <= threshold.thresholdValue;
    case 'gt': return value > threshold.thresholdValue;
    case 'gte': return value >= threshold.thresholdValue;
  }
}

/**
 * Single writer for the published reading event. Restricted to the six fields
 * `VitalReadingChangedData` declares; that schema sets
 * `additionalProperties: false`, so an extra key would dead-letter in the worker.
 * The measured value is deliberately absent — an event stream fans out far more
 * widely than an authorized read.
 */
async function appendReadingChangedEvent(
  client: PoolClient,
  deviceId: string,
  patientProfileId: string,
  reading: StoredReadingRow,
  correlationId: string,
  occurredAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events
     (event_id, event_type, event_version, aggregate_type, aggregate_id,
      aggregate_version, payload, correlation_id, occurred_at)
     VALUES (uuidv7(), $1, $2, 'vital_reading', $3, 1, $4, $5, $6)`,
    [
      VITAL_READING_CHANGED_EVENT_TYPE,
      VITAL_READING_CHANGED_EVENT_VERSION,
      reading.readingId,
      {
        reading_id: reading.readingId,
        device_id: deviceId,
        patient_profile_id: patientProfileId,
        metric: reading.metric,
        quality: reading.quality,
        recorded_at: reading.recordedAt.toISOString(),
      },
      correlationId,
      occurredAt,
    ],
  );
}

/**
 * Single writer for the published alert event. `observed_value` is excluded on
 * purpose: it is clinical data, and the event only needs to tell a subscriber
 * that something changed and how severe it is.
 */
async function appendAlertChangedEvent(
  client: PoolClient,
  alert: HealthAlertRecord,
  correlationId: string,
  occurredAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events
     (event_id, event_type, event_version, aggregate_type, aggregate_id,
      aggregate_version, payload, correlation_id, occurred_at)
     VALUES (uuidv7(), $1, $2, 'health_alert', $3, $4, $5, $6, $7)`,
    [
      HEALTH_ALERT_CHANGED_EVENT_TYPE,
      HEALTH_ALERT_CHANGED_EVENT_VERSION,
      alert.alertId,
      alert.version,
      {
        alert_id: alert.alertId,
        patient_profile_id: alert.patientProfileId,
        metric: alert.metric,
        severity: alert.severity,
        state: alert.state,
      },
      correlationId,
      occurredAt,
    ],
  );
}

export function serializeVitalReading(record: VitalReadingRecord): Record<string, unknown> {
  return {
    id: record.readingId,
    device_id: record.deviceId,
    patient_profile_id: record.patientProfileId,
    metric: record.metric,
    value: record.value,
    unit: record.unit,
    recorded_at: record.recordedAt.toISOString(),
    ingested_at: record.ingestedAt.toISOString(),
    quality: record.quality,
  };
}

export function serializeHealthAlert(record: HealthAlertRecord): Record<string, unknown> {
  return {
    id: record.alertId,
    organization_id: record.organizationId,
    patient_profile_id: record.patientProfileId,
    device_id: record.deviceId,
    metric: record.metric,
    observed_value: record.observedValue,
    threshold_id: record.thresholdId,
    severity: record.severity,
    state: record.state,
    observed_at: record.observedAt.toISOString(),
    acknowledged_by_profile_id: record.acknowledgedByProfileId,
    acknowledged_at: record.acknowledgedAt?.toISOString() ?? null,
    resolved_at: record.resolvedAt?.toISOString() ?? null,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function alertProjection(): string {
  return `SELECT alert.alert_id AS "alertId",
   alert.organization_id AS "organizationId",
   alert.patient_profile_id AS "patientProfileId",
   alert.device_id AS "deviceId", alert.metric,
   alert.observed_value::double precision AS "observedValue",
   alert.threshold_id AS "thresholdId", alert.severity, alert.state,
   alert.observed_at AS "observedAt",
   alert.acknowledged_by_profile_id AS "acknowledgedByProfileId",
   alert.acknowledged_at AS "acknowledgedAt", alert.resolved_at AS "resolvedAt",
   alert.version, alert.created_at AS "createdAt", alert.updated_at AS "updatedAt"
   FROM health_alerts alert`;
}

function alertReturning(): string {
  return `RETURNING alert_id AS "alertId", organization_id AS "organizationId",
   patient_profile_id AS "patientProfileId", device_id AS "deviceId", metric,
   observed_value::double precision AS "observedValue",
   threshold_id AS "thresholdId", severity, state, observed_at AS "observedAt",
   acknowledged_by_profile_id AS "acknowledgedByProfileId",
   acknowledged_at AS "acknowledgedAt", resolved_at AS "resolvedAt", version,
   created_at AS "createdAt", updated_at AS "updatedAt"`;
}
