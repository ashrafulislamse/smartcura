import { Injectable, Logger } from '@nestjs/common';
import Ioredis from 'ioredis';
import { formatSafeLog } from '@smartcura/observability';

/**
 * The Redis channel the API's WebSocket chat gateway subscribes to. Kept in
 * sync with `CHAT_EVENTS_CHANNEL` in the gateway by convention; both are
 * literal `'chat:events'`. A shared constant lives in the gateway package
 * rather than the database package because the channel name is a transport
 * concern, not a domain contract.
 */
export const CHAT_EVENTS_CHANNEL = 'chat:events';

/**
 * Publishes chat fan-out events to the Redis pub/sub channel the API's
 * WebSocket chat gateway subscribes to.
 *
 * The worker and the API are separate processes (separate Nest applications),
 * so the worker cannot call the gateway directly. Redis pub/sub is the bridge:
 * the worker publishes a minimum-necessary projection of a processed outbox
 * event, and every gateway instance that has a client in the matching
 * conversation room emits it. The payload mirrors the outbox event payload —
 * no message text, which is clinical/business data that an event stream fans
 * out more widely than an authorized read. Clients refetch under policy for
 * content.
 *
 * Optional: when `SMARTCURA_REDIS_URL` is unset the publisher is not created
 * and the worker processes chat outbox events normally (they still validate
 * and complete) without the real-time fan-out side effect. CI and local dev
 * run this way; production sets the Redis URL.
 */
@Injectable()
export class ChatEventPublisher {
  readonly #logger = new Logger(ChatEventPublisher.name);
  #client: RedisLike | undefined;

  /**
   * @param client Optional pre-built Redis client. Production leaves this
   * undefined and calls {@link connect} at bootstrap; tests inject a fake to
   * assert what would be published without touching a real Redis server.
   */
  constructor(client?: RedisLike) {
    this.#client = client;
  }

  /**
   * Connect to Redis. Called once at bootstrap. A connection failure is logged
   * but does not prevent the worker from starting: the outbox still processes,
   * and a transient Redis outage must not block clinical event progression.
   * The publish path degrades to a no-op when the client is not connected.
   */
  async connect(url: string): Promise<void> {
    const RedisCtor = Ioredis as unknown as new (url: string, opts?: Record<string, unknown>) => RedisLike;
    this.#client = new RedisCtor(url, { maxRetriesPerRequest: null });
    this.#client.on('error', (...args: unknown[]) => {
      const error = args[0] as Error;
      this.#logger.error(formatSafeLog({
        event: 'chat.publisher.redis_error', error: error?.message ?? String(error),
      }));
    });
    await this.#client.ping().catch((error: unknown) => {
      this.#logger.warn(formatSafeLog({
        event: 'chat.publisher.connect_failed', error: errorMessage(error),
      }));
    });
  }

  async close(): Promise<void> {
    await this.#client?.quit().catch(() => undefined);
  }

  /**
   * Publish a `conversation.message-created.v1` fan-out event. Called after the
   * worker validates and acknowledges the matching outbox row.
   */
  async publishMessageCreated(event: {
    conversation_id: string; message_id: string; sender_profile_id: string;
    sequence_no: number; message_type: 'text' | 'file' | 'system';
  }): Promise<void> {
    await this.publish({ type: 'conversation.message-created.v1', ...event });
  }

  /**
   * Publish a `conversation.receipt-updated.v1` fan-out event. Called after the
   * worker validates and acknowledges the matching outbox row.
   */
  async publishReceiptUpdated(event: {
    conversation_id: string; profile_id: string; through_sequence_no: number;
  }): Promise<void> {
    await this.publish({ type: 'conversation.receipt-updated.v1', ...event });
  }

  private async publish(payload: Record<string, unknown>): Promise<void> {
    if (this.#client === undefined) return;
    try {
      await this.#client.publish(CHAT_EVENTS_CHANNEL, JSON.stringify(payload));
    } catch (error) {
      // A publish failure must not block the worker's outbox progress: the
      // outbox row is already processed, and the real-time push is a
      // best-effort side effect. Clients refetch under policy for missed
      // events, which is the authoritative catch-up path.
      this.#logger.warn(formatSafeLog({
        event: 'chat.publisher.publish_failed', error: errorMessage(error),
      }));
    }
  }
}

/**
 * Narrow an unknown caught value to a string message for structured logging,
 * without asserting it is an Error (which a non-Error throw would not be).
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The Redis operations the publisher uses. Declared as an interface so the
 * publisher depends on a small surface, not the full ioredis class, and so the
 * constructor can be reached through a type-only cast that `verbatimModuleSyntax`
 * requires for this CommonJS module.
 */
export interface RedisLike {
  publish(channel: string, message: string): Promise<number>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  quit(): Promise<string>;
  ping(): Promise<string>;
}
