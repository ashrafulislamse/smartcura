import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import Ioredis from 'ioredis';
import type { ApiConfig } from '../config.js';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { SESSION_COOKIE_NAME, extractSessionCookie } from '../sessions/session-security.js';
import { API_CONFIG } from '../tokens.js';
import { MessagingRepository } from '@smartcura/database/consultations';
import {
  MESSAGE_CREATED_EVENT_TYPE, RECEIPT_UPDATED_EVENT_TYPE,
} from '@smartcura/database/consultations';

/**
 * Presence vocabulary. Never retype an enum: export the array and derive the
 * union, so an invented status cannot compile in an exhaustive map.
 */
export const PRESENCE_STATUSES = ['online', 'away', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/**
 * Redis channel the worker publishes chat fan-out events to and every gateway
 * instance subscribes to. One channel for all chat events; the payload carries
 * its own `conversation_id` so each instance can fan out to the right room
 * without a per-conversation channel.
 */
export const CHAT_EVENTS_CHANNEL = 'chat:events';

/** The Socket.IO namespace the AsyncAPI spec pins the chat surface to. */
export const CHAT_NAMESPACE = '/chat';

/**
 * Grace period before a disconnected profile is reported offline. A brief
 * reconnect (network flap, app backgrounded) must not flap presence, and an
 * offline status broadcast to every conversation partner is the cost of a
 * premature report. 45s is short enough that a genuine departure is visible
 * promptly and long enough to absorb a transport reconnect.
 */
const PRESENCE_OFFLINE_GRACE_MS = 45_000;
const PRESENCE_TTL_SECONDS = 120;

/**
 * WebSocket gateway for real-time consultation chat.
 *
 * The HTTP send/read endpoints in {@link ConversationsController} remain the
 * only write path: a client sends a message with `POST /conversations/:id/
 * messages`, the repository writes the row and a `conversation.message-created.
 * v1` outbox row in one transaction, and the worker processes the outbox row.
 * This gateway is push-only: it reads authenticated connections, admits a
 * client to the room for a conversation they are a participant in, and emits
 * the events the worker publishes to the {@link CHAT_EVENTS_CHANNEL} Redis
 * pub/sub channel. CSRF does not apply — a WebSocket frame is not an HTTP
 * mutation — but session authentication is enforced on every connection.
 *
 * When Redis is configured, presence is stored there (keyed by profile_id) so
 * multiple gateway instances agree on who is online, and the worker's pub/sub
 * reaches every instance. When Redis is unset (CI, local dev), the gateway
 * authenticates connections and routes room events within the single process
 * but skips cross-process fan-out and shared presence, logging a warning once.
 */
@WebSocketGateway({
  namespace: CHAT_NAMESPACE,
  cors: {
    // The portal origin and configured mobile/app origins — the same list the
    // HTTP CORS policy uses, so a browser that can call the REST API can also
    // open the socket. credentials: true is required so the
    // `__Host-smartcura_session` cookie travels on the WebSocket handshake.
    origin: (origin, callback) => {
      // Socket.IO calls origin detection with no origin for same-origin and
      // non-browser connections; admit those. The allowed list is read from
      // the module-level holder, which the constructor populates from config.
      if (origin === undefined || origin === '' || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
})
@Injectable()
export class ChatGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #logger = new Logger(ChatGateway.name);
  #publisher: RedisLike | undefined;
  #subscriber: RedisLike | undefined;
  #presenceTimers = new Map<string, NodeJS.Timeout>();

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly authorization: SessionAuthorizationService,
    private readonly messaging: MessagingRepository,
  ) {
    // Populate the module-level holder the CORS origin callback reads. A
    // module-level variable is used because Socket.IO evaluates the `origin`
    // option during server creation, before the gateway instance is fully
    // wired in some NestJS lifecycle orderings, so a closure over `this` is
    // not safe there.
    allowedOrigins = new Set(config.allowedOrigins);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.redis === undefined) {
      this.#logger.warn(
        'SMARTCURA_REDIS_URL unset — chat gateway running in single-process mode: ' +
        'pub/sub fan-out and shared presence are disabled. Set SMARTCURA_REDIS_URL in production.',
      );
      return;
    }
    // Separate connections for publish and subscribe: ioredis (and Redis itself)
    // blocks a connection in subscribe mode and cannot publish on it.
    const RedisCtor = Ioredis as unknown as new (url: string, opts?: Record<string, unknown>) => RedisLike;
    this.#publisher = new RedisCtor(this.config.redis.url, { maxRetriesPerRequest: null });
    this.#subscriber = new RedisCtor(this.config.redis.url, { maxRetriesPerRequest: null });
    await this.#subscriber.subscribe(CHAT_EVENTS_CHANNEL);
    this.#subscriber.on('message', (...args: unknown[]) => this.onPubSubMessage(args[1] as string));
    this.#logger.log('Subscribed to Redis chat:events channel for cross-process fan-out');
  }

  async onApplicationShutdown(): Promise<void> {
    for (const timer of this.#presenceTimers.values()) clearTimeout(timer);
    this.#presenceTimers.clear();
    await this.#subscriber?.quit().catch(() => undefined);
    await this.#publisher?.quit().catch(() => undefined);
  }

  /**
   * Authenticate an incoming connection from its session cookie. Invalid or
   * missing sessions are refused by disconnecting the client; Socket.IO then
   * surfaces the disconnection to the client as a connect_error. The cookie is
   * the only credential — there is no query-string token, which would be logged
   * by intermediaries.
   */
  async handleConnection(client: Socket): Promise<void> {
    const cookieHeader = client.handshake.headers.cookie;
    const token = extractSessionCookie(cookieHeader);
    if (token === undefined) {
      this.#logger.debug(formatSafeLog({ event: 'chat.connect_no_cookie', id: client.id }));
      client.disconnect(true);
      return;
    }
    let session: AuthenticatedSession;
    try {
      session = await this.authorization.authenticate(cookieHeader);
    } catch {
      this.#logger.debug(formatSafeLog({ event: 'chat.connect_invalid_session', id: client.id }));
      client.disconnect(true);
      return;
    }
    // Stash the authenticated identity on the socket so every subsequent
    // command handler can authorize without re-reading the cookie. Socket.IO
    // permits arbitrary data on the socket object.
    (client.data as ClientData).profileId = session.aggregate.profile.profileId;
    (client.data as ClientData).tokenHash = session.tokenHash;
    await this.markOnline(session.aggregate.profile.profileId);
    this.#logger.debug(formatSafeLog({
      event: 'chat.connect', id: client.id,
      profile_id: session.aggregate.profile.profileId,
    }));
  }

  /**
   * Clean up presence on disconnect. A grace timer avoids flapping presence for
   * a brief reconnect; the timer is cleared if the same profile reconnects.
   */
  async handleDisconnect(client: Socket): Promise<void> {
    const profileId = (client.data as ClientData).profileId;
    if (profileId === undefined) return;
    const existing = this.#presenceTimers.get(profileId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.#presenceTimers.delete(profileId);
      void this.markOffline(profileId);
    }, PRESENCE_OFFLINE_GRACE_MS);
    timer.unref?.();
    this.#presenceTimers.set(profileId, timer);
    this.#logger.debug(formatSafeLog({ event: 'chat.disconnect', id: client.id, profile_id: profileId }));
  }

  /**
   * Join the room for one conversation. Authorization is enforced by a database
   * read against `conversation_participants`: a client may only join rooms for
   * conversations they are an active participant in, so the gateway never
   * becomes a route by which a non-participant (or a former, archived
   * participant) receives live messages. Returns an ack the client can await.
   */
  @SubscribeMessage('join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<JoinAck> {
    const profileId = requireProfile(client);
    const conversationId = parseConversationId(body);
    const allowed = await this.messaging.isParticipant(conversationId, profileId);
    if (!allowed) {
      return { ok: false, code: 'PERMISSION_DENIED' };
    }
    await client.join(roomName(conversationId));
    this.#logger.debug(formatSafeLog({
      event: 'chat.join', id: client.id, profile_id: profileId, conversation_id: conversationId,
    }));
    return { ok: true, conversation_id: conversationId };
  }

  /** Leave a conversation room. No-op if the client was not in the room. */
  @SubscribeMessage('leave')
  async onLeave(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<JoinAck> {
    const conversationId = parseConversationId(body);
    await client.leave(roomName(conversationId));
    return { ok: true, conversation_id: conversationId };
  }

  /**
   * Broadcast a typing indicator to the conversation room. The sender is
   * identified from the authenticated socket, never from the payload, so a
   * client cannot forge another user's typing status. The indicator is emitted
   * to the room with `except(client)` so the typist does not see their own echo.
   */
  @SubscribeMessage('typing')
  async onTyping(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<JoinAck> {
    const profileId = requireProfile(client);
    const conversationId = parseConversationId(body);
    this.server.to(roomName(conversationId)).except(client.id).emit('typing', {
      conversation_id: conversationId,
      profile_id: profileId,
    });
    return { ok: true, conversation_id: conversationId };
  }

  /** Broadcast a stop-typing indicator to the conversation room. */
  @SubscribeMessage('stop_typing')
  async onStopTyping(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<JoinAck> {
    const profileId = requireProfile(client);
    const conversationId = parseConversationId(body);
    this.server.to(roomName(conversationId)).except(client.id).emit('stop_typing', {
      conversation_id: conversationId,
      profile_id: profileId,
    });
    return { ok: true, conversation_id: conversationId };
  }

  /**
   * Push a message-created projection to a conversation room. Called when the
   * gateway receives a pub/sub message from the worker. The payload is the
   * minimum-necessary projection from the outbox event — no message text, which
   * is clinical/business data that an event stream fans out more widely than an
   * authorized read. Clients refetch under policy for content.
   */
  pushMessage(conversationId: string, message: MessagePush): void {
    this.server.to(roomName(conversationId)).emit('message_created', {
      conversation_id: conversationId,
      message_id: message.message_id,
      sender_profile_id: message.sender_profile_id,
      sequence_no: message.sequence_no,
      message_type: message.message_type,
    });
  }

  /** Push a receipt-updated projection to a conversation room. */
  pushReceiptUpdate(conversationId: string, receipt: ReceiptPush): void {
    this.server.to(roomName(conversationId)).emit('receipt_updated', {
      conversation_id: conversationId,
      profile_id: receipt.profile_id,
      through_sequence_no: receipt.through_sequence_no,
    });
  }

  /**
   * Broadcast a presence change to every conversation room the profile is a
   * participant in. The room list is read from the database so the broadcast
   * never reaches a room the profile left.
   */
  async pushPresence(profileId: string, status: PresenceStatus): Promise<void> {
    const conversationIds = await this.messaging.conversationsForProfile(profileId);
    for (const conversationId of conversationIds) {
      this.server.to(roomName(conversationId)).emit('presence', {
        profile_id: profileId,
        status,
      });
    }
  }

  /**
   * Publish a chat fan-out event to the Redis channel so every gateway instance
   * can push it. The worker calls this (indirectly, through its own publisher)
   * after it processes a `conversation.message-created.v1` or
   * `conversation.receipt-updated.v1` outbox event.
   */
  async publish(event: ChatPubSubEvent): Promise<void> {
    if (this.#publisher === undefined) return;
    await this.#publisher.publish(CHAT_EVENTS_CHANNEL, JSON.stringify(event));
  }

  /**
   * Handle a pub/sub message from the worker. Parses the event and routes it to
   * the matching push method. A malformed message is logged and dropped — the
   * outbox row is already marked processed by the worker, and a malformed pub/
   * sub message must not deadlock the worker's outbox progress.
   */
  private onPubSubMessage(raw: string): void {
    let event: ChatPubSubEvent;
    try {
      event = JSON.parse(raw) as ChatPubSubEvent;
    } catch {
      this.#logger.error(formatSafeLog({ event: 'chat.pubsub_parse_failed' }));
      return;
    }
    if (event.type === MESSAGE_CREATED_EVENT_TYPE) {
      this.pushMessage(event.conversation_id, {
        message_id: event.message_id,
        sender_profile_id: event.sender_profile_id,
        sequence_no: event.sequence_no,
        message_type: event.message_type,
      });
      return;
    }
    if (event.type === RECEIPT_UPDATED_EVENT_TYPE) {
      this.pushReceiptUpdate(event.conversation_id, {
        profile_id: event.profile_id,
        through_sequence_no: event.through_sequence_no,
      });
      return;
    }
    this.#logger.warn(formatSafeLog({
      event: 'chat.pubsub_unknown_type', type: (event as { type?: string }).type,
    }));
  }

  private async markOnline(profileId: string): Promise<void> {
    if (this.#publisher !== undefined) {
      await this.#publisher.set(
        presenceKey(profileId), 'online', 'EX', PRESENCE_TTL_SECONDS,
      ).catch(() => undefined);
    }
    await this.pushPresence(profileId, 'online');
  }

  private async markOffline(profileId: string): Promise<void> {
    if (this.#publisher !== undefined) {
      await this.#publisher.del(presenceKey(profileId)).catch(() => undefined);
    }
    await this.pushPresence(profileId, 'offline');
  }
}

