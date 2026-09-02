import {
  VitalReadingRepository,
  type IngestBatchResult,
  type VitalReadingQualityValue,
} from '@smartcura/database/iot';
import { PostgresConnection } from '@smartcura/database';
import { createNotification } from '@smartcura/database/consultations';
import { createUuidV7 } from '@smartcura/observability';

/**
 * MQTT vitals ingestion.
 *
 * WHAT THIS CLOSES. The AsyncAPI contract, the canonical topics, the dedupe ledger and the
 * ESP32 simulator all existed, but NOTHING ever connected to a broker: there was no
 * subscriber, so "IoT ingestion" was reachable only over HTTP by a human-authenticated
 * actor. A device is not a person, which is why this work also added the `device` actor kind.
 *
 * WHY THE BRIDGE VALIDATES BEFORE IT TRUSTS. A broker delivers whatever a publisher sends.
 * The device id comes from the TOPIC, never from the payload, because a device that could
 * name another device in its own message could write into that patient's record. The topic is
 * the thing the broker's own ACL constrains, so it is the only trustworthy identity here.
 */

/** Canonical topic: `smartcura/v1/devices/{deviceId}/vitals`. */
const VITALS_TOPIC = /^smartcura\/v1\/devices\/([0-9a-f-]{36})\/vitals$/;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Accepted replay window and clock tolerance, mirroring the HTTP ingestion route. */
export const MQTT_REPLAY_WINDOW_MS = 600_000;
export const MQTT_CLOCK_SKEW_TOLERANCE_MS = 120_000;

export interface MqttVitalsPacket {
  readonly boot_id: number;
  readonly recorded_at: string;
  readonly metrics: readonly {
    /**
     * PER-SAMPLE sequence number. The dedupe ledger's primary key is
     * `(device_id, boot_id, sequence_number)` — per READING, not per packet — so samples
     * sharing one number would collide and only the first would ever be stored. My first
     * version put a single `sequence_no` at packet level and real ingestion reported
     * `accepted=1 rejected=1` for a two-metric packet, which is how this was found.
     */
    readonly sequence_no: number;
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
    readonly quality: string;
  }[];
}

export type MqttIngestOutcome =
  | { readonly kind: 'ingested'; readonly accepted: number; readonly deduplicated: number;
      readonly rejected: number; readonly alertsRaised: number }
  | { readonly kind: 'rejected'; readonly reason:
      'unknown_topic' | 'malformed_payload' | 'unauthenticated' | 'device_unknown'
      | 'device_not_ingestible' | 'device_not_assigned' };

/**
 * Parses a canonical vitals payload. STRICT on purpose: an unparseable packet from a
 * microcontroller is far more likely to be a firmware defect or a spoof than something worth
 * salvaging, and a partially-understood physiological reading is not safe to store.
 */
export function parseVitalsPacket(raw: string): MqttVitalsPacket | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (typeof value !== 'object' || value === null) return undefined;
  const packet = value as Record<string, unknown>;
  if (!Number.isInteger(packet.boot_id) || (packet.boot_id as number) < 0) return undefined;
  if (typeof packet.recorded_at !== 'string') return undefined;
  if (Number.isNaN(Date.parse(packet.recorded_at))) return undefined;
  if (!Array.isArray(packet.metrics) || packet.metrics.length === 0) return undefined;
  if (packet.metrics.length > 32) return undefined;
  // A payload naming its own device is refused rather than ignored: accepting it while
  // silently preferring the topic would leave a firmware author believing the field works.
  if ('device_id' in packet) return undefined;
  // A packet-level sequence number is refused for the same reason. It would look like it
  // worked while silently discarding every sample after the first.
  if ('sequence_no' in packet) return undefined;
  const metrics: { sequence_no: number; metric: string; value: number; unit: string; quality: string }[] = [];
  const seen = new Set<number>();
  for (const entry of packet.metrics) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const sample = entry as Record<string, unknown>;
    if (!Number.isInteger(sample.sequence_no) || (sample.sequence_no as number) < 0) return undefined;
    // Two samples claiming one sequence number inside a single packet cannot both be stored,
    // so the packet is refused rather than half-accepted.
    if (seen.has(sample.sequence_no as number)) return undefined;
    seen.add(sample.sequence_no as number);
    if (typeof sample.metric !== 'string' || typeof sample.unit !== 'string') return undefined;
    if (typeof sample.value !== 'number' || !Number.isFinite(sample.value)) return undefined;
    if (typeof sample.quality !== 'string') return undefined;
    metrics.push({
      sequence_no: sample.sequence_no as number,
      metric: sample.metric, value: sample.value,
      unit: sample.unit, quality: sample.quality,
    });
  }
  return {
    boot_id: packet.boot_id as number,
    recorded_at: packet.recorded_at,
    metrics,
  };
}

