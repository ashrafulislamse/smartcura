import { Logger } from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { formatSafeLog } from '@smartcura/observability';
import type { PushDeliveryProvider, PushDeliveryResult, PushTarget } from './notification-push.handler.js';

/**
 * The slice of `firebase-admin`'s `Messaging` the provider calls. Declared as a
 * structural interface so tests can supply a mock without importing the SDK.
 */
export interface FcmMessagingClient {
  sendEachForMulticast(message: {
    tokens: string[];
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
    android?: {
      priority?: 'high' | 'normal';
      notification?: { channel_id?: string };
    };
  }): Promise<{
    successCount: number;
    failureCount: number;
    responses: { success: boolean; messageId?: string; error?: { code?: string; message?: string } }[];
  }>;
}

/**
 * Firebase service account credentials. Provide either the three discrete env
 * vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)
 * or a path to a JSON key file (`FIREBASE_SERVICE_ACCOUNT_PATH`). The discrete
 * form is preferred for Coolify, where secrets are injected as env vars and a
 * file mount would be an extra moving part.
 */
export interface FcmProviderConfig {
  projectId: string;
  clientEmail: string;
  /**
   * The PEM-encoded private key. In environment variables the literal newlines
   * in the PEM are usually escaped as `\n`; the factory replaces them before
   * handing the key to `firebase-admin`.
   */
  privateKey: string;
}

/**
 * FCM error markers that mean the token can never be delivered to again. The
 * HTTP v1 API surfaces these inside `error.message` (and `error.code` when the
 * SDK populates it); matching the marker strings is what firebase-admin's own
 * internal batching does. Anything else (quota, internal, unavailable,
 * throttling) is treated as transient and left enabled for retry.
 */
const PERMANENT_TOKEN_ERRORS: readonly string[] = [
  'UNREGISTERED',
  'INVALID_REGISTRATION',
  'SENDER_ID_MISMATCH',
];

/**
 * Error markers that indicate a permanent FCM configuration or credential
 * problem (not a dead token). These settle the delivery immediately instead
 * of retrying 10 times against a config error that will never succeed.
 */
const PERMANENT_CONFIG_ERRORS: readonly string[] = [
  'INVALID_ARGUMENT',
  'SENDER_ID_MISMATCH',
  'THIRD_PARTY_AUTH_ERROR',
];

/**
 * Firebase Cloud Messaging adapter for the push delivery channel.
 *
 * The provider holds a lazily-initialised `firebase-admin` app and messaging
 * client. `send()` fans one notification out to every FCM registration token the
 * recipient has registered: the worker resolves the enabled device rows for the
 * profile, opens the sealed tokens with `PushTokenCipher`, and hands typed
 * targets here. A multicast send is one FCM API call regardless of device count,
 * which keeps the outbox processor's latency bounded.
 *
 * The delivery result is `delivered: true` when at least one device accepted the
 * message; the provider reference is the first successful message id. If every
 * device fails the result is `delivered: false` with an `fcm_all_failed` code so
 * the worker records the failure and the outbox retry policy applies. Devices
 * whose individual response names a permanent token error are returned in
 * `invalidDeviceIds` so the handler can prune them.
 */
export class FcmPushDeliveryProvider implements PushDeliveryProvider {
  private readonly logger = new Logger(FcmPushDeliveryProvider.name);
  private messaging: FcmMessagingClient | undefined;

  constructor(
    private readonly config: FcmProviderConfig,
    /** Override for tests; in production this is undefined and built lazily. */
    private readonly clientOverride?: FcmMessagingClient,
  ) {}

  async send(input: {
    operationId: string;
    profileId: string;
    devices: readonly PushTarget[];
    notification: { title: string; body: string };
    data: Readonly<Record<string, string>>;
    androidChannel: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
  }): Promise<PushDeliveryResult> {
    if (input.devices.length === 0) {
      this.logger.warn(formatSafeLog({
        event: 'push.fcm_no_tokens',
        operation_id: input.operationId,
        profile_id: input.profileId,
      }));
      return { delivered: false, providerReference: null, errorCode: 'no_registered_devices', invalidDeviceIds: [] };
    }
    let messaging: FcmMessagingClient;
    try {
      messaging = this.resolveMessaging();
    } catch (error) {
      this.logger.error(formatSafeLog({
        event: 'push.fcm_init_error',
        operation_id: input.operationId,
        profile_id: input.profileId,
        error: error instanceof Error ? error.message : String(error),
      }));
      return { delivered: false, providerReference: null, errorCode: 'fcm_init_error', invalidDeviceIds: [] };
    }
    try {
      const response = await messaging.sendEachForMulticast({
        tokens: input.devices.map((device) => device.token),
        notification: { title: input.notification.title, body: input.notification.body },
        data: { ...input.data },
        android: {
          // FCM maps 'low'/'normal' to normal priority and 'high'/'critical' to
          // high; the notification channel is what actually drives sound and
          // vibration on Android 8+, so both are set.
          priority: input.priority === 'high' || input.priority === 'critical' ? 'high' : 'normal',
          notification: { channel_id: input.androidChannel },
        },
      });
      const reference = response.responses.find((r) => r.success)?.messageId ?? null;
      const allFailed = response.successCount === 0;
      const invalidDeviceIds: string[] = [];
      input.devices.forEach((device, index) => {
        const result = response.responses[index];
        if (result === undefined || result.success) return;
        const marker = `${result.error?.code ?? ''} ${result.error?.message ?? ''}`;
        if (PERMANENT_TOKEN_ERRORS.some((permanent) => marker.includes(permanent))) {
          invalidDeviceIds.push(device.pushDeviceId);
        }
      });
      this.logger.log(formatSafeLog({
        event: 'push.fcm_delivered',
        operation_id: input.operationId,
        profile_id: input.profileId,
        success_count: response.successCount,
        failure_count: response.failureCount,
        invalid_token_count: invalidDeviceIds.length,
      }));
      return {
        delivered: !allFailed,
        providerReference: reference,
        errorCode: allFailed ? 'fcm_all_failed' : null,
        invalidDeviceIds,
      };
    } catch (error) {
      this.logger.error(formatSafeLog({
        event: 'push.fcm_send_error',
        operation_id: input.operationId,
        profile_id: input.profileId,
        error: error instanceof Error ? error.message : String(error),
      }));
      return { delivered: false, providerReference: null, errorCode: 'fcm_send_error', invalidDeviceIds: [] };
    }
  }

  /**
   * Returns the messaging client, building it once from `firebase-admin`. The
   * first call initialises the admin app; subsequent calls reuse the cached
   * client so a long-running worker does not re-create credentials per send.
   */
  private resolveMessaging(): FcmMessagingClient {
    if (this.clientOverride !== undefined) return this.clientOverride;
    if (this.messaging !== undefined) return this.messaging;
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: this.config.projectId,
          clientEmail: this.config.clientEmail,
          privateKey: this.config.privateKey,
        }),
      });
    }
    this.messaging = getMessaging() as unknown as FcmMessagingClient;
    return this.messaging;
  }
}
