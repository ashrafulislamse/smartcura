import type { PoolClient } from 'pg';
import { PostgresConnection } from './connection.js';
import { createNotification, type NotificationCategory } from './notification-repository.js';
import { BROADCAST_DISPATCH_REQUESTED_EVENT_TYPE, BROADCAST_DISPATCH_REQUESTED_EVENT_VERSION } from './stage11-events.js';

export type PublishState = 'draft' | 'published' | 'archived';
export type BroadcastAudience = 'all' | 'patients' | 'staff';
export type BroadcastStatus = 'draft' | 'scheduled' | 'dispatching' | 'sent' | 'cancelled';
export type BaseRole = 'patient' | 'doctor' | 'driver' | 'pharmacy' | 'emergency' | 'admin';
export interface FaqRecord { faqEntryId: string; slug: string; question: string; answer: string; publishState: PublishState; publishedAt: Date | null; version: number; updatedAt: Date }
export interface TemplateRecord { notificationTemplateId: string; templateKey: string; category: NotificationCategory; activeVersion: number | null; updatedAt: Date }
export interface TemplateVersionRecord { notificationTemplateVersionId: string; version: number; titleTemplate: string; bodyTemplate: string; createdAt: Date }
export interface BroadcastRecord { broadcastMessageId: string; templateVersionId: string; audience: BroadcastAudience; status: BroadcastStatus; scheduledAt: Date | null; dispatchedAt: Date | null; version: number; createdAt: Date }
export interface CustomRoleRecord { customRoleId: string; roleKey: string; displayName: string; baseRoleId: BaseRole; active: boolean; permissions: string[]; version: number; updatedAt: Date }
export interface PermissionRecord { permissionId: string; description: string | null }

export class Stage11Repository {
  constructor(private readonly database: PostgresConnection) {}

  async listFaqs(organizationId: string, publishedOnly: boolean): Promise<FaqRecord[]> {
    return (await this.database.query<FaqRecord>(
      `SELECT faq_entry_id AS "faqEntryId", slug, question, answer, publish_state AS "publishState",
       published_at AS "publishedAt", version, updated_at AS "updatedAt"
       FROM faq_entries WHERE organization_id = $1 AND ($2 = false OR publish_state = 'published')
       ORDER BY slug`, [organizationId, publishedOnly],
    )).rows;
  }

  async findFaq(organizationId: string, faqEntryId: string): Promise<FaqRecord | null> {
    return (await this.database.query<FaqRecord>(
      `SELECT faq_entry_id AS "faqEntryId", slug, question, answer, publish_state AS "publishState",
       published_at AS "publishedAt", version, updated_at AS "updatedAt"
       FROM faq_entries WHERE organization_id = $1 AND faq_entry_id = $2`,
      [organizationId, faqEntryId],
    )).rows[0] ?? null;
  }

  async createFaq(input: { organizationId: string; slug: string; question: string; answer: string; membershipId: string }): Promise<FaqRecord | 'duplicate'> {
    try {
      return (await this.database.query<FaqRecord>(
        `INSERT INTO faq_entries(organization_id,slug,question,answer,created_by_membership_id,updated_by_membership_id)
         VALUES($1,$2,$3,$4,$5,$5) RETURNING faq_entry_id AS "faqEntryId", slug, question, answer,
         publish_state AS "publishState", published_at AS "publishedAt", version, updated_at AS "updatedAt"`,
        [input.organizationId, input.slug, input.question, input.answer, input.membershipId],
      )).rows[0]!;
    } catch (error) { if (code(error) === '23505') return 'duplicate'; throw error; }
  }

  async updateFaq(input: { organizationId: string; faqEntryId: string; slug: string; question: string; answer: string; membershipId: string; expectedVersion: number }): Promise<FaqRecord | null | 'duplicate'> {
    try {
      return (await this.database.query<FaqRecord>(
        `UPDATE faq_entries SET slug=$3, question=$4, answer=$5, updated_by_membership_id=$6,
         version=version+1, updated_at=now() WHERE faq_entry_id=$1 AND organization_id=$2 AND version=$7
         RETURNING faq_entry_id AS "faqEntryId", slug, question, answer, publish_state AS "publishState",
         published_at AS "publishedAt", version, updated_at AS "updatedAt"`,
        [input.faqEntryId, input.organizationId, input.slug, input.question, input.answer, input.membershipId, input.expectedVersion],
      )).rows[0] ?? null;
    } catch (error) { if (code(error) === '23505') return 'duplicate'; throw error; }
  }

