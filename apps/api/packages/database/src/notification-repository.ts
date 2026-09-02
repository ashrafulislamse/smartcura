import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  NOTIFICATION_PUSH_REQUESTED_EVENT_TYPE,
  NOTIFICATION_PUSH_REQUESTED_EVENT_VERSION,
  NOTIFICATION_EMAIL_REQUESTED_EVENT_TYPE,
  NOTIFICATION_EMAIL_REQUESTED_EVENT_VERSION,
} from './consultation-events.js';

export const NOTIFICATION_CATEGORIES = [
  'account_security', 'appointments', 'consultations', 'messages', 'prescriptions',
  'vitals_alerts', 'ai_review', 'delivery', 'dispatch', 'emergency', 'system',
  'vitals_update',
] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];
export type NotificationDeliveryState = 'queued' | 'processing' | 'delivered' | 'failed' | 'suppressed';
export type NotificationPriorityLevel = 'low' | 'normal' | 'high' | 'critical';

export interface NotificationRecord {
  readonly notificationId: string;
  readonly profileId: string;
  readonly category: NotificationCategory;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly titleCode: string;
  readonly bodyCode: string;
  readonly priority: NotificationPriorityLevel;
  readonly expiresAt: Date | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}
interface NotificationRow extends QueryResultRow, NotificationRecord {}
export interface NotificationPreference {
  readonly category: NotificationCategory;
  readonly channel: 'in_app' | 'push' | 'email';
  readonly enabled: boolean;
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
  readonly timezone: string;
}
interface PreferenceRow extends QueryResultRow, NotificationPreference {}
interface DeliveryRow extends QueryResultRow {
  readonly deliveryId: string;
  readonly notificationId: string;
  readonly profileId: string;
  readonly category: NotificationCategory;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly titleCode: string;
  readonly bodyCode: string;
  readonly priority: NotificationPriorityLevel;
  readonly status: NotificationDeliveryState;
}

export function serializeNotification(record: NotificationRecord): Record<string, unknown> {
  return {
    notification_id: record.notificationId,
    category: record.category,
    resource_type: record.resourceType,
    resource_id: record.resourceId,
    title_code: record.titleCode,
    body_code: record.bodyCode,
    priority: record.priority,
    expires_at: record.expiresAt?.toISOString() ?? null,
    read_at: record.readAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
  };
}

const NOTIFICATION_COLUMNS = `notification_id AS "notificationId", profile_id AS "profileId", category,
  resource_type AS "resourceType", resource_id AS "resourceId",
  title_code AS "titleCode", body_code AS "bodyCode", priority,
  expires_at AS "expiresAt", read_at AS "readAt", created_at AS "createdAt"`;

