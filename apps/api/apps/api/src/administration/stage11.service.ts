import { Injectable } from '@nestjs/common';
import { OutboxRepository } from '@smartcura/database';
import {
  Stage11Repository,
  type BroadcastRecord,
  type CustomRoleRecord,
  type FaqRecord,
  type PermissionRecord,
  type TemplateRecord,
  type TemplateVersionRecord,
} from '@smartcura/database/stage11';
import type { ZodType } from 'zod';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  activateTemplateVersionSchema,
  addTemplateVersionSchema,
  archiveFaqSchema,
  assignCustomRoleSchema,
  createBroadcastSchema,
  createCustomRoleSchema,
  createFaqSchema,
  createTemplateSchema,
  listFaqsSchema,
  replayDeadLetterSchema,
  replaceCustomRolePermissionsSchema,
  scheduleBroadcastSchema,
  sendBroadcastSchema,
  setFaqStateSchema,
  updateCustomRoleSchema,
  updateFaqSchema,
  updateMaintenanceSchema,
} from './stage11-request.schemas.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SETTING_KEY = /^[a-z][a-z0-9_.]{1,62}$/;
const TEMPLATE_KEY = SETTING_KEY;

@Injectable()
export class Stage11Service {
  constructor(
    private readonly stage11: Stage11Repository,
    private readonly outbox: OutboxRepository,
  ) {}

