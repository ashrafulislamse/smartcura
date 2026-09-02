import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChatGateway,
  CHAT_EVENTS_CHANNEL,
  CHAT_NAMESPACE,
  PRESENCE_STATUSES,
  roomName,
  presenceKey,
  type ChatPubSubEvent,
  type JoinAck,
  type RedisLike,
} from '../apps/api/src/consultations/chat.gateway.js';
import {
  ChatEventPublisher,
  type RedisLike as PublisherRedisLike,
} from '../apps/worker/src/chat-event.publisher.js';
import {
  OutboxProcessor,
} from '../apps/worker/src/outbox.processor.js';
import {
  MESSAGE_CREATED_EVENT_TYPE,
  RECEIPT_UPDATED_EVENT_TYPE,
} from '@smartcura/database/consultations';
import type { AuthenticatedSession, SessionAggregate } from '../apps/api/src/platform/request-authorization.js';
import type { MessagingRepository } from '@smartcura/database/consultations';

const conversationId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d40';
const profileId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d42';
const otherProfileId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d49';
const messageId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d43';

/**
 * A minimal in-memory Redis-like double for the gateway's pub/sub and presence
 * store. Implements only the {@link RedisLike} surface the gateway uses, so the
 * gateway never touches a real Redis server in unit tests. Records every
 * publish and set so a test can assert what the gateway would have broadcast.
 */
class FakeRedis implements RedisLike {
  readonly published: Array<{ channel: string; message: string }> = [];
  readonly store = new Map<string, string>();
  readonly subscribers: Array<(channel: string, message: string) => void> = [];
  #onMessage?: (channel: string, message: string) => void;

  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    for (const sub of this.subscribers) sub(channel, message);
    this.#onMessage?.(channel, message);
    return 1;
  }
  async subscribe(..._channels: string[]): Promise<number> { return 1; }
  on(event: string, listener: (...args: unknown[]) => void): unknown {
    if (event === 'message') {
      this.#onMessage = (channel, message) => listener(channel, message);
    }
    return this;
  }
  async set(key: string, value: string, _mode?: string, _ttl?: number): Promise<string> {
    this.store.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) if (this.store.delete(key)) count++;
    return count;
  }
  async quit(): Promise<string> { return 'OK'; }
  async ping(): Promise<string> { return 'PONG'; }
}

/**
 * A fake Socket.IO Socket that records joins, leaves, and emits. The gateway
 * only uses `handshake.headers.cookie`, `data`, `join`, `leave`, `id`, and
 * `disconnect`, so this double implements exactly that surface.
 */
interface FakeSocket {
  id: string;
  handshake: { headers: { cookie?: string } };
  data: Record<string, unknown>;
  joinedRooms: Set<string>;
  disconnected: boolean;
  join(room: string): Promise<void>;
  leave(room: string): Promise<void>;
  disconnect(close?: boolean): FakeSocket;
}

function fakeSocket(cookie?: string): FakeSocket {
  return {
    id: `socket-${Math.random().toString(36).slice(2)}`,
    handshake: { headers: cookie === undefined ? {} : { cookie } },
    data: {},
    joinedRooms: new Set<string>(),
    disconnected: false,
    async join(room) { this.joinedRooms.add(room); },
    async leave(room) { this.joinedRooms.delete(room); },
    disconnect() { this.disconnected = true; return this; },
  };
}

/**
 * A fake BroadcastOperator that records what the gateway emits to a room. The
 * gateway calls `server.to(room).emit(event, payload)` and
 * `server.to(room).except(id).emit(...)`. This double captures those calls.
 */
interface EmitRecord {
  room: string;
  event: string;
  payload: unknown;
  exceptId?: string;
}

function fakeServer() {
  const emits: EmitRecord[] = [];
  const to = (room: string) => ({
    except(id: string) {
      return {
        emit: (event: string, payload: unknown) => emits.push({ room, event, payload, exceptId: id }),
      };
    },
    emit: (event: string, payload: unknown) => emits.push({ room, event, payload }),
  });
  return { to, emits };
}

/**
 * Build an AuthenticatedSession double with just enough of the aggregate for the
 * gateway: a profile id. The gateway only reads
 * `session.aggregate.profile.profileId` and `session.tokenHash`.
 */
