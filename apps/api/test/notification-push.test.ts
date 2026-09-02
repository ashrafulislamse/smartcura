import assert from 'node:assert/strict';
import test from 'node:test';
import { PushTokenCipher } from '@smartcura/database';
import {
  DeterministicPushDeliveryProvider,
  NotificationPushHandler,
  type PushDeliveryProvider,
} from '../apps/worker/src/notification-push.handler.js';
import {
  FcmPushDeliveryProvider,
  type FcmMessagingClient,
} from '../apps/worker/src/fcm-push.provider.js';
import { loadWorkerConfig } from '../apps/worker/src/config.js';

const deliveryId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e10';
const profileId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e11';
const notificationId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2e12';

// The all-zero key is the CI/local default; it is deterministic so tests can
// seal and open tokens reproducibly.
const TEST_KEY = '0000000000000000000000000000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Deterministic push provider
// ---------------------------------------------------------------------------

test('deterministic push provider logs and reports success with a stable reference', async () => {
  const provider = new DeterministicPushDeliveryProvider();
  const result = await provider.send({
    operationId: deliveryId, profileId,
    devices: [{ pushDeviceId: 'dev-1', token: 'fcm-registration-token-aaa' }],
    notification: { title: 'New message', body: 'Tap to read it.' },
    data: { notification_id: notificationId, resource_type: 'conversation', resource_id: 'c1' },
    androidChannel: 'messages',
    priority: 'normal',
  });
  assert.equal(result.delivered, true);
  assert.equal(result.providerReference, `deterministic:${deliveryId}`);
  assert.equal(result.errorCode, null);
  assert.deepEqual(result.invalidDeviceIds, []);
});

// ---------------------------------------------------------------------------
// FCM push provider
// ---------------------------------------------------------------------------

/** Builds a mock messaging client that records calls and returns a canned response. */
interface RecordedMulticast {
  tokens: string[];
  data: Record<string, string> | undefined;
  notification?: { title?: string; body?: string };
  android?: { priority?: string; notification?: { channel_id?: string } };
}
function mockMessagingClient(overrides?: Partial<FcmMessagingClient>): {
  client: FcmMessagingClient;
  calls: RecordedMulticast[];
} {
  const calls: RecordedMulticast[] = [];
  const client: FcmMessagingClient = {
    sendEachForMulticast: async (message) => {
      calls.push({
        tokens: message.tokens,
        data: message.data,
        notification: message.notification,
        android: message.android,
      });
      return overrides?.sendEachForMulticast
        ? overrides.sendEachForMulticast(message)
        : {
            successCount: message.tokens.length,
            failureCount: 0,
            responses: message.tokens.map((token) => ({
              success: true,
              messageId: `msg:${token.slice(0, 8)}`,
            })),
          };
    },
  };
  return { client, calls };
}

const pushSendInput = (overrides?: Partial<Parameters<FcmPushDeliveryProvider['send']>[0]>) => ({
  operationId: deliveryId,
  profileId,
  devices: [
    { pushDeviceId: 'device-a', token: 'token-a' },
    { pushDeviceId: 'device-b', token: 'token-b' },
  ],
  notification: { title: 'New message', body: 'Tap to read and reply.' },
  data: { notification_id: notificationId, resource_type: 'conversation', resource_id: 'c1' },
  androidChannel: 'messages',
  priority: 'normal' as const,
  ...overrides,
});

test('FCM provider sends a multicast to every token and reports delivered when at least one succeeds', async () => {
  const { client, calls } = mockMessagingClient();
  const provider = new FcmPushDeliveryProvider(
    { projectId: 'p', clientEmail: 'e@test', privateKey: 'k' },
    client,
  );
  const result = await provider.send(pushSendInput());
  assert.equal(result.delivered, true);
  assert.equal(result.errorCode, null);
  assert.equal(result.providerReference !== null, true);
  assert.deepEqual(result.invalidDeviceIds, []);
  // The multicast addressed both tokens.
  assert.deepEqual(calls[0]!.tokens, ['token-a', 'token-b']);
  // The user-facing copy travelled in the notification field, not the data payload.
  assert.equal(calls[0]!.notification!.title, 'New message');
  assert.equal(calls[0]!.notification!.body, 'Tap to read and reply.');
  // The notification metadata was forwarded as data payload.
  assert.equal(calls[0]!.data!.notification_id, notificationId);
  assert.equal(calls[0]!.data!.resource_type, 'conversation');
  assert.equal(calls[0]!.data!.resource_id, 'c1');
});