  async listFaqs(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listFaqsSchema, queryValue);
    const active = this.administrative(current, 'content:manage:organization');
    const rows = await this.stage11.listFaqs(active.organizationId, query.published_only === 'true');
    return { data: rows.map(faqResponse) };
  }

  async readFaq(current: AuthenticatedSession, faqEntryIdValue: string) {
    const faqEntryId = id(faqEntryIdValue);
    const active = this.administrative(current, 'content:manage:organization');
    const record = await this.stage11.findFaq(active.organizationId, faqEntryId);
    if (record === null) throw problem(404, 'RESOURCE_NOT_FOUND', 'FAQ entry was not found');
    return faqResponse(record);
  }

  async createFaq(current: AuthenticatedSession, value: unknown) {
    const request = parse(createFaqSchema, value);
    const active = this.administrative(current, 'content:manage:organization');
    const created = await this.stage11.createFaq({
      organizationId: active.organizationId, membershipId: active.membershipId,
      slug: request.slug, question: request.question, answer: request.answer,
    });
    if (created === 'duplicate') throw problem(409, 'FAQ_SLUG_CONFLICT', 'The FAQ slug is already used');
    return faqResponse(created);
  }

  async updateFaq(current: AuthenticatedSession, faqEntryIdValue: string, value: unknown) {
    const faqEntryId = id(faqEntryIdValue);
    const request = parse(updateFaqSchema, value);
    const active = this.administrative(current, 'content:manage:organization');
    const updated = await this.stage11.updateFaq({
      organizationId: active.organizationId, faqEntryId, membershipId: active.membershipId,
      slug: request.slug, question: request.question, answer: request.answer,
      expectedVersion: request.expected_version,
    });
    if (updated === 'duplicate') throw problem(409, 'FAQ_SLUG_CONFLICT', 'The FAQ slug is already used');
    if (updated === null) throw problem(409, 'FAQ_VERSION_CONFLICT', 'The FAQ entry changed');
    return faqResponse(updated);
  }

  async setFaqState(current: AuthenticatedSession, faqEntryIdValue: string, value: unknown) {
    const faqEntryId = id(faqEntryIdValue);
    const request = parse(setFaqStateSchema, value);
    return this.changeFaqState(current, faqEntryId, request.publish_state, request.expected_version);
  }

  async archiveFaq(current: AuthenticatedSession, faqEntryIdValue: string, value: unknown) {
    const faqEntryId = id(faqEntryIdValue);
    const request = parse(archiveFaqSchema, value);
    return this.changeFaqState(current, faqEntryId, 'archived', request.expected_version);
  }

  private async changeFaqState(
    current: AuthenticatedSession, faqEntryId: string,
    state: 'draft' | 'published' | 'archived', expectedVersion: number,
  ) {
    const active = this.administrative(current, 'content:manage:organization');
    const updated = await this.stage11.setFaqState({
      organizationId: active.organizationId, faqEntryId, state,
      membershipId: active.membershipId, expectedVersion,
    });
    if (updated === null) throw problem(409, 'FAQ_VERSION_CONFLICT', 'The FAQ entry changed');
    return faqResponse(updated);
  }

  async listTemplates(current: AuthenticatedSession) {
    const active = this.administrative(current, 'content:manage:organization');
    return { data: (await this.stage11.listTemplates(active.organizationId)).map(templateResponse) };
  }

  async createTemplate(current: AuthenticatedSession, value: unknown) {
    const request = parse(createTemplateSchema, value);
    const active = this.administrative(current, 'content:manage:organization');
    const created = await this.stage11.createTemplate({
      organizationId: active.organizationId, membershipId: active.membershipId,
      templateKey: request.template_key, category: request.category,
      title: request.title_template, body: request.body_template,
    });
    if (created === 'duplicate') throw problem(409, 'TEMPLATE_KEY_CONFLICT', 'The template key is already used');
    return templateResponse(created);
  }

  async templateVersions(current: AuthenticatedSession, templateKeyValue: string) {
    const templateKey = key(templateKeyValue, TEMPLATE_KEY);
    const active = this.administrative(current, 'content:manage:organization');
    return { data: (await this.stage11.templateVersions(active.organizationId, templateKey)).map(templateVersionResponse) };
  }

  async addTemplateVersion(current: AuthenticatedSession, templateKeyValue: string, value: unknown) {
    const templateKey = key(templateKeyValue, TEMPLATE_KEY);
    const request = parse(addTemplateVersionSchema, value);
    const active = this.administrative(current, 'content:manage:organization');
    const created = await this.stage11.addTemplateVersion({
      organizationId: active.organizationId, templateKey, membershipId: active.membershipId,
      title: request.title_template, body: request.body_template,
    });
    if (created === null) throw problem(404, 'RESOURCE_NOT_FOUND', 'Template was not found');
    return templateVersionResponse(created);
  }

  async activateTemplateVersion(current: AuthenticatedSession, templateKeyValue: string, value: unknown) {
    const templateKey = key(templateKeyValue, TEMPLATE_KEY);
    const request = parse(activateTemplateVersionSchema, value);
    const active = this.administrative(current, 'content:manage:organization');
    const activated = await this.stage11.activateTemplateVersion({
      organizationId: active.organizationId, templateKey, version: request.version,
    });
    if (!activated) throw problem(404, 'RESOURCE_NOT_FOUND', 'Template version was not found');
    return { template_key: templateKey, active_version: request.version };
  }

  async listBroadcasts(current: AuthenticatedSession) {
    const active = this.administrative(current, 'content:manage:organization');
    return { data: (await this.stage11.listBroadcasts(active.organizationId)).map(broadcastResponse) };
  }

  async createBroadcast(current: AuthenticatedSession, value: unknown) {
    const request = parse(createBroadcastSchema, value);
    const active = this.administrative(current, 'content:manage:organization');
    const created = await this.stage11.createBroadcast({
      organizationId: active.organizationId, membershipId: active.membershipId,
      templateKey: request.template_key, templateVersion: request.template_version,
      audience: request.audience,
    });
    if (created === null) throw problem(404, 'RESOURCE_NOT_FOUND', 'Template version was not found');
    return broadcastResponse(created);
  }

  async scheduleBroadcast(current: AuthenticatedSession, broadcastIdValue: string, value: unknown) {
    const broadcastMessageId = id(broadcastIdValue);
    const request = parse(scheduleBroadcastSchema, value);
    const scheduledAt = new Date(request.scheduled_at);
    if (scheduledAt.getTime() <= Date.now()) throw validationFailed();
    return this.queueBroadcast(current, broadcastMessageId, scheduledAt, request.expected_version);
  }

  async sendBroadcast(current: AuthenticatedSession, broadcastIdValue: string, value: unknown) {
    const broadcastMessageId = id(broadcastIdValue);
    const request = parse(sendBroadcastSchema, value);
    return this.queueBroadcast(current, broadcastMessageId, new Date(), request.expected_version);
  }

  private async queueBroadcast(
    current: AuthenticatedSession, broadcastMessageId: string,
    scheduledAt: Date, expectedVersion: number,
  ) {
    const active = this.administrative(current, 'content:manage:organization');
    const result = await this.stage11.queueBroadcast({
      organizationId: active.organizationId, broadcastMessageId, scheduledAt,
      expectedVersion, correlationId: correlationId(),
    });
    if (result === 'state') throw problem(404, 'RESOURCE_NOT_FOUND', 'Broadcast was not found');
    if (result === 'conflict') throw problem(409, 'BROADCAST_VERSION_CONFLICT', 'The broadcast cannot be queued');
    return { broadcast_message_id: broadcastMessageId, status: 'scheduled', scheduled_at: scheduledAt.toISOString() };
  }

  async listCustomRoles(current: AuthenticatedSession) {
    const active = this.administrative(current, 'custom_role:manage:organization');
    return { data: (await this.stage11.listCustomRoles(active.organizationId)).map(customRoleResponse) };
  }

  async listPermissions(current: AuthenticatedSession) {
    this.administrative(current, 'custom_role:manage:organization');
    return { data: (await this.stage11.listPermissions()).map(permissionResponse) };
  }

  async createCustomRole(current: AuthenticatedSession, value: unknown) {
    const request = parse(createCustomRoleSchema, value);
    const active = this.administrative(current, 'custom_role:manage:organization');
    this.requireStepUp(current);
    const created = await this.stage11.createCustomRole({
      organizationId: active.organizationId, membershipId: active.membershipId,
      roleKey: request.role_key, displayName: request.display_name, baseRoleId: request.base_role_id,
    });
    if (created === 'duplicate') throw problem(409, 'CUSTOM_ROLE_KEY_CONFLICT', 'The custom role key is already used');
    return customRoleResponse(created);
  }

  async updateCustomRole(current: AuthenticatedSession, customRoleIdValue: string, value: unknown) {
    const customRoleId = id(customRoleIdValue);
    const request = parse(updateCustomRoleSchema, value);
    const active = this.administrative(current, 'custom_role:manage:organization');
    this.requireStepUp(current);
    const updated = await this.stage11.updateCustomRole({
      organizationId: active.organizationId, customRoleId, membershipId: active.membershipId,
      displayName: request.display_name, active: request.active,
      expectedVersion: request.expected_version,
    });
    if (!updated) throw problem(409, 'CUSTOM_ROLE_VERSION_CONFLICT', 'The custom role changed');
    return { custom_role_id: customRoleId, version: request.expected_version + 1 };
  }

  async replaceCustomRolePermissions(current: AuthenticatedSession, customRoleIdValue: string, value: unknown) {
    const customRoleId = id(customRoleIdValue);
    const request = parse(replaceCustomRolePermissionsSchema, value);
    const active = this.administrative(current, 'custom_role:manage:organization');
    this.requireStepUp(current);
    const result = await this.stage11.replaceCustomRolePermissions({
      organizationId: active.organizationId, customRoleId, membershipId: active.membershipId,
      permissionIds: request.permission_ids, expectedVersion: request.expected_version,
    });
    if (result === 'not_found') throw problem(404, 'RESOURCE_NOT_FOUND', 'Custom role was not found');
    if (result === 'invalid_permission') throw problem(422, 'CUSTOM_ROLE_PERMISSION_INVALID', 'A permission cannot be assigned');
    if (result === 'conflict') throw problem(409, 'CUSTOM_ROLE_VERSION_CONFLICT', 'The custom role changed');
    return { custom_role_id: customRoleId, version: request.expected_version + 1 };
  }

  async assignCustomRole(current: AuthenticatedSession, membershipIdValue: string, value: unknown) {
    const membershipId = id(membershipIdValue);
    const request = parse(assignCustomRoleSchema, value);
    const active = this.administrative(current, 'custom_role:manage:organization');
    this.requireStepUp(current);
    const result = await this.stage11.assignCustomRole({
      organizationId: active.organizationId, membershipId,
      customRoleId: request.custom_role_id, expectedVersion: request.expected_version,
    });
    if (result === 'conflict') throw problem(409, 'MEMBERSHIP_ROLE_CONFLICT', 'The membership or custom role changed');
    return { membership_id: membershipId, custom_role_id: request.custom_role_id, version: request.expected_version + 1 };
  }

  async settingVersions(current: AuthenticatedSession, settingKeyValue: string) {
    const settingKey = key(settingKeyValue, SETTING_KEY);
    const active = this.administrative(current, 'organization.setting:manage:organization');
    const versions = await this.stage11.settingVersions(active.organizationId, settingKey);
    return { setting_key: settingKey, data: versions.map((version) => ({
      version: version.version, value: version.value,
      updated_by_membership_id: version.updatedByMembershipId,
      created_at: version.createdAt.toISOString(),
    })) };
  }

  async maintenance(current: AuthenticatedSession) {
    this.administrative(current, 'platform.maintenance:manage:global');
    const record = await this.stage11.maintenance();
    // The singleton is a schema invariant, so its absence is an environment fault, not
    // a client error. Naming it beats the TypeError this used to raise.
    if (record === null) {
      throw problem(503, 'DEPENDENCY_UNAVAILABLE', 'Platform maintenance state is not initialised');
    }
    return maintenanceResponse(record);
  }

  async updateMaintenance(current: AuthenticatedSession, value: unknown) {
    const request = parse(updateMaintenanceSchema, value);
    const active = this.administrative(current, 'platform.maintenance:manage:global');
    this.requireStepUp(current);
    const version = await this.stage11.updateMaintenance({
      enabled: request.enabled, reasonCode: request.reason_code,
      startsAt: request.starts_at === null ? null : new Date(request.starts_at),
      membershipId: active.membershipId, expectedVersion: request.expected_version,
    });
    if (version === null) throw problem(409, 'MAINTENANCE_VERSION_CONFLICT', 'Maintenance state changed');
    return { enabled: request.enabled, reason_code: request.reason_code,
      starts_at: request.starts_at, version };
  }

  async replayDeadLetter(current: AuthenticatedSession, eventIdValue: string, value: unknown) {
    const eventId = id(eventIdValue);
    const request = parse(replayDeadLetterSchema, value);
    this.administrative(current, 'system.security:*:global');
    this.requireStepUp(current);
    const result = await this.outbox.replayDeadLetter({
      eventId, reasonCode: request.reason_code,
      actorProfileId: current.aggregate.profile.profileId,
      correlationId: correlationId(),
    });
    // A single answer covers an unknown event and one that is not currently
    // dead-lettered: either way there is nothing to recover. Idempotency is provided by
    // the locked status transition in the repository, not by a replay flag.
    if (result === 'not_found') throw problem(404, 'RESOURCE_NOT_FOUND', 'No dead-lettered event with that id');
    return { event_id: eventId, status: 'pending', replayed: true };
  }

  private active(current: AuthenticatedSession) {
    const active = current.aggregate.memberships.find(
      (entry) => entry.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    if (current.aggregate.profile.status !== 'active' || current.aggregate.profile.onboardingCompletedAt === null) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    return active;
  }

  private administrative(current: AuthenticatedSession, permission: string) {
    const active = this.active(current);
    if (!active.permissions.includes(permission)) throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    return active;
  }

  private requireStepUp(current: AuthenticatedSession) {
    const validUntil = current.aggregate.session.stepUpValidUntil ?? null;
    if (validUntil === null || validUntil.getTime() <= Date.now()) {
      throw problem(403, 'STEP_UP_REQUIRED', 'Recent step-up authentication is required');
    }
  }
}