function fakeSession(pid: string): AuthenticatedSession {
  const aggregate = {
    profile: { profileId: pid },
    session: {},
    memberships: [],
  } as unknown as SessionAggregate;
  return Object.freeze({ token: 't', tokenHash: 'h', aggregate });
}

/**
 * A fake SessionAuthorizationService that succeeds for a given session token
 * value (the cookie value, not the full cookie header) or throws otherwise,
 * mirroring how the real service refuses an invalid session.
 */
function fakeAuthorization(validToken: string, session: AuthenticatedSession) {
  return {
    async authenticate(cookieHeader: string | undefined) {
      const token = cookieHeader?.split('__Host-smartcura_session=')[1]?.trim();
      if (token === validToken) return session;
      throw new Error('invalid session');
    },
  } as never;
}

/**
 * A fake MessagingRepository with configurable participant and
 * conversations-for-profile responses, so a test can exercise the authorized
 * and unauthorized join paths and the presence broadcast scoping.
 */
function fakeMessaging(opts: {
  isParticipant?: (cid: string, pid: string) => Promise<boolean>;
  conversationsForProfile?: (pid: string) => Promise<string[]>;
}): MessagingRepository {
  return {
    isParticipant: opts.isParticipant ?? (async () => true),
    conversationsForProfile: opts.conversationsForProfile ?? (async () => []),
  } as unknown as MessagingRepository;
}

function fakeConfig(redis?: { url: string }): never {
  return {
    allowedOrigins: ['http://127.0.0.1:3001'],
    redis,
  } as never;
}

const VALID_TOKEN = `${profileId}-session-token`;
const VALID_COOKIE = `__Host-smartcura_session=${VALID_TOKEN}`;

test('ChatGateway constants match the AsyncAPI contract: /chat namespace, chat:events channel, conversation room names', () => {
  assert.equal(CHAT_NAMESPACE, '/chat');
  assert.equal(CHAT_EVENTS_CHANNEL, 'chat:events');
  assert.equal(roomName(conversationId), `conversation:${conversationId}`);
  assert.equal(presenceKey(profileId), `chat:presence:${profileId}`);
});

test('PRESENCE_STATUSES is the frozen vocabulary and online/away/offline are exhaustive', () => {
  assert.deepEqual([...PRESENCE_STATUSES], ['online', 'away', 'offline']);
});

test('handleConnection authenticates a valid session cookie and stashes the profile id on the socket', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({}),
  );
  const server = fakeServer();
  gateway.server = server as never;
  const socket = fakeSocket(VALID_COOKIE);
  await gateway.handleConnection(socket as never);
  assert.equal(socket.disconnected, false);
  assert.equal((socket.data as { profileId?: string }).profileId, profileId);
});

test('handleConnection disconnects a socket with no session cookie', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({}),
  );
  const socket = fakeSocket(undefined);
  await gateway.handleConnection(socket as never);
  assert.equal(socket.disconnected, true);
});

test('handleConnection disconnects a socket with an invalid session cookie', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({}),
  );
  const socket = fakeSocket('__Host-smartcura_session=wrong-token');
  await gateway.handleConnection(socket as never);
  assert.equal(socket.disconnected, true);
  assert.equal((socket.data as { profileId?: string }).profileId, undefined);
});

test('join admits an authorized participant to the conversation room and acks ok', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({ isParticipant: async () => true }),
  );
  const server = fakeServer();
  gateway.server = server as never;
  const socket = fakeSocket(VALID_COOKIE);
  await gateway.handleConnection(socket as never);
  const ack = await gateway.onJoin(socket as never, { conversation_id: conversationId });
  assert.deepEqual(ack, { ok: true, conversation_id: conversationId });
  assert.equal(socket.joinedRooms.has(roomName(conversationId)), true);
});

test('join refuses a non-participant with PERMISSION_DENIED and does not add the socket to the room', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({ isParticipant: async () => false }),
  );
  const server = fakeServer();
  gateway.server = server as never;
  const socket = fakeSocket(VALID_COOKIE);
  await gateway.handleConnection(socket as never);
  const ack = await gateway.onJoin(socket as never, { conversation_id: conversationId });
  assert.deepEqual(ack, { ok: false, code: 'PERMISSION_DENIED' });
  assert.equal(socket.joinedRooms.has(roomName(conversationId)), false);
});