test('FCM provider maps critical priority to android high and names the channel', async () => {
  const { client, calls } = mockMessagingClient();
  const provider = new FcmPushDeliveryProvider(
    { projectId: 'p', clientEmail: 'e@test', privateKey: 'k' },
    client,
  );
  await provider.send(pushSendInput({ priority: 'critical', androidChannel: 'emergency' }));
  assert.equal(calls[0]!.android!.priority, 'high');
  assert.equal(calls[0]!.android!.notification!.channel_id, 'emergency');
});

test('FCM provider returns permanently-invalid devices for pruning', async () => {
  const { client } = mockMessagingClient({
    sendEachForMulticast: async (message) => ({
      successCount: 1,
      failureCount: 1,
      responses: message.tokens.map((token, index) => index === 0
        ? { success: true, messageId: 'msg:ok' }
        : { success: false, error: { message: 'Requested entity was not found. (UNREGISTERED)' } }),
    }),
  });
  const provider = new FcmPushDeliveryProvider(
    { projectId: 'p', clientEmail: 'e@test', privateKey: 'k' },
    client,
  );
  const result = await provider.send(pushSendInput());
  // At least one device accepted, so the delivery itself succeeded…
  assert.equal(result.delivered, true);
  // …but the UNREGISTERED device must be reported so the handler prunes it.
  assert.deepEqual(result.invalidDeviceIds, ['device-b']);
});

test('FCM provider does not prune transient per-device failures', async () => {
  const { client } = mockMessagingClient({
    sendEachForMulticast: async (message) => ({
      successCount: 1,
      failureCount: 1,
      responses: message.tokens.map((token, index) => index === 0
        ? { success: true, messageId: 'msg:ok' }
        : { success: false, error: { message: 'Internal error : QUOTA_EXCEEDED' } }),
    }),
  });
  const provider = new FcmPushDeliveryProvider(
    { projectId: 'p', clientEmail: 'e@test', privateKey: 'k' },
    client,
  );
  const result = await provider.send(pushSendInput());
  assert.equal(result.delivered, true);
  assert.deepEqual(result.invalidDeviceIds, [], 'a quota error is transient, not a dead token');
});

test('FCM provider reports a failure when every device rejects the message', async () => {
  const { client } = mockMessagingClient({
    sendEachForMulticast: async (message) => ({
      successCount: 0,
      failureCount: message.tokens.length,
      responses: message.tokens.map(() => ({
        success: false,
        error: { message: 'UNREGISTERED' },
      })),
    }),
  });
  const provider = new FcmPushDeliveryProvider(
    { projectId: 'p', clientEmail: 'e@test', privateKey: 'k' },
    client,
  );
  const result = await provider.send(pushSendInput({
    devices: [{ pushDeviceId: 'device-a', token: 'stale-token' }],
  }));
  assert.equal(result.delivered, false);
  assert.equal(result.errorCode, 'fcm_all_failed');
  assert.equal(result.providerReference, null);
  assert.deepEqual(result.invalidDeviceIds, ['device-a']);
});

test('FCM provider reports no_registered_devices when no tokens are present', async () => {
  const { client, calls } = mockMessagingClient();
  const provider = new FcmPushDeliveryProvider(
    { projectId: 'p', clientEmail: 'e@test', privateKey: 'k' },
    client,
  );
  const result = await provider.send(pushSendInput({ devices: [] }));
  assert.equal(result.delivered, false);
  assert.equal(result.errorCode, 'no_registered_devices');
  assert.equal(calls.length, 0, 'the provider must not call FCM when there are no tokens');
});

test('FCM provider reports fcm_send_error when the SDK throws', async () => {
  const { client } = mockMessagingClient({
    sendEachForMulticast: async () => { throw new Error('network down'); },
  });
  const provider = new FcmPushDeliveryProvider(
    { projectId: 'p', clientEmail: 'e@test', privateKey: 'k' },
    client,
  );
  const result = await provider.send(pushSendInput({
    devices: [{ pushDeviceId: 'device-a', token: 'token-a' }],
  }));
  assert.equal(result.delivered, false);
  assert.equal(result.errorCode, 'fcm_send_error');
  assert.equal(result.providerReference, null);
});

// ---------------------------------------------------------------------------
// Push handler with token decryption
// ---------------------------------------------------------------------------

const cipher = new PushTokenCipher(TEST_KEY);

