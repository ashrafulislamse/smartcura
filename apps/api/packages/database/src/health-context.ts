/**
 * HealthContextBuilder — aggregates authorized patient health data into a
 * controlled, auditable `HealthContext` object for the AI generation pipeline.
 *
 * This is Phase AI-2 of the SmartCura AI Master Plan. The builder is the central
 * bridge between the health-data layer and the AI orchestrator. It ensures the
 * LLM receives only the data that belongs to the patient whose generation is
 * running, never the entire database.
 *
 * Authorization model:
 *   The `patientProfileId` always comes from the `ai_generations` work row,
 *   which was set at `submitTurn` time from the conversation ownership check.
 *   The builder receives it as a method parameter, never from user input.
 *   Cross-patient access is therefore impossible — the builder has no way to
 *   receive any profileId other than the one the worker derived from the
 *   generation row.
 */

import type { PostgresConnection } from './connection.js';
import type { QueryResultRow } from 'pg';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The controlled patient health context passed to the LLM. Every field is
 * derived from database queries scoped to a single `patientProfileId`.
 * The LLM never sees the entire database — only this projection.
 */
export interface HealthContext {
  readonly profile: {
    readonly displayName: string;
  };
  readonly conditions: readonly HealthCondition[];
  readonly allergies: readonly HealthAllergy[];
  readonly medications: readonly HealthMedication[];
  readonly recentVitals: readonly HealthVitalReading[];
  readonly deviceStatus: readonly HealthDeviceStatus[];
}

export interface HealthCondition {
  readonly conditionName: string;
  readonly status: 'active' | 'resolved' | 'in_remission';
  readonly onsetDate: string | null;
  readonly notes: string | null;
}

export interface HealthAllergy {
  readonly substance: string;
  readonly reaction: string | null;
  readonly severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
}

export interface HealthMedication {
  readonly medicationText: string;
  readonly doseValue: string;
  readonly doseUnit: string;
  readonly frequencyCode: string | null;
  readonly durationDays: number;
}

export interface HealthVitalReading {
  readonly metric: string;
  readonly value: string;
  readonly unit: string;
  readonly recordedAt: string;
  readonly quality: string;
  /** Inferred from `devices.device_type` — there is no `source` column. */
  readonly source: string;
  readonly deviceId: string;
  /** True if the reading is older than 5 minutes from the generation timestamp. */
  readonly stale: boolean;
}

/**
 * Status of a device assigned to the patient, included in the health context
 * so the LLM knows which devices are online and reporting.
 */
export interface HealthDeviceStatus {
  readonly deviceId: string;
  readonly deviceType: string;
  /** Inferred from `deviceType` via `inferSource`. */
  readonly source: string;
  readonly state: string;
  readonly lastSeenAt: string | null;
  /** True if `lastSeenAt` is within the last 5 minutes of the generation timestamp. */
  readonly online: boolean;
}

// ─── Query row types ─────────────────────────────────────────────────────────

interface ProfileRow extends QueryResultRow {
  readonly displayName: string | null;
}

interface ConditionRow extends QueryResultRow {
  readonly conditionName: string;
  readonly status: 'active' | 'resolved' | 'in_remission';
  readonly onsetDate: string | null;
  readonly notes: string | null;
}

interface AllergyRow extends QueryResultRow {
  readonly substance: string;
  readonly reaction: string | null;
  readonly severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
}

interface MedicationRow extends QueryResultRow {
  readonly medicationText: string;
  readonly doseValue: string;
  readonly doseUnit: string;
  readonly frequencyCode: string | null;
  readonly durationDays: number;
}

interface VitalRow extends QueryResultRow {
  readonly metric: string;
  readonly value: string;
  readonly unit: string;
  readonly recordedAt: string;
  readonly quality: string;
  readonly deviceType: string;
  readonly deviceId: string;
}

interface DeviceStatusRow extends QueryResultRow {
  readonly deviceId: string;
  readonly deviceType: string;
  readonly state: string;
  readonly lastSeenAt: string | null;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Builds a `HealthContext` for a single patient by querying the database.
 *
 * Every query is scoped to exactly one `patientProfileId`. There is no method
 * that accepts a different profileId — the builder is constructed per
 * generation and the profileId is fixed for its lifetime.
 */
export class HealthContextBuilder {
  constructor(
    private readonly database: PostgresConnection,
  ) {}

  /**
   * Assembles the full health context for a patient.
   *
   * @param patientProfileId — from the `ai_generations` work row, never from
   *   user input. This is the cross-patient isolation guarantee.
   * @param now — the generation timestamp; used to compute the 24-hour vitals
   *   window and the 5-minute freshness threshold for stale readings and
   *   device online status.
   */
  async build(patientProfileId: string, now: Date): Promise<HealthContext> {
    const [profile, conditions, allergies, medications, recentVitals, deviceStatus] =
      await Promise.all([
        this.fetchProfile(patientProfileId),
        this.fetchConditions(patientProfileId),
        this.fetchAllergies(patientProfileId),
        this.fetchMedications(patientProfileId),
        this.fetchRecentVitals(patientProfileId, now),
        this.fetchDeviceStatus(patientProfileId, now),
      ]);

    return {
      profile: { displayName: profile?.displayName ?? 'Unknown' },
      conditions,
      allergies,
      medications,
      recentVitals,
      deviceStatus,
    };
  }