export async function createNotification(
  client: PoolClient,
  input: {
    profileId: string; category: NotificationCategory; resourceType: string;
    resourceId: string; titleCode: string; bodyCode: string;
    priority?: NotificationPriorityLevel; expiresAt?: Date | null;
    correlationId: string; now: Date; mandatoryPush?: boolean; mandatoryEmail?: boolean;
  },
): Promise<string> {
  const created = await client.query<{ notificationId: string }>(
    `INSERT INTO notifications
     (profile_id,category,resource_type,resource_id,title_code,body_code,priority,expires_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING notification_id AS "notificationId"`,
    [input.profileId, input.category, input.resourceType, input.resourceId,
      input.titleCode, input.bodyCode, input.priority ?? 'normal', input.expiresAt ?? null, input.now],
  );
  const notificationId = created.rows[0]!.notificationId;
  await client.query(
    `INSERT INTO notification_deliveries
     (notification_id,channel,status,delivered_at,updated_at)
     VALUES ($1,'in_app','delivered',$2,$2)`,
    [notificationId, input.now],
  );
  const preference = (await client.query<{ enabled: boolean; availableAt: Date }>(
    `WITH preference AS (
       SELECT enabled, quiet_hours_start, quiet_hours_end, timezone
       FROM notification_preferences
       WHERE profile_id = $1 AND category = $2 AND channel = 'push'
     ), local_state AS (
       SELECT COALESCE(preference.enabled,true) AS enabled,
         preference.quiet_hours_start, preference.quiet_hours_end,
         COALESCE(preference.timezone,'Asia/Kuala_Lumpur') AS timezone,
         ($3::timestamptz AT TIME ZONE COALESCE(preference.timezone,'Asia/Kuala_Lumpur')) AS local_now
       FROM (SELECT 1) seed LEFT JOIN preference ON true
     )
     SELECT enabled,
       CASE WHEN quiet_hours_start IS NULL THEN $3::timestamptz
         WHEN quiet_hours_start < quiet_hours_end
           AND local_now::time >= quiet_hours_start AND local_now::time < quiet_hours_end
           THEN ((local_now::date + quiet_hours_end) AT TIME ZONE timezone)
         WHEN quiet_hours_start > quiet_hours_end
           AND (local_now::time >= quiet_hours_start OR local_now::time < quiet_hours_end)
           THEN (((local_now::date + CASE WHEN local_now::time >= quiet_hours_start THEN 1 ELSE 0 END) + quiet_hours_end) AT TIME ZONE timezone)
         ELSE $3::timestamptz END AS "availableAt"
     FROM local_state`,
    [input.profileId, input.category, input.now],
  )).rows[0]!;
  const enabled = input.mandatoryPush === true || preference.enabled;
  const push = await client.query<{ deliveryId: string }>(
    `INSERT INTO notification_deliveries (notification_id,channel,status,updated_at)
     VALUES ($1,'push',$2,$3) RETURNING delivery_id AS "deliveryId"`,
    [notificationId, enabled ? 'queued' : 'suppressed', input.now],
  );
  if (enabled) {
    await client.query(
      `INSERT INTO outbox_events
       (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
        payload,correlation_id,occurred_at,available_at)
       VALUES (uuidv7(),$1,$2,'notification_delivery',$3,0,$4::jsonb,$5,$6,$7)`,
      [NOTIFICATION_PUSH_REQUESTED_EVENT_TYPE, NOTIFICATION_PUSH_REQUESTED_EVENT_VERSION,
        push.rows[0]!.deliveryId,
        JSON.stringify({ delivery_id: push.rows[0]!.deliveryId }), input.correlationId, input.now,
        input.mandatoryPush === true ? input.now : preference.availableAt],
    );
  }

  // Email delivery channel. Off by default unless an `email` preference row opts in,
  // or the caller passes mandatoryEmail. The unique (notification, channel) index on
  // notification_deliveries guarantees one email row per notification. Quiet hours are
  // shared with push semantics because an email landing at 3am is the same disturbance.
  const emailPreference = (await client.query<{ enabled: boolean; availableAt: Date }>(
    `WITH preference AS (
       SELECT enabled, quiet_hours_start, quiet_hours_end, timezone
       FROM notification_preferences
       WHERE profile_id = $1 AND category = $2 AND channel = 'email'
     ), local_state AS (
       SELECT COALESCE(preference.enabled,false) AS enabled,
         preference.quiet_hours_start, preference.quiet_hours_end,
         COALESCE(preference.timezone,'Asia/Kuala_Lumpur') AS timezone,
         ($3::timestamptz AT TIME ZONE COALESCE(preference.timezone,'Asia/Kuala_Lumpur')) AS local_now
       FROM (SELECT 1) seed LEFT JOIN preference ON true
     )
     SELECT enabled,
       CASE WHEN quiet_hours_start IS NULL THEN $3::timestamptz
         WHEN quiet_hours_start < quiet_hours_end
           AND local_now::time >= quiet_hours_start AND local_now::time < quiet_hours_end
           THEN ((local_now::date + quiet_hours_end) AT TIME ZONE timezone)
         WHEN quiet_hours_start > quiet_hours_end
           AND (local_now::time >= quiet_hours_start OR local_now::time < quiet_hours_end)
           THEN (((local_now::date + CASE WHEN local_now::time >= quiet_hours_start THEN 1 ELSE 0 END) + quiet_hours_end) AT TIME ZONE timezone)
         ELSE $3::timestamptz END AS "availableAt"
     FROM local_state`,
    [input.profileId, input.category, input.now],
  )).rows[0]!;
  const emailEnabled = input.mandatoryEmail === true || emailPreference.enabled;
  const email = await client.query<{ deliveryId: string }>(
    `INSERT INTO notification_deliveries (notification_id,channel,status,updated_at)
     VALUES ($1,'email',$2,$3) RETURNING delivery_id AS "deliveryId"`,
    [notificationId, emailEnabled ? 'queued' : 'suppressed', input.now],
  );
  if (emailEnabled) {
    await client.query(
      `INSERT INTO outbox_events
       (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
        payload,correlation_id,occurred_at,available_at)
       VALUES (uuidv7(),$1,$2,'notification_delivery',$3,0,$4::jsonb,$5,$6,$7)`,
      [NOTIFICATION_EMAIL_REQUESTED_EVENT_TYPE, NOTIFICATION_EMAIL_REQUESTED_EVENT_VERSION,
        email.rows[0]!.deliveryId,
        JSON.stringify({ delivery_id: email.rows[0]!.deliveryId }), input.correlationId, input.now,
        input.mandatoryEmail === true ? input.now : emailPreference.availableAt],
    );
  }

  return notificationId;
}