test('push handler decrypts sealed tokens, renders copy, and forwards typed targets', async () => {
  const sent: unknown[] = [];
  const sealedToken = cipher.seal('fcm-registration-token-aaa');
  const repository = {
    loadPushWork: async () => ({
      deliveryId, notificationId, profileId, category: 'messages',
      resourceType: 'conversation', resourceId: 'c1', status: 'queued',
      titleCode: 'message.new.title', bodyCode: 'message.new.body', priority: 'normal',
    }),
    listEnabledPushDevices: async () => [
      { pushDeviceId: 'dev-1', platform: 'android', tokenCiphertext: sealedToken, enabled: true },
    ],
    settlePush: async (input: unknown) => { return 'settled' as const; },
    suppressPush: async () => 'settled' as const,
    disablePushDevices: async () => 0,
  };
  const provider: PushDeliveryProvider = {
    send: async (input) => {
      sent.push(input);
      return { delivered: true, providerReference: 'fcm:1', errorCode: null, invalidDeviceIds: [] };
    },
  };
  const handler = new NotificationPushHandler(repository as never, provider, cipher);
  assert.equal(await handler.handle(deliveryId), true);
  const call = sent[0] as {
    devices: { pushDeviceId: string; token: string }[];
    notification: { title: string; body: string };
    data: Record<string, string>;
  };
  // The decrypted token travelled as a typed target, never as a data key.
  assert.deepEqual(call.devices, [{ pushDeviceId: 'dev-1', token: 'fcm-registration-token-aaa' }]);
  // The user-facing copy came from the server-side catalogue, not a generic string.
  assert.equal(call.notification.title, 'New message');
  assert.match(call.notification.body, /message/i);
  // The deep link and metadata are present for the client's tap handler.
  assert.equal(call.data.notification_id, notificationId);
  assert.equal(call.data.deep_link, 'smartcura://conversations/c1');
  assert.equal(call.data.title_code, 'message.new.title');
});

test('push handler settles a decrypt failure without sending', async () => {
  const sent: unknown[] = [];
  const settlements: unknown[] = [];
  const repository = {
    loadPushWork: async () => ({
      deliveryId, notificationId, profileId, category: 'messages',
      resourceType: 'conversation', resourceId: 'c1', status: 'queued',
      titleCode: 'message.new.title', bodyCode: 'message.new.body', priority: 'normal',
    }),
    listEnabledPushDevices: async () => [
      { pushDeviceId: 'dev-1', platform: 'ios', tokenCiphertext: 'not-a-valid-sealed-token', enabled: true },
    ],
    settlePush: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
    suppressPush: async () => 'settled' as const,
    disablePushDevices: async () => 0,
  };
  const provider: PushDeliveryProvider = {
    send: async (input) => { sent.push(input); return { delivered: true, providerReference: 'x', errorCode: null, invalidDeviceIds: [] }; },
  };
  const handler = new NotificationPushHandler(repository as never, provider, cipher);
  assert.equal(await handler.handle(deliveryId), true);
  assert.equal(sent.length, 0, 'the provider must not be called when decryption fails');
  assert.equal((settlements[0] as { errorCode: string | null }).errorCode, 'token_decrypt_error');
  assert.equal((settlements[0] as { delivered: boolean }).delivered, false);
});

test('push handler suppresses (not fails) a profile with no registered devices', async () => {
  const sent: unknown[] = [];
  const suppressions: string[] = [];
  const repository = {
    loadPushWork: async () => ({
      deliveryId, notificationId, profileId, category: 'messages',
      resourceType: 'conversation', resourceId: 'c1', status: 'queued',
      titleCode: 'message.new.title', bodyCode: 'message.new.body', priority: 'normal',
    }),
    listEnabledPushDevices: async () => [],
    settlePush: async () => 'settled' as const,
    suppressPush: async (delivery: string) => { suppressions.push(delivery); return 'settled' as const; },
    disablePushDevices: async () => 0,
  };
  const provider: PushDeliveryProvider = {
    send: async (input) => { sent.push(input); return { delivered: true, providerReference: 'x', errorCode: null, invalidDeviceIds: [] }; },
  };
  const handler = new NotificationPushHandler(repository as never, provider, cipher);
  assert.equal(await handler.handle(deliveryId), true);
  // A missing device is a data gap: terminal suppressed, provider untouched, no
  // outbox retry of a permanent condition.
  assert.equal(sent.length, 0);
  assert.deepEqual(suppressions, [deliveryId]);
});

test('push handler prunes devices FCM reported permanently invalid and retries transient failures', async () => {
  const pruned: string[] = [];
  const settlements: unknown[] = [];
  const sealed = cipher.seal('dead-token');
  const repository = {
    loadPushWork: async () => ({
      deliveryId, notificationId, profileId, category: 'messages',
      resourceType: 'conversation', resourceId: 'c1', status: 'queued',
      titleCode: 'message.new.title', bodyCode: 'message.new.body', priority: 'normal',
    }),
    listEnabledPushDevices: async () => [
      { pushDeviceId: 'dev-dead', platform: 'android', tokenCiphertext: sealed, enabled: true },
    ],
    settlePush: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
    suppressPush: async () => 'settled' as const,
    disablePushDevices: async (ids: readonly string[]) => { pruned.push(...ids); return ids.length; },
  };
  const provider: PushDeliveryProvider = {
    send: async () => ({
      delivered: false, providerReference: null, errorCode: 'fcm_all_failed',
      invalidDeviceIds: ['dev-dead'],
    }),
  };
  const handler = new NotificationPushHandler(repository as never, provider, cipher);
  // fcm_all_failed is transient: the handler returns false so the outbox retries.
  assert.equal(await handler.handle(deliveryId), false);
  // The rotting token can never be addressed again — pruning happens even on transient failure.
  assert.deepEqual(pruned, ['dev-dead']);
  // The delivery is NOT settled — it stays 'queued' for the outbox to retry.
  assert.equal(settlements.length, 0);
});

