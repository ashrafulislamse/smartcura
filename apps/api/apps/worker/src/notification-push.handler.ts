import { Logger } from '@nestjs/common';
import { formatSafeLog } from '@smartcura/observability';
import { PushTokenCipher } from '@smartcura/database';
import type { NotificationRepository } from '@smartcura/database/consultations';
import { renderNotificationCopy } from './notification-copy.js';

/** One addressed device: the worker resolves the id and opens the sealed token. */
export interface PushTarget {
  readonly pushDeviceId: string;
  readonly token: string;
}

export interface PushDeliveryProvider {
  send(input: {
    operationId: string;
    profileId: string;
    devices: readonly PushTarget[];
    notification: { title: string; body: string };
    data: Readonly<Record<string, string>>;
    androidChannel: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
  }): Promise<PushDeliveryResult>;
}

export interface PushDeliveryResult {
  readonly delivered: boolean;
  readonly providerReference: string | null;
  readonly errorCode: string | null;
  /**
   * Device ids FCM reported as permanently invalid (UNREGISTERED and friends).
   * The handler disables them so a rotting token can never be addressed again;
   * a transient per-device failure must NOT appear here.
   */
  readonly invalidDeviceIds: readonly string[];
}

/**
 * Deterministic stub. Logs the push and reports success without sending
 * anything, mirroring `DeterministicEmailDeliveryProvider`. Allowed in
 * production for the FYP demo with a warning log at boot (see
 * `selectPushProvider` in worker.module.ts).
 */
export class DeterministicPushDeliveryProvider implements PushDeliveryProvider {
  private readonly logger = new Logger(DeterministicPushDeliveryProvider.name);

  async send(input: {
    operationId: string; profileId: string; devices: readonly PushTarget[];
    notification: { title: string; body: string };
    data: Readonly<Record<string, string>>; androidChannel: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
  }) {
    this.logger.log(formatSafeLog({
      event: 'push.deterministic_send',
      operation_id: input.operationId,
      profile_id: input.profileId,
      device_count: input.devices.length,
    }));
    return {
      delivered: true,
      providerReference: `deterministic:${input.operationId}`,
      errorCode: null,
      invalidDeviceIds: [],
    } satisfies PushDeliveryResult;
  }
}

/**
 * Drives the push delivery channel for a queued notification.
 *
 * The outbox processor hands this handler a push delivery id. The handler loads
 * the delivery work row, renders the user-facing copy through the server-side
 * catalogue (`notification-copy.ts`), resolves every enabled push device the
 * recipient has registered, opens the sealed FCM tokens with `PushTokenCipher`,
 * and hands typed targets to the delivery provider. The provider's result is
 * settled back onto the delivery row so the outbox retry policy can act on a
 * failure, and any device FCM reported permanently invalid is disabled so it is
 * never addressed again.
 *
 * A profile with no registered device is settled as SUPPRESSED — a terminal
 * state — because a missing device is a data gap, not a transient provider
 * error, and 'failed' would make the outbox retry a permanent condition.
 */
export class NotificationPushHandler {
  private readonly logger = new Logger(NotificationPushHandler.name);

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly provider: PushDeliveryProvider,
    private readonly pushTokens: PushTokenCipher,
  ) {}

  async handle(deliveryId: string): Promise<boolean> {
    const work = await this.notifications.loadPushWork(deliveryId);
    if (work === undefined || work.status === 'delivered' || work.status === 'suppressed') return true;

    const devices = await this.notifications.listEnabledPushDevices(work.profileId);
    if (devices.length === 0) {
      this.logger.log(formatSafeLog({
        event: 'push.no_registered_devices',
        delivery_id: deliveryId,
        profile_id: work.profileId,
      }));
      const settled = await this.notifications.suppressPush(deliveryId, new Date());
      return settled !== 'not_found';
    }

    // Resolve the recipient's enabled push devices and open the sealed tokens.
    // Plaintext tokens exist only inside this loop and the provider call; they
    // are never logged and never persisted.
    const targets: PushTarget[] = [];
    try {
      for (const device of devices) {
        targets.push({ pushDeviceId: device.pushDeviceId, token: this.pushTokens.open(device.tokenCiphertext) });
      }
    } catch (error) {
      this.logger.error(formatSafeLog({
        event: 'push.token_decrypt_error',
        delivery_id: deliveryId,
        profile_id: work.profileId,
        error: error instanceof Error ? error.message : String(error),
      }));
      const settled = await this.notifications.settlePush({
        deliveryId: work.deliveryId,
        delivered: false,
        providerReference: null,
        errorCode: 'token_decrypt_error',
        now: new Date(),
      });
      return settled !== 'not_found';
    }

    const copy = renderNotificationCopy(work);
    const result = await this.provider.send({
      operationId: work.deliveryId,
      profileId: work.profileId,
      devices: targets,
      notification: { title: copy.title, body: copy.body },
      data: {
        notification_id: work.notificationId,
        resource_type: work.resourceType,
        resource_id: work.resourceId,
        deep_link: copy.deepLink,
        priority: copy.priority,
        title_code: work.titleCode,
      },
      androidChannel: copy.androidChannel,
      priority: copy.priority,
    });

    if (result.invalidDeviceIds.length > 0) {
      const pruned = await this.notifications.disablePushDevices(result.invalidDeviceIds, new Date());
      this.logger.log(formatSafeLog({
        event: 'push.invalid_tokens_pruned',
        delivery_id: deliveryId,
        profile_id: work.profileId,
        pruned,
      }));
    }

    // Successful delivery: settle as delivered (terminal) so the outbox consumes the event.
    if (result.delivered) {
      const settled = await this.notifications.settlePush({
        deliveryId: work.deliveryId,
        delivered: true,
        providerReference: result.providerReference,
        errorCode: result.errorCode,
        now: new Date(),
      });
      return settled !== 'not_found';
    }

    // Delivery failed. Distinguish permanent from transient: a permanent failure
    // is settled as 'failed' (terminal) so the outbox consumes the event; a
    // transient failure is left 'queued' and returns false so the outbox retries
    // the event on the next poll cycle.
    const permanentPushErrorCodes = new Set(['no_devices', 'token_decrypt_error', 'no_registered_devices', 'fcm_init_error']);
    if (result.errorCode !== null && permanentPushErrorCodes.has(result.errorCode)) {
      const settled = await this.notifications.settlePush({
        deliveryId: work.deliveryId,
        delivered: false,
        providerReference: result.providerReference,
        errorCode: result.errorCode,
        now: new Date(),
      });
      return settled !== 'not_found';
    }

    // Transient failure (fcm_send_error, fcm_all_failed, etc.): do not settle.
    // The delivery stays 'queued' and the outbox will re-claim the event on the
    // next poll cycle for retry.
    this.logger.warn(formatSafeLog({
      event: 'push.transient_failure',
      delivery_id: deliveryId,
      profile_id: work.profileId,
      error_code: result.errorCode,
    }));
    return false;
  }
}