export function deviceIdFromTopic(topic: string): string | undefined {
  const match = VITALS_TOPIC.exec(topic);
  const deviceId = match?.[1];
  if (deviceId === undefined || !UUID_V7.test(deviceId)) return undefined;
  return deviceId;
}

export class MqttIngestionHandler {
  constructor(
    private readonly readings: VitalReadingRepository,
    private readonly connection: PostgresConnection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Handles one delivered message.
   *
   * `username`/`password` are the broker-authenticated credentials the publisher connected
   * with. They are re-proved against the database inside the ingest transaction, so a
   * credential revoked after CONNECT cannot keep writing for the life of the socket.
   */
  async handle(input: {
    readonly topic: string;
    readonly payload: string;
    /** The publishing device's identity as the broker's ACL bound it: the topic segment. */
    readonly username: string;
    readonly correlationId: string;
  }): Promise<MqttIngestOutcome> {
    const deviceId = deviceIdFromTopic(input.topic);
    if (deviceId === undefined) return { kind: 'rejected', reason: 'unknown_topic' };
    // The publisher's username must be the device it claims in the topic. The broker ACL
    // enforces this too; enforcing it here as well means a broker misconfiguration cannot
    // become a cross-patient write.
    if (input.username !== deviceId) return { kind: 'rejected', reason: 'unauthenticated' };
    const packet = parseVitalsPacket(input.payload);
    if (packet === undefined) return { kind: 'rejected', reason: 'malformed_payload' };

    const organizationId = await this.readings.organizationForDevice(deviceId);
    if (organizationId === undefined) return { kind: 'rejected', reason: 'device_unknown' };

    const recordedAt = new Date(packet.recorded_at);
    const result: IngestBatchResult = await this.readings.ingestBatch({
      deviceId,
      organizationId,
      // Attribution belongs to the device, not to a person. There is no human actor here and
      // inventing one would put a clinician's name on data they never touched.
      actorProfileId: null,
      actor: { kind: 'device', deviceId },
      readings: packet.metrics.map((sample) => ({
        metric: sample.metric as never,
        value: sample.value,
        unit: sample.unit,
        bootId: packet.boot_id,
        sequenceNumber: sample.sequence_no,
        recordedAt,
        quality: sample.quality as VitalReadingQualityValue,
      })),
      replayWindowMs: MQTT_REPLAY_WINDOW_MS,
      clockSkewToleranceMs: MQTT_CLOCK_SKEW_TOLERANCE_MS,
      now: this.now(),
      correlationId: input.correlationId,
    });

    if (typeof result === 'string') {
      if (result === 'device_not_found') return { kind: 'rejected', reason: 'device_unknown' };
      if (result === 'device_not_ingestible') {
        return { kind: 'rejected', reason: 'device_not_ingestible' };
      }
      if (result === 'device_not_assigned' || result === 'patient_mismatch') {
        return { kind: 'rejected', reason: 'device_not_assigned' };
      }
      return { kind: 'rejected', reason: 'unauthenticated' };
    }

    // Notify the patient that new vitals were received (throttled to 1 per
    // 30 min). This mirrors the REST API's ReadingsService.maybeNotifyVitalsReceived.
    // Without this, MQTT-published readings (the ESP32 path) never generate a
    // notification or push, while REST-published readings do.
    if (result.accepted > 0) {
      this.maybeNotifyVitalsReceived(result.patientProfileId, result.deviceId)
        .catch(() => {
          // A notification failure must not break the ingest flow.
        });
    }

    return {
      kind: 'ingested',
      accepted: result.accepted,
      deduplicated: result.deduplicated,
      rejected: result.rejected,
      alertsRaised: result.alertsRaised,
    };
  }

  /**
   * Creates a vitals_update notification for the patient, throttled to once per
   * 30 minutes to avoid spam from frequent ESP32 publishes (every 5 s when a
   * finger is on the sensor, every 30 s for temperature-only).
   */
  private async maybeNotifyVitalsReceived(
    patientProfileId: string,
    deviceId: string,
  ): Promise<void> {
    await this.connection.transaction(async (client) => {
      const recent = await client.query(
        `SELECT 1 FROM notifications
         WHERE profile_id = $1 AND category = 'vitals_update'
         AND created_at > NOW() - INTERVAL '30 minutes'
         LIMIT 1`,
        [patientProfileId],
      );
      if ((recent.rowCount ?? 0) > 0) return;

      await createNotification(client, {
        profileId: patientProfileId,
        category: 'vitals_update',
        resourceType: 'vital_reading',
        resourceId: deviceId,
        titleCode: 'vitals.received.title',
        bodyCode: 'vitals.received.body',
        correlationId: createUuidV7(),
        now: new Date(),
      });
    });
  }
}