test('push handler settles a permanent provider failure (no_registered_devices) and returns true', async () => {
  const settlements: unknown[] = [];
  const sealed = cipher.seal('tok');
  const repository = {
    loadPushWork: async () => ({
      deliveryId, notificationId, profileId, category: 'messages',
      resourceType: 'conversation', resourceId: 'c1', status: 'queued',
      titleCode: 'message.new.title', bodyCode: 'message.new.body', priority: 'normal',
    }),
    listEnabledPushDevices: async () => [
      { pushDeviceId: 'dev-1', platform: 'android', tokenCiphertext: sealed, enabled: true },
    ],
    settlePush: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
    suppressPush: async () => 'settled' as const,
    disablePushDevices: async () => 0,
  };
  const provider: PushDeliveryProvider = {
    send: async () => ({
      delivered: false, providerReference: null, errorCode: 'no_registered_devices',
      invalidDeviceIds: [],
    }),
  };
  const handler = new NotificationPushHandler(repository as never, provider, cipher);
  // no_registered_devices is permanent: settle as failed, return true.
  assert.equal(await handler.handle(deliveryId), true);
  assert.equal((settlements[0] as { delivered: boolean }).delivered, false);
  assert.equal((settlements[0] as { errorCode: string | null }).errorCode, 'no_registered_devices');
});

test('push handler retries a transient fcm_send_error without settling', async () => {
  const settlements: unknown[] = [];
  const sealed = cipher.seal('tok');
  const repository = {
    loadPushWork: async () => ({
      deliveryId, notificationId, profileId, category: 'messages',
      resourceType: 'conversation', resourceId: 'c1', status: 'queued',
      titleCode: 'message.new.title', bodyCode: 'message.new.body', priority: 'normal',
    }),
    listEnabledPushDevices: async () => [
      { pushDeviceId: 'dev-1', platform: 'android', tokenCiphertext: sealed, enabled: true },
    ],
    settlePush: async (input: unknown) => { settlements.push(input); return 'settled' as const; },
    suppressPush: async () => 'settled' as const,
    disablePushDevices: async () => 0,
  };
  const provider: PushDeliveryProvider = {
    send: async () => ({
      delivered: false, providerReference: null, errorCode: 'fcm_send_error',
      invalidDeviceIds: [],
    }),
  };
  const handler = new NotificationPushHandler(repository as never, provider, cipher);
  // fcm_send_error is transient: return false, no settlement.
  assert.equal(await handler.handle(deliveryId), false);
  assert.equal(settlements.length, 0);
});

// ---------------------------------------------------------------------------
// Config / provider selection
// ---------------------------------------------------------------------------

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/smartcura',
};

test('push provider defaults to deterministic', () => {
  const config = loadWorkerConfig({ ...baseEnv });
  assert.equal(config.pushProvider, 'deterministic');
  assert.equal(config.firebase, undefined);
});

test('firebase credentials are parsed from discrete env vars with newlines restored', () => {
  const config = loadWorkerConfig({
    ...baseEnv,
    SMARTCURA_PUSH_PROVIDER: 'fcm',
    FIREBASE_PROJECT_ID: 'smartcura-prod',
    FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@smartcura-prod.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nMIIB\\n-----END PRIVATE KEY-----\\n',
  });
  assert.notEqual(config.firebase, undefined);
  assert.equal(config.firebase!.projectId, 'smartcura-prod');
  // The escaped \\n sequence is restored to a real newline.
  assert.equal(config.firebase!.privateKey.includes('\n'), true);
  assert.equal(config.firebase!.privateKey.includes('\\n'), false);
});

test('firebase credentials stay undefined when only some discrete vars are set', () => {
  const partial = loadWorkerConfig({
    ...baseEnv,
    SMARTCURA_PUSH_PROVIDER: 'fcm',
    FIREBASE_PROJECT_ID: 'smartcura-prod',
    FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@smartcura-prod.iam.gserviceaccount.com',
  });
  assert.equal(partial.firebase, undefined);
});

test('worker config carries the push token encryption key', () => {
  const config = loadWorkerConfig({ ...baseEnv });
  assert.equal(config.pushTokenEncryptionKey, TEST_KEY);
});