  async setFaqState(input: { organizationId: string; faqEntryId: string; state: PublishState; membershipId: string; expectedVersion: number }): Promise<FaqRecord | null> {
    return (await this.database.query<FaqRecord>(
      `UPDATE faq_entries SET publish_state=$3::content_publish_state,
       published_at=CASE WHEN $3='published' THEN COALESCE(published_at,now()) ELSE NULL END,
       updated_by_membership_id=$4, version=version+1, updated_at=now()
       WHERE faq_entry_id=$1 AND organization_id=$2 AND version=$5
       RETURNING faq_entry_id AS "faqEntryId", slug, question, answer, publish_state AS "publishState",
       published_at AS "publishedAt", version, updated_at AS "updatedAt"`,
      [input.faqEntryId, input.organizationId, input.state, input.membershipId, input.expectedVersion],
    )).rows[0] ?? null;
  }

  async listTemplates(organizationId: string): Promise<TemplateRecord[]> {
    return (await this.database.query<TemplateRecord>(
      `SELECT notification_template_id AS "notificationTemplateId", template_key AS "templateKey",
       category, active_version AS "activeVersion", updated_at AS "updatedAt"
       FROM notification_templates WHERE organization_id=$1 ORDER BY template_key`, [organizationId],
    )).rows;
  }

  async createTemplate(input: { organizationId: string; templateKey: string; category: NotificationCategory; title: string; body: string; membershipId: string }): Promise<TemplateRecord | 'duplicate'> {
    try {
      return await this.database.transaction(async (client) => {
        const template = (await client.query<TemplateRecord>(
          `INSERT INTO notification_templates(organization_id,template_key,category,active_version,created_by_membership_id)
           VALUES($1,$2,$3::notification_category,1,$4)
           RETURNING notification_template_id AS "notificationTemplateId", template_key AS "templateKey",
           category, active_version AS "activeVersion", updated_at AS "updatedAt"`,
          [input.organizationId, input.templateKey, input.category, input.membershipId],
        )).rows[0]!;
        await client.query(
          `INSERT INTO notification_template_versions(notification_template_id,version,title_template,body_template,created_by_membership_id)
           VALUES($1,1,$2,$3,$4)`, [template.notificationTemplateId, input.title, input.body, input.membershipId],
        );
        return template;
      });
    } catch (error) { if (code(error) === '23505') return 'duplicate'; throw error; }
  }

  async addTemplateVersion(input: { organizationId: string; templateKey: string; title: string; body: string; membershipId: string }): Promise<TemplateVersionRecord | null> {
    return this.database.transaction(async (client) => {
      const template = (await client.query<{ notificationTemplateId: string; nextVersion: number }>(
        `SELECT notification_template_id AS "notificationTemplateId",
         COALESCE((SELECT max(version)+1 FROM notification_template_versions v WHERE v.notification_template_id=t.notification_template_id),1)::int AS "nextVersion"
         FROM notification_templates t WHERE organization_id=$1 AND template_key=$2 FOR UPDATE`,
        [input.organizationId, input.templateKey],
      )).rows[0];
      if (template === undefined) return null;
      return (await client.query<TemplateVersionRecord>(
        `INSERT INTO notification_template_versions(notification_template_id,version,title_template,body_template,created_by_membership_id)
         VALUES($1,$2,$3,$4,$5) RETURNING notification_template_version_id AS "notificationTemplateVersionId",
         version, title_template AS "titleTemplate", body_template AS "bodyTemplate", created_at AS "createdAt"`,
        [template.notificationTemplateId, template.nextVersion, input.title, input.body, input.membershipId],
      )).rows[0]!;
    });
  }

  async templateVersions(organizationId: string, templateKey: string): Promise<TemplateVersionRecord[]> {
    return (await this.database.query<TemplateVersionRecord>(
      `SELECT v.notification_template_version_id AS "notificationTemplateVersionId", v.version,
       v.title_template AS "titleTemplate", v.body_template AS "bodyTemplate", v.created_at AS "createdAt"
       FROM notification_template_versions v JOIN notification_templates t USING(notification_template_id)
       WHERE t.organization_id=$1 AND t.template_key=$2 ORDER BY v.version DESC`, [organizationId, templateKey],
    )).rows;
  }