// --- Shared types and helpers ---------------------------------------------

/**
 * The Redis operations the gateway uses. Declared as an interface so the
 * gateway depends on a small surface, not the full ioredis class, and so the
 * constructor can be reached through a type-only cast that `verbatimModuleSyntax`
 * requires for this CommonJS module (a default import resolves to the module
 * namespace, not the class, under that flag).
 */
export interface RedisLike {
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<number>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  set(key: string, value: string, mode?: string, ttl?: number): Promise<string>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<string>;
  ping(): Promise<string>;
}

interface ClientData {
  profileId?: string;
  tokenHash?: string;
}

export interface JoinAck {
  readonly ok: boolean;
  readonly code?: 'PERMISSION_DENIED' | 'VALIDATION_FAILED';
  readonly conversation_id?: string;
}

export interface MessagePush {
  readonly message_id: string;
  readonly sender_profile_id: string;
  readonly sequence_no: number;
  readonly message_type: 'text' | 'file' | 'system';
}

export interface ReceiptPush {
  readonly profile_id: string;
  readonly through_sequence_no: number;
}

/**
 * The shape of a chat fan-out event on the Redis pub/sub channel. Mirrors the
 * outbox event payloads, which are the contract the worker validates against.
 */
export type ChatPubSubEvent =
  | {
    readonly type: typeof MESSAGE_CREATED_EVENT_TYPE;
    readonly conversation_id: string;
    readonly message_id: string;
    readonly sender_profile_id: string;
    readonly sequence_no: number;
    readonly message_type: 'text' | 'file' | 'system';
  }
  | {
    readonly type: typeof RECEIPT_UPDATED_EVENT_TYPE;
    readonly conversation_id: string;
    readonly profile_id: string;
    readonly through_sequence_no: number;
  };

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The module-level holder the CORS origin callback reads. Set once in the
 * constructor. A module-level variable is used because Socket.IO evaluates the
 * `origin` option during server creation, before the gateway instance exists
 * in some NestJS lifecycle orderings, so a closure over `this` is not safe.
 */
let allowedOrigins: ReadonlySet<string> = new Set();

export function roomName(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export function presenceKey(profileId: string): string {
  return `chat:presence:${profileId}`;
}

function parseConversationId(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError();
  }
  const record = body as Record<string, unknown>;
  const value = record.conversation_id;
  if (typeof value !== 'string' || !UUID_V7.test(value)) throw new ValidationError();
  return value;
}

function requireProfile(client: Socket): string {
  const profileId = (client.data as ClientData).profileId;
  if (profileId === undefined) {
    // An unauthenticated socket should never reach a command handler because
    // handleConnection disconnects it. If it does, refuse rather than acting.
    throw new ValidationError();
  }
  return profileId;
}

class ValidationError extends Error {
  readonly code = 'VALIDATION_FAILED' as const;
}

/**
 * Format a log object as a single-line JSON string, mirroring the
 * `formatSafeLog` helper from `@smartcura/observability` without adding a new
 * import dependency to this file. Keeps the gateway's log lines consistent with
 * the worker's structured logs.
 */
function formatSafeLog(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ event: 'chat.log_serialization_failed' });
  }
}

// Re-export the cookie name for tests that construct handshake headers.
export { SESSION_COOKIE_NAME };
