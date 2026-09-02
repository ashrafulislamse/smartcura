import {
  Inject, Injectable, Logger, Optional,
  type OnApplicationBootstrap, type OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  FoundationReadinessRepository,
  OutboxRepository,
  PostgresConnection,
} from '@smartcura/database';
import { AppointmentRepository } from '@smartcura/database/appointments';
import { formatSafeLog, safeErrorFields } from '@smartcura/observability';
import type { WorkerConfig } from './config.js';
import { OutboxProcessor } from './outbox.processor.js';
import { CHAT_PUBLISHER, MQTT_BRIDGE, WORKER_CONFIG } from './tokens.js';
import type { MqttBridge } from './mqtt-bridge.js';
import type { ChatEventPublisher } from './chat-event.publisher.js';

/** How often the appointment-reminder scan runs. Independent of the outbox poll. */
const REMINDER_SCAN_INTERVAL_MS = 15 * 60 * 1000;
/** Reminders cover appointments starting within this window. */
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WorkerRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #logger = new Logger(WorkerRuntime.name);
  readonly #workerId = `worker-${process.pid}`;
  #timer: NodeJS.Timeout | undefined;
  #reminderTimer: NodeJS.Timeout | undefined;
  #polling = false;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    private readonly database: PostgresConnection,
    private readonly readiness: FoundationReadinessRepository,
    private readonly outbox: OutboxRepository,
    private readonly processor: OutboxProcessor,
    private readonly appointments: AppointmentRepository,
    @Optional() @Inject(MQTT_BRIDGE) private readonly bridge: MqttBridge | undefined,
    @Optional() @Inject(CHAT_PUBLISHER) private readonly chatPublisher?: ChatEventPublisher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.bridge !== undefined) {
      this.#logger.log('Starting MQTT vitals ingestion bridge...');
      await this.bridge.start();
    } else {
      this.#logger.warn('MQTT bridge not configured (SMARTCURA_MQTT_URL unset) — vitals ingestion is disabled');
    }
    if (this.chatPublisher !== undefined && this.config.redis !== undefined) {
      this.#logger.log('Connecting Redis chat event publisher...');
      await this.chatPublisher.connect(this.config.redis.url);
    } else {
      this.#logger.warn('Redis chat publisher not configured (SMARTCURA_REDIS_URL unset) — real-time chat fan-out is disabled');
    }
    await this.poll();
    this.#timer = setInterval(() => void this.poll(), this.config.pollIntervalMs);
    await this.scanReminders();
    this.#reminderTimer = setInterval(() => void this.scanReminders(), REMINDER_SCAN_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    if (this.#reminderTimer !== undefined) clearInterval(this.#reminderTimer);
    if (this.bridge !== undefined) await this.bridge.stop();
    await this.chatPublisher?.close();
    await this.database.close();
  }

  /**
   * Appointment reminders are time-driven, not event-driven: nothing happens at
   * the moment a reminder becomes due, so no outbox event can carry it. The scan
   * is idempotent (createDueReminders skips appointments that already have a
   * reminder notification), so restarts and overlapping scans cannot
   * double-remind.
   */
  private async scanReminders(): Promise<void> {
    try {
      if (!(await this.database.isReady())) return;
      const created = await this.appointments.createDueReminders({
        now: new Date(),
        windowMs: REMINDER_WINDOW_MS,
        limit: 100,
        // correlation_id is a uuid column: every producer elsewhere derives it
        // from the same uuid helper, and an ISO string here is a 22P02 at boot.
        correlationId: randomUUID(),
      });
      if (created > 0) {
        this.#logger.log(formatSafeLog({ event: 'worker.appointment_reminders', count: created }));
      }
    } catch (error) {
      // safeErrorFields keeps the log inside the allowlist while still carrying
      // the SQLSTATE (pg puts it on error.code), which is what pinpoints a scan
      // failure. Raw messages are never logged.
      this.#logger.error(formatSafeLog({
        event: 'worker.appointment_reminder_scan_failed',
        ...safeErrorFields(error),
      }));
    }
  }

  private async poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      if (!(await this.database.isReady())) return;
      await this.readiness.recordWorkerHeartbeat(this.#workerId, this.config.buildVersion);
      const events = await this.outbox.claim(this.#workerId, this.config.batchSize, this.config.leaseMs);
      for (const event of events) await this.processEvent(event);
      if (events.length > 0) this.#logger.log(formatSafeLog({ event: 'worker.batch', count: events.length }));
    } catch {
      this.#logger.error(formatSafeLog({ event: 'worker.poll_failed' }));
    } finally {
      this.#polling = false;
    }
  }

  private async processEvent(event: import('@smartcura/database').ClaimedOutboxEvent): Promise<void> {
    let handled = false;
    try {
      handled = await this.processor.process(event);
    } catch {
      this.#logger.error(formatSafeLog({
        event: 'worker.event_processing_failed',
        event_id: event.eventId,
        event_type: event.eventType,
      }));
    }
    if (handled) return this.outbox.complete(event.eventId, this.#workerId);
    const delay = Math.min(300_000, 1_000 * 2 ** Math.min(event.attempts, 8));
    await this.outbox.fail(
      event, this.#workerId, 'EVENT_PROCESSING_FAILED', this.config.maxAttempts, delay,
    );
  }
}