export function faqResponse(record: FaqRecord): Record<string, unknown> {
  return { faq_entry_id: record.faqEntryId, slug: record.slug, question: record.question,
    answer: record.answer, publish_state: record.publishState,
    published_at: record.publishedAt?.toISOString() ?? null, version: record.version,
    updated_at: record.updatedAt.toISOString() };
}
export function templateResponse(record: TemplateRecord): Record<string, unknown> {
  return { notification_template_id: record.notificationTemplateId,
    template_key: record.templateKey, category: record.category,
    active_version: record.activeVersion, updated_at: record.updatedAt.toISOString() };
}
export function templateVersionResponse(record: TemplateVersionRecord): Record<string, unknown> {
  return { notification_template_version_id: record.notificationTemplateVersionId,
    version: record.version, title_template: record.titleTemplate,
    body_template: record.bodyTemplate, created_at: record.createdAt.toISOString() };
}
export function broadcastResponse(record: BroadcastRecord): Record<string, unknown> {
  return { broadcast_message_id: record.broadcastMessageId,
    notification_template_version_id: record.templateVersionId, audience: record.audience,
    status: record.status, scheduled_at: record.scheduledAt?.toISOString() ?? null,
    dispatched_at: record.dispatchedAt?.toISOString() ?? null, version: record.version,
    created_at: record.createdAt.toISOString() };
}
export function customRoleResponse(record: CustomRoleRecord): Record<string, unknown> {
  return { custom_role_id: record.customRoleId, role_key: record.roleKey,
    display_name: record.displayName, base_role_id: record.baseRoleId, active: record.active,
    permission_ids: record.permissions, version: record.version,
    updated_at: record.updatedAt.toISOString() };
}
export function permissionResponse(record: PermissionRecord): Record<string, unknown> {
  return { permission_id: record.permissionId, description: record.description };
}
function maintenanceResponse(record: { enabled: boolean; reasonCode: string | null; startsAt: Date | null; version: number; updatedAt: Date }) {
  return { enabled: record.enabled, reason_code: record.reasonCode,
    starts_at: record.startsAt?.toISOString() ?? null, version: record.version,
    updated_at: record.updatedAt.toISOString() };
}
function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}
function id(value: string): string {
  if (!UUID_V7.test(value)) throw validationFailed();
  return value;
}
function key(value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw validationFailed();
  return value;
}