  /**
   * Fetches the patient's display name from `profiles`.
   * The `profiles` table has no `date_of_birth` or `sex` column — those
   * demographics do not exist in the current schema.
   */
  private async fetchProfile(
    patientProfileId: string,
  ): Promise<ProfileRow | undefined> {
    const result = await this.database.query<ProfileRow>(
      `SELECT display_name AS "displayName"
       FROM profiles
       WHERE profile_id = $1`,
      [patientProfileId],
    );
    return result.rows[0];
  }

  /**
   * Fetches active conditions from `patient_conditions`.
   * Soft-deleted rows are excluded (`deleted_at IS NULL`).
   */
  private async fetchConditions(
    patientProfileId: string,
  ): Promise<readonly HealthCondition[]> {
    const result = await this.database.query<ConditionRow>(
      `SELECT condition_name AS "conditionName",
              status,
              onset_date::text AS "onsetDate",
              notes
       FROM patient_conditions
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY
         CASE status
           WHEN 'active' THEN 0
           WHEN 'in_remission' THEN 1
           WHEN 'resolved' THEN 2
         END,
         condition_name`,
      [patientProfileId],
    );
    return result.rows;
  }

  /**
   * Fetches active allergies from `patient_allergies`.
   * Soft-deleted rows are excluded (`deleted_at IS NULL`).
   * Ordered by severity (most severe first) for clinical relevance.
   */
  private async fetchAllergies(
    patientProfileId: string,
  ): Promise<readonly HealthAllergy[]> {
    const result = await this.database.query<AllergyRow>(
      `SELECT substance,
              reaction,
              severity
       FROM patient_allergies
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY
         CASE severity
           WHEN 'life_threatening' THEN 0
           WHEN 'severe' THEN 1
           WHEN 'moderate' THEN 2
           WHEN 'mild' THEN 3
         END,
         substance`,
      [patientProfileId],
    );
    return result.rows;
  }

  /**
   * Fetches current medications from `prescriptions` (status = 'signed')
   * JOINed to `prescription_items`.
   *
   * There is no `patient_medications` table. Active prescriptions have
   * status = 'signed' only — draft, superseded, cancelled, expired, and
   * discarded are not current.
   */
  private async fetchMedications(
    patientProfileId: string,
  ): Promise<readonly HealthMedication[]> {
    const result = await this.database.query<MedicationRow>(
      `SELECT item.medication_text AS "medicationText",
              item.dose_value::text AS "doseValue",
              item.dose_unit AS "doseUnit",
              item.frequency_code AS "frequencyCode",
              item.duration_days AS "durationDays"
       FROM prescription_items item
       JOIN prescriptions rx ON rx.prescription_id = item.prescription_id
       WHERE rx.patient_profile_id = $1
         AND rx.status = 'signed'
       ORDER BY item.position`,
      [patientProfileId],
    );
    return result.rows;
  }

  /**
   * Fetches recent vital readings from `vital_readings` JOINed to `devices`
   * for source provenance.
   *
   * There is no `source` column in `vital_readings` — source is inferred from
   * `devices.device_type`. Quality is filtered to 'valid' and 'suspect' only;
   * 'invalid' and 'unknown' readings are excluded.
   *
   * The window is the last 24 hours. The latest reading per metric is
   * returned, ordered by recorded_at descending.
   */
  private async fetchRecentVitals(
    patientProfileId: string,
    now: Date,
  ): Promise<readonly HealthVitalReading[]> {
    const result = await this.database.query<VitalRow>(
      `SELECT vr.metric,
              vr.value::text AS "value",
              vr.unit,
              vr.recorded_at::text AS "recordedAt",
              vr.quality,
              d.device_type AS "deviceType",
              vr.device_id::text AS "deviceId"
       FROM vital_readings vr
       JOIN devices d ON d.device_id = vr.device_id
       WHERE vr.patient_profile_id = $1
         AND vr.quality IN ('valid', 'suspect')
         AND vr.recorded_at >= $2
       ORDER BY vr.recorded_at DESC
       LIMIT 50`,
      [patientProfileId, new Date(now.getTime() - 24 * 60 * 60 * 1000)],
    );

    const staleThreshold = new Date(now.getTime() - 5 * 60 * 1000);

    return result.rows.map((row) => ({
      metric: row.metric,
      value: row.value,
      unit: row.unit,
      recordedAt: row.recordedAt,
      quality: row.quality,
      source: inferSource(row.deviceType),
      deviceId: row.deviceId,
      stale: new Date(row.recordedAt).getTime() < staleThreshold.getTime(),
    }));
  }