test('leave removes the socket from the conversation room', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({ isParticipant: async () => true }),
  );
  const server = fakeServer();
  gateway.server = server as never;
  const socket = fakeSocket(VALID_COOKIE);
  await gateway.handleConnection(socket as never);
  await gateway.onJoin(socket as never, { conversation_id: conversationId });
  assert.equal(socket.joinedRooms.has(roomName(conversationId)), true);
  await gateway.onLeave(socket as never, { conversation_id: conversationId });
  assert.equal(socket.joinedRooms.has(roomName(conversationId)), false);
});

test('typing broadcasts a typing indicator to the room except the sender, identified from the authenticated socket', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({}),
  );
  const server = fakeServer();
  gateway.server = server as never;
  const socket = fakeSocket(VALID_COOKIE);
  await gateway.handleConnection(socket as never);
  await gateway.onTyping(socket as never, { conversation_id: conversationId });
  const typingEmit = server.emits.find((e) => e.event === 'typing');
  assert.notEqual(typingEmit, undefined);
  assert.equal(typingEmit!.room, roomName(conversationId));
  assert.equal(typingEmit!.exceptId, socket.id);
  assert.deepEqual(typingEmit!.payload, { conversation_id: conversationId, profile_id: profileId });
});

test('stop_typing broadcasts a stop-typing indicator to the room except the sender', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({}),
  );
  const server = fakeServer();
  gateway.server = server as never;
  const socket = fakeSocket(VALID_COOKIE);
  await gateway.handleConnection(socket as never);
  await gateway.onStopTyping(socket as never, { conversation_id: conversationId });
  const stopEmit = server.emits.find((e) => e.event === 'stop_typing');
  assert.notEqual(stopEmit, undefined);
  assert.equal(stopEmit!.exceptId, socket.id);
  assert.deepEqual(stopEmit!.payload, { conversation_id: conversationId, profile_id: profileId });
});

test('pushMessage emits a message_created projection to the conversation room with no message text', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({}),
  );
  const server = fakeServer();
  gateway.server = server as never;
  gateway.pushMessage(conversationId, {
    message_id: messageId, sender_profile_id: profileId, sequence_no: 1, message_type: 'text',
  });
  const emit = server.emits.find((e) => e.event === 'message_created');
  assert.notEqual(emit, undefined);
  assert.equal(emit!.room, roomName(conversationId));
  assert.deepEqual(emit!.payload, {
    conversation_id: conversationId, message_id: messageId,
    sender_profile_id: profileId, sequence_no: 1, message_type: 'text',
  });
  // The minimum-necessary projection carries no text content: clinical data an
  // event stream fans out more widely than an authorized read.
  assert.equal(JSON.stringify(emit!.payload).includes('text_content'), false);
});

test('pushReceiptUpdate emits a receipt_updated projection to the conversation room', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({}),
  );
  const server = fakeServer();
  gateway.server = server as never;
  gateway.pushReceiptUpdate(conversationId, { profile_id: otherProfileId, through_sequence_no: 3 });
  const emit = server.emits.find((e) => e.event === 'receipt_updated');
  assert.notEqual(emit, undefined);
  assert.deepEqual(emit!.payload, {
    conversation_id: conversationId, profile_id: otherProfileId, through_sequence_no: 3,
  });
});

test('pushPresence emits a presence event to every conversation room the profile is in', async () => {
  const gateway = new ChatGateway(
    fakeConfig(undefined),
    fakeAuthorization(VALID_TOKEN, fakeSession(profileId)),
    fakeMessaging({ conversationsForProfile: async () => [conversationId, otherProfileId] }),
  );
  const server = fakeServer();
  gateway.server = server as never;
  await gateway.pushPresence(profileId, 'online');
  const presenceEmits = server.emits.filter((e) => e.event === 'presence');
  assert.equal(presenceEmits.length, 2);
  assert.equal(presenceEmits.some((e) => e.room === roomName(conversationId)), true);
  assert.equal(presenceEmits.some((e) => e.room === roomName(otherProfileId)), true);
  for (const e of presenceEmits) {
    assert.deepEqual(e.payload, { profile_id: profileId, status: 'online' });
  }
});

