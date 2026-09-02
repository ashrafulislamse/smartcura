import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
export const contentPublishState = pgEnum('content_publish_state', ['draft', 'published', 'archived']);
export const broadcastStatus = pgEnum('broadcast_status', ['draft', 'scheduled', 'dispatching', 'sent', 'cancelled']);
export const broadcastAudience = pgEnum('broadcast_audience', ['all', 'patients', 'staff']);

export const faqEntries = pgTable('faq_entries', {
  faqEntryId: uuid('faq_entry_id').primaryKey().defaultRandom(), organizationId: uuid('organization_id').notNull(),
  slug: varchar('slug', { length: 80 }).notNull(), question: text('question').notNull(), answer: text('answer').notNull(),
  publishState: contentPublishState('publish_state').notNull().default('draft'), publishedAt: timestamp('published_at', { withTimezone: true }),
  createdByMembershipId: uuid('created_by_membership_id').notNull(), updatedByMembershipId: uuid('updated_by_membership_id').notNull(),
  version: integer('version').notNull().default(0), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex('faq_entries_org_slug_uq').on(table.organizationId, table.slug), check('faq_version_check', sql`${table.version} >= 0`)]);

export const notificationTemplates = pgTable('notification_templates', {
  notificationTemplateId: uuid('notification_template_id').primaryKey().defaultRandom(), organizationId: uuid('organization_id').notNull(),
  templateKey: varchar('template_key', { length: 64 }).notNull(), category: varchar('category', { length: 32 }).notNull(),
  activeVersion: integer('active_version'), createdByMembershipId: uuid('created_by_membership_id').notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex('notification_templates_org_key_uq').on(table.organizationId, table.templateKey)]);
export const notificationTemplateVersions = pgTable('notification_template_versions', {
  notificationTemplateVersionId: uuid('notification_template_version_id').primaryKey().defaultRandom(),
  notificationTemplateId: uuid('notification_template_id').notNull(), version: integer('version').notNull(),
  titleTemplate: text('title_template').notNull(), bodyTemplate: text('body_template').notNull(),
  createdByMembershipId: uuid('created_by_membership_id').notNull(), createdAt: createdAt(),
}, (table) => [uniqueIndex('notification_template_versions_template_version_uq').on(table.notificationTemplateId, table.version)]);
export const broadcastMessages = pgTable('broadcast_messages', {
  broadcastMessageId: uuid('broadcast_message_id').primaryKey().defaultRandom(), organizationId: uuid('organization_id').notNull(),
  notificationTemplateVersionId: uuid('notification_template_version_id').notNull(), audience: broadcastAudience('audience').notNull(),
  status: broadcastStatus('status').notNull().default('draft'), scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }), createdByMembershipId: uuid('created_by_membership_id').notNull(),
  version: integer('version').notNull().default(0), createdAt: createdAt(), updatedAt: updatedAt(),
});
export const broadcastRecipients = pgTable('broadcast_recipients', {
  broadcastMessageId: uuid('broadcast_message_id').notNull(), profileId: uuid('profile_id').notNull(),
  notificationId: uuid('notification_id'), createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.broadcastMessageId, table.profileId] })]);

export const customRoles = pgTable('custom_roles', {
  customRoleId: uuid('custom_role_id').primaryKey().defaultRandom(), organizationId: uuid('organization_id').notNull(),
  roleKey: varchar('role_key', { length: 48 }).notNull(), displayName: varchar('display_name', { length: 80 }).notNull(),
  baseRoleId: varchar('base_role_id', { length: 32 }).notNull(), active: boolean('active').notNull().default(true),
  createdByMembershipId: uuid('created_by_membership_id').notNull(), updatedByMembershipId: uuid('updated_by_membership_id').notNull(),
  version: integer('version').notNull().default(0), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex('custom_roles_org_key_uq').on(table.organizationId, table.roleKey)]);
export const customRolePermissions = pgTable('custom_role_permissions', {
  customRoleId: uuid('custom_role_id').notNull(), permissionId: varchar('permission_id', { length: 128 }).notNull(),
  createdByMembershipId: uuid('created_by_membership_id').notNull(), createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.customRoleId, table.permissionId] })]);

export const organizationSettingVersions = pgTable('organization_setting_versions', {
  organizationSettingVersionId: uuid('organization_setting_version_id').primaryKey().defaultRandom(),
  organizationSettingId: uuid('organization_setting_id').notNull(), organizationId: uuid('organization_id').notNull(),
  settingKey: varchar('setting_key', { length: 64 }).notNull(), value: jsonb('value').notNull(), version: integer('version').notNull(),
  updatedByMembershipId: uuid('updated_by_membership_id').notNull(), createdAt: createdAt(),
});
export const platformMaintenanceState = pgTable('platform_maintenance_state', {
  singletonId: integer('singleton_id').primaryKey().default(1), enabled: boolean('enabled').notNull().default(false),
  reasonCode: varchar('reason_code', { length: 64 }), startsAt: timestamp('starts_at', { withTimezone: true }),
  updatedByMembershipId: uuid('updated_by_membership_id'), version: integer('version').notNull().default(0), updatedAt: updatedAt(),
});
export const platformMaintenanceVersions = pgTable('platform_maintenance_versions', {
  platformMaintenanceVersionId: uuid('platform_maintenance_version_id').primaryKey().defaultRandom(), enabled: boolean('enabled').notNull(),
  reasonCode: varchar('reason_code', { length: 64 }), startsAt: timestamp('starts_at', { withTimezone: true }),
  updatedByMembershipId: uuid('updated_by_membership_id').notNull(), version: integer('version').notNull(), createdAt: createdAt(),
});
