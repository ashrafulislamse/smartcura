/**
 * Deterministic `smartcura_esp32_v1` device simulator.
 *
 * The plan requires the simulator to exist BEFORE firmware, so the backend is
 * exercised against the canonical MQTT contract from day one and hardware delay
 * never blocks the server. It is transport-neutral on purpose: it produces the
 * exact packets the contract declares and hands them to a publisher, so the same
 * generator drives an in-process test, an HTTP ingest call or a real Mosquitto
 * client without changing what a packet looks like.
 *
 * Everything is seeded and integer-stepped, so a given seed always produces the
 * same packets. A random simulator cannot be used to prove that a replayed packet
 * creates no duplicate row, which is the property this exists to test.
 */

export const SIMULATOR_HARDWARE_PROFILE = 'smartcura_esp32_v1';

/** Metrics the FYP sensor set actually produces. */
export type SimulatedMetric = 'heart_rate' | 'oxygen_saturation' | 'body_temperature';

export interface SimulatedSample {
  readonly metric: SimulatedMetric;
  readonly value: number;
  readonly unit: string;
  readonly quality: 'valid' | 'suspect';
}

export interface SimulatedVitalsPacket {
  /** Canonical MQTT topic this packet belongs on. */
  readonly topic: string;
  readonly deviceId: string;
  /** Power-cycle counter. Reboots restart `sequenceNo`, never `bootId`. */
  readonly bootId: number;
  /** Monotonic within a boot. Together with `bootId` this is the dedupe identity. */
  readonly sequenceNo: number;
  readonly recordedAt: string;
  readonly metrics: readonly SimulatedSample[];
}

const UNITS: Readonly<Record<SimulatedMetric, string>> = Object.freeze({
  heart_rate: '/min',
  oxygen_saturation: '%',
  body_temperature: 'Cel',
});

/** Physiologically plausible resting baselines for the MAX30102/LM35 pair. */
const BASELINE: Readonly<Record<SimulatedMetric, number>> = Object.freeze({
  heart_rate: 72,
  oxygen_saturation: 98,
  body_temperature: 36.8,
});

const AMPLITUDE: Readonly<Record<SimulatedMetric, number>> = Object.freeze({
  heart_rate: 8,
  oxygen_saturation: 1,
  body_temperature: 0.3,
});

export function vitalsTopic(deviceId: string): string {
  return `smartcura/v1/devices/${deviceId}/vitals`;
}

export function statusTopic(deviceId: string): string {
  return `smartcura/v1/devices/${deviceId}/status`;
}

export function commandAckTopic(deviceId: string): string {
  return `smartcura/v1/devices/${deviceId}/command-acks`;
}

export interface SimulatorOptions {
  readonly deviceId: string;
  readonly bootId: number;
  /** UTC instant of the first packet. Subsequent packets step by `intervalMs`. */
  readonly startedAt: Date;
  readonly intervalMs?: number;
  readonly metrics?: readonly SimulatedMetric[];
  /**
   * Emits one `suspect` sample every N packets so the alert path can be shown to
   * ignore unvalidated data. Zero disables it.
   */
  readonly suspectEvery?: number;
}

export class DeviceSimulator {
  readonly #deviceId: string;
  readonly #bootId: number;
  readonly #startedAt: number;
  readonly #intervalMs: number;
  readonly #metrics: readonly SimulatedMetric[];
  readonly #suspectEvery: number;

  constructor(options: SimulatorOptions) {
    if (!Number.isInteger(options.bootId) || options.bootId < 0) {
      throw new TypeError('bootId must be a non-negative integer');
    }
    this.#deviceId = options.deviceId;
    this.#bootId = options.bootId;
    this.#startedAt = options.startedAt.getTime();
    this.#intervalMs = options.intervalMs ?? 60_000;
    this.#metrics = options.metrics ?? ['heart_rate', 'oxygen_saturation', 'body_temperature'];
    this.#suspectEvery = options.suspectEvery ?? 0;
  }

  /**
   * Builds the packet for one sequence number. Pure: calling it twice with the
   * same `sequenceNo` yields an identical packet, which is exactly how a QoS-1
   * redelivery is simulated.
   */
  packet(sequenceNo: number): SimulatedVitalsPacket {
    if (!Number.isInteger(sequenceNo) || sequenceNo < 0) {
      throw new TypeError('sequenceNo must be a non-negative integer');
    }
    const suspect = this.#suspectEvery > 0 && sequenceNo > 0 &&
      sequenceNo % this.#suspectEvery === 0;
    return Object.freeze({
      topic: vitalsTopic(this.#deviceId),
      deviceId: this.#deviceId,
      bootId: this.#bootId,
      sequenceNo,
      recordedAt: new Date(this.#startedAt + sequenceNo * this.#intervalMs).toISOString(),
      metrics: Object.freeze(this.#metrics.map((metric) => Object.freeze({
        metric,
        value: sample(metric, this.#bootId, sequenceNo),
        unit: UNITS[metric],
        quality: suspect ? 'suspect' as const : 'valid' as const,
      }))),
    });
  }

  /** A contiguous run of packets, as a device would emit them. */
  run(count: number, fromSequenceNo = 0): SimulatedVitalsPacket[] {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError('count must be a non-negative integer');
    }
    return Array.from({ length: count }, (_, index) => this.packet(fromSequenceNo + index));
  }

  /**
   * A run plus a redelivery of packets already sent. The server must accept the
   * new packets and deduplicate the repeats, storing no extra rows.
   */
  runWithReplay(count: number, replayCount: number): SimulatedVitalsPacket[] {
    const fresh = this.run(count);
    return [...fresh, ...fresh.slice(0, Math.min(replayCount, fresh.length))];
  }

  /** Simulates a power cycle: a new boot id restarts sequence numbering at zero. */
  reboot(nextBootId: number): DeviceSimulator {
    if (nextBootId <= this.#bootId) {
      throw new TypeError('A reboot must increase bootId');
    }
    return new DeviceSimulator({
      deviceId: this.#deviceId,
      bootId: nextBootId,
      startedAt: new Date(this.#startedAt),
      intervalMs: this.#intervalMs,
      metrics: this.#metrics,
      suspectEvery: this.#suspectEvery,
    });
  }
}

/**
 * Deterministic bounded waveform. A triangle wave is used rather than a random
 * walk so a value is reproducible from its coordinates alone, and rounded to the
 * precision the column stores so a re-sent packet compares byte-identical.
 */
function sample(metric: SimulatedMetric, bootId: number, sequenceNo: number): number {
  const period = 12;
  const phase = (bootId * 5 + sequenceNo) % period;
  const triangle = phase <= period / 2
    ? phase / (period / 2)
    : (period - phase) / (period / 2);
  const offset = (triangle * 2 - 1) * AMPLITUDE[metric];
  const raw = BASELINE[metric] + offset;
  const value = Math.round(raw * 10_000) / 10_000;
  // Saturation is a percentage and must never be reported above 100, which the
  // database CHECK would reject and a clinician would read as an instrument fault.
  return metric === 'oxygen_saturation' ? Math.min(value, 100) : value;
}