export class NotificationRepository {
  constructor(private readonly database: PostgresConnection) {}

  async registerPushDevice(input: {
    profileId: string; platform: 'android' | 'ios' | 'web'; tokenCiphertext: string;
    tokenHash: string; now: Date;
  }): Promise<{ pushDeviceId: string; platform: string; enabled: boolean }> {
    return (await this.database.query<{ pushDeviceId: string; platform: string; enabled: boolean }>(
      `INSERT INTO push_devices
       (profile_id,platform,token_ciphertext,token_hash,enabled,last_seen_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,true,$5,$5,$5)
       ON CONFLICT (token_hash) DO UPDATE SET
         profile_id = EXCLUDED.profile_id, platform = EXCLUDED.platform,
         token_ciphertext = EXCLUDED.token_ciphertext, enabled = true,
         last_seen_at = EXCLUDED.last_seen_at, updated_at = EXCLUDED.updated_at
       RETURNING push_device_id AS "pushDeviceId", platform, enabled`,
      [input.profileId, input.platform, input.tokenCiphertext, input.tokenHash, input.now],
    )).rows[0]!;
  }

  async disablePushDevice(
    pushDeviceId: string, profileId: string, now: Date,
  ): Promise<{ pushDeviceId: string; platform: string; enabled: boolean } | undefined> {
    return (await this.database.query<{ pushDeviceId: string; platform: string; enabled: boolean }>(
      `UPDATE push_devices SET enabled = false, updated_at = $3
       WHERE push_device_id = $1 AND profile_id = $2
       RETURNING push_device_id AS "pushDeviceId", platform, enabled`,
      [pushDeviceId, profileId, now],
    )).rows[0];
  }

  /**
   * Returns every enabled push device row for the given profile, including the
   * sealed FCM token. The caller (the worker's push handler) opens the token
   * with `PushTokenCipher.open()` immediately before sending and never logs or
   * persists the plaintext. The unique `(profile_id, enabled, push_device_id)`
   * index makes this a bounded scan; the result is small (one device per token).
   */
  async listEnabledPushDevices(profileId: string): Promise<PushDeviceRecord[]> {
    return (await this.database.query<PushDeviceRow>(
      `SELECT push_device_id AS "pushDeviceId", platform,
         token_ciphertext AS "tokenCiphertext", enabled
       FROM push_devices
       WHERE profile_id = $1 AND enabled = true
       ORDER BY push_device_id`,
      [profileId],
    )).rows;
  }