  async activateTemplateVersion(input: { organizationId: string; templateKey: string; version: number }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE notification_templates t SET active_version=$3,updated_at=now()
       WHERE organization_id=$1 AND template_key=$2 AND EXISTS(
        SELECT 1 FROM notification_template_versions v WHERE v.notification_template_id=t.notification_template_id AND v.version=$3)`,
      [input.organizationId, input.templateKey, input.version],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async listBroadcasts(organizationId: string): Promise<BroadcastRecord[]> {
    return (await this.database.query<BroadcastRecord>(
      `SELECT broadcast_message_id AS "broadcastMessageId", notification_template_version_id AS "templateVersionId",
       audience,status,scheduled_at AS "scheduledAt",dispatched_at AS "dispatchedAt",version,created_at AS "createdAt"
       FROM broadcast_messages WHERE organization_id=$1 ORDER BY created_at DESC`, [organizationId],
    )).rows;
  }

  async createBroadcast(input: { organizationId: string; templateKey: string; templateVersion: number; audience: BroadcastAudience; membershipId: string }): Promise<BroadcastRecord | null> {
    return (await this.database.query<BroadcastRecord>(
      `INSERT INTO broadcast_messages(organization_id,notification_template_version_id,audience,created_by_membership_id)
       SELECT $1,v.notification_template_version_id,$4::broadcast_audience,$5
       FROM notification_templates t JOIN notification_template_versions v USING(notification_template_id)
       WHERE t.organization_id=$1 AND t.template_key=$2 AND v.version=$3
       RETURNING broadcast_message_id AS "broadcastMessageId", notification_template_version_id AS "templateVersionId",
       audience,status,scheduled_at AS "scheduledAt",dispatched_at AS "dispatchedAt",version,created_at AS "createdAt"`,
      [input.organizationId, input.templateKey, input.templateVersion, input.audience, input.membershipId],
    )).rows[0] ?? null;
  }

  async queueBroadcast(input: { organizationId: string; broadcastMessageId: string; scheduledAt: Date; expectedVersion: number; correlationId: string }): Promise<'queued' | 'conflict' | 'state'> {
    return this.database.transaction(async (client) => {
      const updated = await client.query<{ version: number }>(
        `UPDATE broadcast_messages SET status='scheduled',scheduled_at=$3,version=version+1,updated_at=now()
         WHERE broadcast_message_id=$1 AND organization_id=$2 AND version=$4 AND status IN('draft','scheduled')
         RETURNING version`, [input.broadcastMessageId, input.organizationId, input.scheduledAt, input.expectedVersion],
      );
      if (updated.rowCount !== 1) {
        const exists = await client.query('SELECT 1 FROM broadcast_messages WHERE broadcast_message_id=$1 AND organization_id=$2', [input.broadcastMessageId, input.organizationId]);
        return exists.rowCount === 1 ? 'conflict' : 'state';
      }
      await client.query(
        `INSERT INTO outbox_events(event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,payload,correlation_id,occurred_at,available_at)
         VALUES(uuidv7(),$1,$2,'broadcast_message',$3,$4,$5::jsonb,$6,now(),$7)`,
        [BROADCAST_DISPATCH_REQUESTED_EVENT_TYPE,BROADCAST_DISPATCH_REQUESTED_EVENT_VERSION,input.broadcastMessageId,updated.rows[0]!.version,
          JSON.stringify({ broadcast_message_id: input.broadcastMessageId }),input.correlationId,input.scheduledAt],
      );
      return 'queued';
    });
  }

  async dispatchBroadcast(broadcastMessageId: string, correlationId: string, now: Date): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const message = (await client.query<{ organizationId: string; audience: BroadcastAudience; status: BroadcastStatus; category: NotificationCategory }>(
        `SELECT b.organization_id AS "organizationId",b.audience,b.status,t.category
         FROM broadcast_messages b JOIN notification_template_versions v ON v.notification_template_version_id=b.notification_template_version_id
         JOIN notification_templates t ON t.notification_template_id=v.notification_template_id
         WHERE b.broadcast_message_id=$1 FOR UPDATE OF b`, [broadcastMessageId],
      )).rows[0];
      if (message === undefined) return false;
      if (message.status === 'sent') return true;
      if (message.status !== 'scheduled') return false;
      await client.query(`UPDATE broadcast_messages SET status='dispatching',updated_at=$2 WHERE broadcast_message_id=$1`, [broadcastMessageId, now]);
      const recipients = await client.query<{ profileId: string }>(
        `INSERT INTO broadcast_recipients(broadcast_message_id,profile_id)
         SELECT $1,m.profile_id FROM organization_memberships m JOIN profiles p ON p.profile_id=m.profile_id
         WHERE m.organization_id=$2 AND m.status='active' AND p.status='active'
          AND ($3='all' OR ($3='patients' AND m.role_id='patient') OR ($3='staff' AND m.role_id<>'patient'))
         ON CONFLICT DO NOTHING RETURNING profile_id AS "profileId"`, [broadcastMessageId,message.organizationId,message.audience],
      );
      for (const recipient of recipients.rows) {
        const notificationId = await createNotification(client, {
          profileId: recipient.profileId, category: message.category, resourceType: 'broadcast_message', resourceId: broadcastMessageId,
          titleCode: `broadcast.${broadcastMessageId}.title`, bodyCode: `broadcast.${broadcastMessageId}.body`, correlationId, now,
        });
        await client.query(`UPDATE broadcast_recipients SET notification_id=$3 WHERE broadcast_message_id=$1 AND profile_id=$2`, [broadcastMessageId,recipient.profileId,notificationId]);
      }
      await client.query(`UPDATE broadcast_messages SET status='sent',dispatched_at=$2,version=version+1,updated_at=$2 WHERE broadcast_message_id=$1`, [broadcastMessageId,now]);
      return true;
    });
  }

  async listCustomRoles(organizationId: string): Promise<CustomRoleRecord[]> {
    const rows = await this.database.query<CustomRoleRecord>(
      `SELECT r.custom_role_id AS "customRoleId",r.role_key AS "roleKey",r.display_name AS "displayName",
       r.base_role_id AS "baseRoleId",r.active,r.version,r.updated_at AS "updatedAt",
       ARRAY(SELECT permission_id FROM custom_role_permissions p WHERE p.custom_role_id=r.custom_role_id ORDER BY permission_id) AS permissions
       FROM custom_roles r WHERE organization_id=$1 ORDER BY role_key`, [organizationId],
    );
    return rows.rows;
  }

  async createCustomRole(input: { organizationId: string; roleKey: string; displayName: string; baseRoleId: BaseRole; membershipId: string }): Promise<CustomRoleRecord | 'duplicate'> {
    try {
      return (await this.database.query<CustomRoleRecord>(
        `INSERT INTO custom_roles(organization_id,role_key,display_name,base_role_id,created_by_membership_id,updated_by_membership_id)
         VALUES($1,$2,$3,$4,$5,$5) RETURNING custom_role_id AS "customRoleId",role_key AS "roleKey",display_name AS "displayName",
         base_role_id AS "baseRoleId",active,ARRAY[]::text[] AS permissions,version,updated_at AS "updatedAt"`,
        [input.organizationId,input.roleKey,input.displayName,input.baseRoleId,input.membershipId],
      )).rows[0]!;
    } catch (error) { if (code(error) === '23505') return 'duplicate'; throw error; }
  }

  async updateCustomRole(input: { organizationId: string; customRoleId: string; displayName: string; active: boolean; membershipId: string; expectedVersion: number }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE custom_roles SET display_name=$3,active=$4,updated_by_membership_id=$5,version=version+1,updated_at=now()
       WHERE custom_role_id=$1 AND organization_id=$2 AND version=$6`,
      [input.customRoleId,input.organizationId,input.displayName,input.active,input.membershipId,input.expectedVersion],
    );
    return result.rowCount === 1;
  }

  async replaceCustomRolePermissions(input: { organizationId: string; customRoleId: string; permissionIds: string[]; membershipId: string; expectedVersion: number }): Promise<'updated' | 'not_found' | 'invalid_permission' | 'conflict'> {
    return this.database.transaction(async (client) => {
      const role = (await client.query<{ version: number }>(`SELECT version FROM custom_roles WHERE custom_role_id=$1 AND organization_id=$2 FOR UPDATE`, [input.customRoleId,input.organizationId])).rows[0];
      if (role === undefined) return 'not_found';
      if (role.version !== input.expectedVersion) return 'conflict';
      const allowed = await client.query<{ permissionId: string }>(
        `SELECT permission_id AS "permissionId" FROM permissions WHERE permission_id=ANY($1::text[]) AND permission_id !~ '(^|:)global$' AND permission_id !~ '\\*'`, [input.permissionIds],
      );
      if (allowed.rows.length !== input.permissionIds.length) return 'invalid_permission';
      await client.query(`DELETE FROM custom_role_permissions WHERE custom_role_id=$1`, [input.customRoleId]);
      for (const permissionId of input.permissionIds) await client.query(
        `INSERT INTO custom_role_permissions(custom_role_id,permission_id,created_by_membership_id) VALUES($1,$2,$3)`, [input.customRoleId,permissionId,input.membershipId],
      );
      await client.query(`UPDATE custom_roles SET version=version+1,updated_by_membership_id=$2,updated_at=now() WHERE custom_role_id=$1`, [input.customRoleId,input.membershipId]);
      return 'updated';
    });
  }

  async assignCustomRole(input: { organizationId: string; membershipId: string; customRoleId: string | null; expectedVersion: number }): Promise<'updated' | 'conflict'> {
    const result = await this.database.query(
      `UPDATE organization_memberships m SET custom_role_id=$3,version=version+1,updated_at=now()
       WHERE membership_id=$1 AND organization_id=$2 AND version=$4
        AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM custom_roles r WHERE r.custom_role_id=$3 AND r.organization_id=m.organization_id AND r.base_role_id=m.role_id AND r.active))`,
      [input.membershipId,input.organizationId,input.customRoleId,input.expectedVersion],
    );
    return result.rowCount === 1 ? 'updated' : 'conflict';
  }

  /**
   * Lists every permission a custom role may receive. The filter matches the
   * validation in `replaceCustomRolePermissions`: `:global`-suffixed and
   * wildcard permissions are excluded because the assign-repo rejects them.
   * The endpoint exists to power the custom-role permission editor, so the
   * list must not show permissions the API would refuse to save.
   */
  async listPermissions(): Promise<PermissionRecord[]> {
    return (await this.database.query<PermissionRecord>(
      `SELECT permission_id AS "permissionId", description
       FROM permissions
       WHERE permission_id !~ '(^|:)global$' AND permission_id !~ '\\*'
       ORDER BY permission_id`,
    )).rows;
  }

  async settingVersions(organizationId: string, settingKey: string) {
    return (await this.database.query<{ version: number; value: unknown; updatedByMembershipId: string; createdAt: Date }>(
      `SELECT version,value,updated_by_membership_id AS "updatedByMembershipId",created_at AS "createdAt"
       FROM organization_setting_versions WHERE organization_id=$1 AND setting_key=$2 ORDER BY version DESC`, [organizationId,settingKey],
    )).rows;
  }

  async maintenance() {
    return (await this.database.query<{ enabled: boolean; reasonCode: string | null; startsAt: Date | null; version: number; updatedAt: Date }>(
      `SELECT enabled,reason_code AS "reasonCode",starts_at AS "startsAt",version,updated_at AS "updatedAt" FROM platform_maintenance_state WHERE singleton_id=1`,
      // No `!` here. The singleton is seeded by 0037, but a FK cascade can remove it
      // (run-verify.sh truncates organization_memberships CASCADE), and asserting it
      // exists turned that into a TypeError and an opaque 500 at the response mapper.
    )).rows[0] ?? null;
  }

  async updateMaintenance(input: { enabled: boolean; reasonCode: string | null; startsAt: Date | null; membershipId: string; expectedVersion: number }): Promise<number | null> {
    return (await this.database.query<{ version: number }>(
      `UPDATE platform_maintenance_state SET enabled=$1,reason_code=$2,starts_at=$3,updated_by_membership_id=$4,
       version=version+1,updated_at=now() WHERE singleton_id=1 AND version=$5 RETURNING version`,
      [input.enabled,input.reasonCode,input.startsAt,input.membershipId,input.expectedVersion],
    )).rows[0]?.version ?? null;
  }
}

function code(error: unknown): string | undefined { return typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined; }