  /**
   * Fetches the status of devices assigned to the patient via `device_assignments`.
   * Only active assignments (released_at IS NULL) are included.
   *
   * `online` is derived: true if `last_seen_at` is within the last 5 minutes of
   * the generation timestamp. A device that has never reported (last_seen_at IS
   * NULL) is offline.
   */
  private async fetchDeviceStatus(
    patientProfileId: string,
    now: Date,
  ): Promise<readonly HealthDeviceStatus[]> {
    const result = await this.database.query<DeviceStatusRow>(
      `SELECT d.device_id::text AS "deviceId",
              d.device_type AS "deviceType",
              d.state,
              d.last_seen_at::text AS "lastSeenAt"
       FROM devices d
       JOIN device_assignments da ON da.device_id = d.device_id
       WHERE da.patient_profile_id = $1
         AND da.released_at IS NULL
       ORDER BY d.device_type, d.device_id`,
      [patientProfileId],
    );

    const onlineThreshold = new Date(now.getTime() - 5 * 60 * 1000);

    return result.rows.map((row) => ({
      deviceId: row.deviceId,
      deviceType: row.deviceType,
      source: inferSource(row.deviceType),
      state: row.state,
      lastSeenAt: row.lastSeenAt,
      online: row.lastSeenAt !== null && new Date(row.lastSeenAt).getTime() >= onlineThreshold.getTime(),
    }));
  }
}

/**
 * Infers the data source from `devices.device_type`.
 *
 * The `vital_readings` table has no explicit `source` column. Source
 * provenance is derived from the device type:
 *   - `vitals_monitor` → `esp32` (the SmartCura ESP32 prototype)
 *   - `pulse_oximeter` → `esp32` (another ESP32-based peripheral)
 *   - `phone` → `health_connect` (Google Health Connect via smartphone/smartwatch)
 *   - `simulator` → `simulator` (test/deterministic data)
 *   - Other types → `device` (generic, preserves provenance without guessing)
 */
export function inferSource(deviceType: string): string {
  switch (deviceType) {
    case 'vitals_monitor':
    case 'pulse_oximeter':
      return 'esp32';
    case 'phone':
      return 'health_connect';
    case 'simulator':
      return 'simulator';
    default:
      return 'device';
  }
}

/**
 * Serializes a `HealthContext` into a compact, LLM-readable text block for
 * inclusion in the system prompt. This is what the LLM actually sees — not
 * the raw JSON, and certainly not the database.
 *
 * The format is deliberately structured so the model can cite specific
 * readings and distinguish sources. Stale or suspect readings are marked
 * so the model does not treat them as equally reliable. Device status
 * (online/offline, last seen) is included so the model can assess the
 * reliability of the data source.
 */
export function serializeHealthContext(context: HealthContext): string {
  const lines: string[] = [];

  lines.push(`Patient: ${context.profile.displayName}`);

  if (context.conditions.length > 0) {
    lines.push('Conditions:');
    for (const c of context.conditions) {
      const parts = [`  - ${c.conditionName} (${c.status})`];
      if (c.onsetDate) parts.push(`onset: ${c.onsetDate}`);
      if (c.notes) parts.push(`notes: ${c.notes}`);
      lines.push(parts.join(', '));
    }
  } else {
    lines.push('Conditions: none recorded');
  }

  if (context.allergies.length > 0) {
    lines.push('Allergies:');
    for (const a of context.allergies) {
      const parts = [`  - ${a.substance} (${a.severity})`];
      if (a.reaction) parts.push(`reaction: ${a.reaction}`);
      lines.push(parts.join(', '));
    }
  } else {
    lines.push('Allergies: none recorded');
  }

  if (context.medications.length > 0) {
    lines.push('Current medications:');
    for (const m of context.medications) {
      const parts = [`  - ${m.medicationText} ${m.doseValue}${m.doseUnit}`];
      if (m.frequencyCode) parts.push(m.frequencyCode);
      parts.push(`for ${m.durationDays} days`);
      lines.push(parts.join(' '));
    }
  } else {
    lines.push('Current medications: none');
  }

  if (context.recentVitals.length > 0) {
    lines.push('Recent vitals (last 24 hours):');
    for (const v of context.recentVitals) {
      const qualityTag = v.quality === 'suspect' ? ' [SUSPECT]' : '';
      const staleTag = v.stale ? ' [STALE]' : '';
      lines.push(
        `  - ${v.metric}: ${v.value} ${v.unit} ` +
        `at ${v.recordedAt} (source: ${v.source}, quality: ${v.quality}${qualityTag}${staleTag})`,
      );
    }
  } else {
    lines.push('Recent vitals: none in the last 24 hours');
  }

  if (context.deviceStatus.length > 0) {
    lines.push('Device status:');
    for (const d of context.deviceStatus) {
      const onlineLabel = d.online ? 'online' : 'offline';
      const lastSeen = d.lastSeenAt ?? 'never';
      lines.push(
        `  - ${d.deviceType} (source: ${d.source}, state: ${d.state}, ${onlineLabel}, last seen: ${lastSeen})`,
      );
    }
  } else {
    lines.push('Device status: no assigned devices');
  }

  return lines.join('\n');
}