  async list(input: {
    profileId: string; beforeCreatedAt?: Date; beforeId?: string; limit: number;
    category?: NotificationCategory; unread?: boolean;
  }): Promise<NotificationRecord[]> {
    return (await this.database.query<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS}
       FROM notifications WHERE profile_id = $1
         AND ($2::timestamptz IS NULL OR (created_at,notification_id) < ($2,$3))
         AND ($4::notification_category IS NULL OR category = $4)
         AND ($5::boolean IS NULL OR (read_at IS NULL) = $5)
       ORDER BY created_at DESC, notification_id DESC LIMIT $6`,
      [input.profileId, input.beforeCreatedAt ?? null, input.beforeId ?? null,
        input.category ?? null, input.unread ?? null, input.limit],
    )).rows;
  }

  async markRead(notificationId: string, profileId: string, now: Date): Promise<NotificationRecord | undefined> {
    return (await this.database.query<NotificationRow>(
      `UPDATE notifications SET read_at = COALESCE(read_at,$3)
       WHERE notification_id = $1 AND profile_id = $2
       RETURNING ${NOTIFICATION_COLUMNS}`,
      [notificationId, profileId, now],
    )).rows[0];
  }

  /**
   * Marks every unread notification of the profile as read. Scoped by profile_id in
   * the WHERE clause exactly like markRead, so one account can never touch another's
   * rows. Returns the number of rows that actually transitioned.
   */
  async markAllRead(profileId: string, now: Date): Promise<number> {
    const result = await this.database.query(
      `UPDATE notifications SET read_at = $2
       WHERE profile_id = $1 AND read_at IS NULL`,
      [profileId, now],
    );
    return result.rowCount ?? 0;
  }

  async listPreferences(profileId: string): Promise<NotificationPreference[]> {
    return (await this.database.query<PreferenceRow>(
      `SELECT category, channel, enabled, quiet_hours_start::text AS "quietHoursStart",
         quiet_hours_end::text AS "quietHoursEnd", timezone
       FROM notification_preferences WHERE profile_id = $1 ORDER BY category, channel`,
      [profileId],
    )).rows;
  }

  async savePreference(input: {
    profileId: string; category: NotificationCategory; channel: 'in_app' | 'push' | 'email';
    enabled: boolean; quietHoursStart: string | null; quietHoursEnd: string | null;
    timezone: string; now: Date;
  }): Promise<NotificationPreference | 'in_app_required'> {
    if (input.channel === 'in_app' && !input.enabled) return 'in_app_required';
    return (await this.database.query<PreferenceRow>(
      `INSERT INTO notification_preferences
       (profile_id,category,channel,enabled,quiet_hours_start,quiet_hours_end,timezone,updated_at)
       VALUES ($1,$2,$3,$4,$5::time,$6::time,$7,$8)
       ON CONFLICT (profile_id,category,channel) DO UPDATE SET
         enabled = EXCLUDED.enabled, quiet_hours_start = EXCLUDED.quiet_hours_start,
         quiet_hours_end = EXCLUDED.quiet_hours_end, timezone = EXCLUDED.timezone,
         updated_at = EXCLUDED.updated_at
       RETURNING category,channel,enabled,quiet_hours_start::text AS "quietHoursStart",
         quiet_hours_end::text AS "quietHoursEnd",timezone`,
      [input.profileId, input.category, input.channel, input.enabled,
        input.quietHoursStart, input.quietHoursEnd, input.timezone, input.now],
    )).rows[0]!;
  }

  /**
   * Disables the given push devices by id, regardless of owner — used only by the
   * worker after FCM reports a token permanently invalid (UNREGISTERED et al). The
   * ids come from the worker's own device resolution, never from a request.
   */
  async disablePushDevices(pushDeviceIds: readonly string[], now: Date): Promise<number> {
    if (pushDeviceIds.length === 0) return 0;
    const result = await this.database.query(
      `UPDATE push_devices SET enabled = false, updated_at = $2
       WHERE push_device_id = ANY($1::uuid[]) AND enabled = true`,
      [pushDeviceIds, now],
    );
    return result.rowCount ?? 0;
  }

  async loadPushWork(deliveryId: string): Promise<DeliveryRow | undefined> {
    return (await this.database.query<DeliveryRow>(
      `SELECT delivery.delivery_id AS "deliveryId", delivery.notification_id AS "notificationId",
         notification.profile_id AS "profileId", notification.category,
         notification.resource_type AS "resourceType", notification.resource_id AS "resourceId",
         notification.title_code AS "titleCode", notification.body_code AS "bodyCode",
         notification.priority, delivery.status
       FROM notification_deliveries delivery
       JOIN notifications notification ON notification.notification_id = delivery.notification_id
       WHERE delivery.delivery_id = $1 AND delivery.channel = 'push' AND delivery.status = 'queued'`,
      [deliveryId],
    )).rows[0];
  }

  /**
   * Settles a push delivery as suppressed — a terminal state meaning "sending this
   * was deliberately not attempted". Used when the recipient has no registered
   * device: that is a data gap the outbox must not retry, and 'failed' would
   * misreport it as a provider error.
   */
  async suppressPush(deliveryId: string, now: Date): Promise<'settled' | 'terminal' | 'not_found'> {
    return this.database.transaction(async (client) => {
      const row = (await client.query<{ status: NotificationDeliveryState }>(
        `SELECT status FROM notification_deliveries
         WHERE delivery_id = $1 AND channel = 'push' FOR UPDATE`, [deliveryId],
      )).rows[0];
      if (row === undefined) return 'not_found';
      if (['delivered', 'suppressed'].includes(row.status)) return 'terminal';
      await client.query(
        `UPDATE notification_deliveries SET status = 'suppressed',
           attempts = attempts + 1, updated_at = $2
         WHERE delivery_id = $1`,
        [deliveryId, now],
      );
      return 'settled';
    });
  }

  async settlePush(input: {
    deliveryId: string; delivered: boolean; providerReference: string | null;
    errorCode: string | null; now: Date;
  }): Promise<'settled' | 'terminal' | 'not_found'> {
    return this.database.transaction(async (client) => {
      const row = (await client.query<{ status: NotificationDeliveryState }>(
        `SELECT status FROM notification_deliveries
         WHERE delivery_id = $1 AND channel = 'push' FOR UPDATE`, [input.deliveryId],
      )).rows[0];
      if (row === undefined) return 'not_found';
      if (['delivered', 'suppressed'].includes(row.status)) return 'terminal';
      await client.query(
        `UPDATE notification_deliveries SET status = $2,
           provider_reference = $3, last_error_code = $4, attempts = attempts + 1,
           delivered_at = $6, updated_at = $5
         WHERE delivery_id = $1`,
        [input.deliveryId, input.delivered ? 'delivered' : 'failed',
          input.providerReference, input.errorCode, input.now,
          input.delivered ? input.now : null],
      );
      return 'settled';
    });
  }

  /**
   * Loads the delivery row plus the recipient's email and display name for an email
   * channel delivery. The recipient's contact details live on `profiles`, not on the
   * notification, so the email handler resolves them here rather than carrying them on
   * the outbox payload (which must stay minimum-data, as the push channel does).
   *
   * When the resource is an appointment or a pharmacy order, the live row is joined so
   * the email states the REAL date, doctor, mode, or order status instead of a
   * placeholder. The joins are filtered by resource_type so they stay no-ops for every
   * other notification.
   */
  async loadEmailWork(deliveryId: string): Promise<EmailWorkRow | undefined> {
    return (await this.database.query<EmailWorkRow>(
      `SELECT delivery.delivery_id AS "deliveryId", delivery.notification_id AS "notificationId",
         notification.profile_id AS "profileId", notification.category,
         notification.resource_type AS "resourceType", notification.resource_id AS "resourceId",
         notification.title_code AS "titleCode", notification.body_code AS "bodyCode",
         notification.created_at AS "createdAt",
         delivery.status, profile.email, profile.display_name AS "displayName",
         doctor_profile.display_name AS "appointmentDoctorName",
         slot.starts_at AS "appointmentStartsAt",
         appointment.mode AS "appointmentMode",
         pharmacy_order.status::text AS "pharmacyOrderStatus",
         (SELECT count(*)::int FROM pharmacy_order_items item
           WHERE item.pharmacy_order_id = pharmacy_order.pharmacy_order_id) AS "pharmacyItemCount"
       FROM notification_deliveries delivery
       JOIN notifications notification ON notification.notification_id = delivery.notification_id
       JOIN profiles profile ON profile.profile_id = notification.profile_id
       LEFT JOIN appointments appointment
         ON notification.resource_type = 'appointment'
        AND appointment.appointment_id = notification.resource_id
       LEFT JOIN appointment_slots slot ON slot.slot_id = appointment.slot_id
       LEFT JOIN organization_memberships doctor_membership
         ON doctor_membership.membership_id = appointment.doctor_membership_id
       LEFT JOIN profiles doctor_profile ON doctor_profile.profile_id = doctor_membership.profile_id
       LEFT JOIN pharmacy_orders pharmacy_order
         ON notification.resource_type = 'pharmacy_order'
        AND pharmacy_order.pharmacy_order_id = notification.resource_id
       WHERE delivery.delivery_id = $1 AND delivery.channel = 'email' AND delivery.status = 'queued'`,
      [deliveryId],
    )).rows[0];
  }

  async settleEmail(input: {
    deliveryId: string; delivered: boolean; providerReference: string | null;
    errorCode: string | null; now: Date;
  }): Promise<'settled' | 'terminal' | 'not_found'> {
    return this.database.transaction(async (client) => {
      const row = (await client.query<{ status: NotificationDeliveryState }>(
        `SELECT status FROM notification_deliveries
         WHERE delivery_id = $1 AND channel = 'email' FOR UPDATE`, [input.deliveryId],
      )).rows[0];
      if (row === undefined) return 'not_found';
      if (['delivered', 'suppressed'].includes(row.status)) return 'terminal';
      await client.query(
        `UPDATE notification_deliveries SET status = $2,
           provider_reference = $3, last_error_code = $4, attempts = attempts + 1,
           delivered_at = $6, updated_at = $5
         WHERE delivery_id = $1`,
        [input.deliveryId, input.delivered ? 'delivered' : 'failed',
          input.providerReference, input.errorCode, input.now,
          input.delivered ? input.now : null],
      );
      return 'settled';
    });
  }
}

export interface EmailWorkRow extends QueryResultRow {
  readonly deliveryId: string;
  readonly notificationId: string;
  readonly profileId: string;
  readonly category: NotificationCategory;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly titleCode: string;
  readonly bodyCode: string;
  readonly createdAt: Date;
  readonly status: NotificationDeliveryState;
  readonly email: string;
  readonly displayName: string;
  /** Present only when resource_type = 'appointment'. */
  readonly appointmentDoctorName: string | null;
  readonly appointmentStartsAt: Date | null;
  readonly appointmentMode: string | null;
  /** Present only when resource_type = 'pharmacy_order'. */
  readonly pharmacyOrderStatus: string | null;
  readonly pharmacyItemCount: number | null;
}

/**
 * A push device row as read from `push_devices` for delivery. The token stays
 * sealed (`tokenCiphertext`); the worker opens it with `PushTokenCipher.open()`.
 */
export interface PushDeviceRecord {
  readonly pushDeviceId: string;
  readonly platform: 'android' | 'ios' | 'web';
  readonly tokenCiphertext: string;
  readonly enabled: boolean;
}
interface PushDeviceRow extends QueryResultRow, PushDeviceRecord {}