test('ChatEventPublisher publishes the exact minimum-data message-created event to the chat:events channel', async () => {
  const fake = new FakeRedis();
  // Inject the fake Redis client through the constructor test seam so no real
  // Redis server is contacted. The publisher's publish path records every call.
  const publisher = new ChatEventPublisher(fake as unknown as PublisherRedisLike);
  await publisher.publishMessageCreated({
    conversation_id: conversationId, message_id: messageId, sender_profile_id: profileId,
    sequence_no: 1, message_type: 'text',
  });
  assert.equal(fake.published.length, 1);
  assert.equal(fake.published[0]!.channel, CHAT_EVENTS_CHANNEL);
  const parsed = JSON.parse(fake.published[0]!.message) as ChatPubSubEvent;
  assert.equal(parsed.type, MESSAGE_CREATED_EVENT_TYPE);
  assert.deepEqual(parsed, {
    type: MESSAGE_CREATED_EVENT_TYPE, conversation_id: conversationId, message_id: messageId,
    sender_profile_id: profileId, sequence_no: 1, message_type: 'text',
  });
});

test('OutboxProcessor publishes chat fan-out to the publisher when it processes a contract-valid message-created event', async () => {
  const published: ChatPubSubEvent[] = [];
  // The mock mirrors the real ChatEventPublisher: it adds the `type` field
  // itself, so the OutboxProcessor passes the projection fields only.
  const chatPublisher = {
    publishMessageCreated: async (event: {
      conversation_id: string; message_id: string; sender_profile_id: string;
      sequence_no: number; message_type: string;
    }) => {
      published.push({ type: MESSAGE_CREATED_EVENT_TYPE, ...event } as never);
    },
    publishReceiptUpdated: async () => { published.push({} as never); },
  } as never;
  const processor = new OutboxProcessor(
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, chatPublisher,
  );
  const result = await processor.process({
    eventId: messageId, eventType: MESSAGE_CREATED_EVENT_TYPE, eventVersion: 1, attempts: 1,
    payload: {
      conversation_id: conversationId, message_id: messageId, sender_profile_id: profileId,
      sequence_no: 1, message_type: 'text',
    },
  } as never);
  assert.equal(result, true);
  assert.equal(published.length, 1);
  assert.equal(published[0]!.type, MESSAGE_CREATED_EVENT_TYPE);
  // The outbox passed the minimum projection through, not the raw payload.
  assert.deepEqual(published[0], {
    type: MESSAGE_CREATED_EVENT_TYPE, conversation_id: conversationId, message_id: messageId,
    sender_profile_id: profileId, sequence_no: 1, message_type: 'text',
  });
});

test('OutboxProcessor publishes chat fan-out for a contract-valid receipt-updated event', async () => {
  const published: ChatPubSubEvent[] = [];
  const chatPublisher = {
    publishMessageCreated: async () => { published.push({} as never); },
    publishReceiptUpdated: async (event: {
      conversation_id: string; profile_id: string; through_sequence_no: number;
    }) => {
      published.push({ type: RECEIPT_UPDATED_EVENT_TYPE, ...event } as never);
    },
  } as never;
  const processor = new OutboxProcessor(
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, chatPublisher,
  );
  const result = await processor.process({
    eventId: messageId, eventType: RECEIPT_UPDATED_EVENT_TYPE, eventVersion: 1, attempts: 1,
    payload: {
      conversation_id: conversationId, profile_id: profileId, through_sequence_no: 2,
    },
  } as never);
  assert.equal(result, true);
  assert.equal(published.length, 1);
  assert.equal(published[0]!.type, RECEIPT_UPDATED_EVENT_TYPE);
  assert.deepEqual(published[0], {
    type: RECEIPT_UPDATED_EVENT_TYPE, conversation_id: conversationId,
    profile_id: profileId, through_sequence_no: 2,
  });
});

test('OutboxProcessor does not publish chat fan-out when the chatPublisher is undefined (CI/local dev)', async () => {
  const processor = new OutboxProcessor(
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  );
  const result = await processor.process({
    eventId: messageId, eventType: MESSAGE_CREATED_EVENT_TYPE, eventVersion: 1, attempts: 1,
    payload: {
      conversation_id: conversationId, message_id: messageId, sender_profile_id: profileId,
      sequence_no: 1, message_type: 'text',
    },
  } as never);
  assert.equal(result, true);
});

test('JoinAck for a valid join carries the conversation id and ok=true', () => {
  const ack: JoinAck = { ok: true, conversation_id: conversationId };
  assert.equal(ack.ok, true);
  assert.equal(ack.conversation_id, conversationId);
});
