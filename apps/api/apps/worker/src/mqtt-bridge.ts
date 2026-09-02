import { connect, type MqttClient } from 'mqtt';
import type { MqttIngestionHandler } from './mqtt-ingestion.handler.js';

/**
 * The MQTT subscriber loop.
 *
 * SUBSCRIPTION SHAPE. It subscribes to the single-level wildcard
 * `smartcura/v1/devices/+/vitals` at QoS 1, matching the AsyncAPI contract. QoS 1 means AT
 * LEAST ONCE, so redelivery is expected rather than exceptional — the dedupe ledger, not the
 * transport, is what makes a redelivered packet harmless.
 *
 * WHY IT AUTHENTICATES AS ITSELF AND STILL PASSES DEVICE CREDENTIALS DOWN. The bridge holds
 * one broker connection under its own service credential; it is not one connection per device.
 * That means the broker's per-device authentication happens on the DEVICE's own connection,
 * and this process cannot see that password. So the bridge trusts the topic — which the
 * broker's ACL binds to the publishing device — and re-proves the device against the database.
 * The alternative, trusting a device id inside the payload, would let any authenticated
 * publisher write into any patient's record.
 */
export interface MqttBridgeOptions {
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly clientId: string;
}

export class MqttBridge {
  #client: MqttClient | undefined;

  constructor(
    private readonly handler: MqttIngestionHandler,
    private readonly options: MqttBridgeOptions,
    private readonly log: (event: Record<string, unknown>) => void = (event) => {
      console.log(JSON.stringify(event));
    },
  ) {}

  async start(): Promise<void> {
    const client = connect(this.options.url, {
      username: this.options.username,
      password: this.options.password,
      clientId: this.options.clientId,
      // A durable session would queue messages for a bridge that is down, which sounds
      // helpful and is not: on reconnect it would replay a backlog whose readings are long
      // past the replay window and would simply be rejected. Devices retain their own
      // buffered samples; the bridge does not need the broker to hoard them.
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: 10_000,
    });
    this.#client = client;

    client.on('connect', () => {
      client.subscribe('smartcura/v1/devices/+/vitals', { qos: 1 }, (error) => {
        this.log({
          event: error ? 'mqtt.subscribe_failed' : 'mqtt.subscribed',
          topic: 'smartcura/v1/devices/+/vitals',
        });
      });
    });

    client.on('message', (topic, payload) => {
      void this.#dispatch(topic, payload.toString('utf8'));
    });

    // Never logs the payload. A vitals packet is patient data, and an error path is exactly
    // where it would otherwise leak into a log nobody treats as clinical.
    client.on('error', (error) => {
      this.log({ event: 'mqtt.error', code: (error as { code?: string }).code ?? 'unknown' });
    });

    await new Promise<void>((resolve) => {
      client.once('connect', () => resolve());
      client.once('error', () => resolve());
    });
  }

  async #dispatch(topic: string, payload: string): Promise<void> {
    try {
      const outcome = await this.handler.handle({
        topic,
        payload,
        // The publishing device's identity as the broker enforced it. The bridge does not hold
        // the device's password, so the topic segment is the authenticated identity here.
        username: topic.split('/')[3] ?? '',
        correlationId: crypto.randomUUID(),
      });
      this.log(outcome.kind === 'ingested'
        ? {
            event: 'mqtt.ingested',
            accepted: outcome.accepted,
            deduplicated: outcome.deduplicated,
            rejected: outcome.rejected,
            alerts_raised: outcome.alertsRaised,
          }
        : { event: 'mqtt.rejected', reason: outcome.reason });
    } catch (error) {
      // Allowlisted: a classification, never the message, which could contain a reading.
      this.log({
        event: 'mqtt.handler_failed',
        code: typeof error === 'object' && error !== null
          ? String((error as { code?: unknown }).code ?? 'unknown') : 'unknown',
      });
    }
  }

  async stop(): Promise<void> {
    await this.#client?.endAsync();
  }
}
