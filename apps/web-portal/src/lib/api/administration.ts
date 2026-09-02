/**
 * Administration surface: FAQ content, notification templates, broadcasts, custom
 * roles, maintenance mode and setting history.
 *
 * Every response type comes from the generated contract, so a field the API stops
 * sending becomes a type error here rather than `undefined` rendered in a table.
 *
 * OPTIMISTIC CONCURRENCY IS NOT OPTIONAL on this surface. The backend refuses a write
 * whose `expected_version` does not match the stored version, which is what stops one
 * editor silently overwriting another. Callers must pass the version they read, and
 * must re-read on `ApiError.isConflict` rather than retrying with the same value.
 */

import type {
  ActivateNotificationTemplateVersionRequest,
  AddNotificationTemplateVersionRequest,
  ArchiveFaqEntryRequest,
  BroadcastMessage,
  BroadcastMessageList,
  BroadcastMessageQueued,
  CreateBroadcastMessageRequest,
  CreateFaqEntryRequest,
  CreateFirmwareRolloutRequest,
  CreateNotificationTemplateRequest,
  ExportJobCreated,
  ExportJobView,
  FaqEntry,
  FaqEntryList,
  FirmwareRollout,
  NotificationTemplate,
  NotificationTemplateList,
  NotificationTemplateVersion,
  NotificationTemplateVersionList,
  OrganizationSettingList,
  OrganizationSettingUpdated,
  OrganizationSettingVersionList,
  PlatformMaintenanceState,
  PlatformMaintenanceUpdated,
  RequestExportRequest,
  UpdateOrganizationSettingRequest,
  SetFaqPublishStateRequest,
  UpdateFaqEntryRequest,
  UpdatePlatformMaintenanceRequest,
  CustomRole,
  CustomRoleList,
  CreateCustomRoleRequest,
  UpdateCustomRoleRequest,
  ReplaceCustomRolePermissionsRequest,
  Permission,
  PermissionList,
} from '@/types/contracts';
import { apiRequest } from './client';

// --------------------------------------------------------------------------- FAQ

export function listFaqEntries(
  options: { publishedOnly?: boolean; signal?: AbortSignal } = {},
): Promise<FaqEntryList> {
  const query = options.publishedOnly ? '?published_only=true' : '';
  return apiRequest<FaqEntryList>({ method: 'GET', path: `/admin/faqs${query}`, signal: options.signal });
}

export function readFaqEntry(faqEntryId: string, signal?: AbortSignal): Promise<FaqEntry> {
  return apiRequest<FaqEntry>({ method: 'GET', path: `/admin/faqs/${faqEntryId}`, signal });
}

export function createFaqEntry(body: CreateFaqEntryRequest): Promise<FaqEntry> {
  return apiRequest<FaqEntry>({ method: 'POST', path: '/admin/faqs', body, csrf: true });
}

export function updateFaqEntry(faqEntryId: string, body: UpdateFaqEntryRequest): Promise<FaqEntry> {
  return apiRequest<FaqEntry>({ method: 'PUT', path: `/admin/faqs/${faqEntryId}`, body, csrf: true });
}

export function setFaqPublishState(
  faqEntryId: string,
  body: SetFaqPublishStateRequest,
): Promise<FaqEntry> {
  return apiRequest<FaqEntry>({
    method: 'PUT',
    path: `/admin/faqs/${faqEntryId}/publish-state`,
    body,
    csrf: true,
  });
}

/**
 * Archives rather than deletes. The backend keeps the row so published content history
 * is never erased, and the returned entry reports `publish_state: 'archived'`.
 */
export function archiveFaqEntry(
  faqEntryId: string,
  body: ArchiveFaqEntryRequest,
): Promise<FaqEntry> {
  return apiRequest<FaqEntry>({
    method: 'DELETE',
    path: `/admin/faqs/${faqEntryId}`,
    body,
    csrf: true,
  });
}

// ------------------------------------------------------- notification templates

export function listNotificationTemplates(signal?: AbortSignal): Promise<NotificationTemplateList> {
  return apiRequest<NotificationTemplateList>({
    method: 'GET',
    path: '/admin/notification-templates',
    signal,
  });
}

export function createNotificationTemplate(
  body: CreateNotificationTemplateRequest,
): Promise<NotificationTemplate> {
  return apiRequest<NotificationTemplate>({
    method: 'POST',
    path: '/admin/notification-templates',
    body,
    csrf: true,
  });
}

export function listNotificationTemplateVersions(
  templateKey: string,
  signal?: AbortSignal,
): Promise<NotificationTemplateVersionList> {
  return apiRequest<NotificationTemplateVersionList>({
    method: 'GET',
    path: `/admin/notification-templates/${templateKey}/versions`,
    signal,
  });
}

export function activateNotificationTemplateVersion(
  templateKey: string,
  body: ActivateNotificationTemplateVersionRequest,
): Promise<{ template_key: string; active_version: number }> {
  return apiRequest({
    method: 'PUT',
    path: `/admin/notification-templates/${templateKey}/active-version`,
    body,
    csrf: true,
  });
}

/** Adds a new version to an existing notification template. Append-only — no mutation of prior versions. */
export function addNotificationTemplateVersion(
  templateKey: string,
  body: AddNotificationTemplateVersionRequest,
): Promise<NotificationTemplateVersion> {
  return apiRequest<NotificationTemplateVersion>({
    method: 'POST',
    path: `/admin/notification-templates/${templateKey}/versions`,
    body,
    csrf: true,
  });
}

// ------------------------------------------------------------------- broadcasts

export function listBroadcastMessages(signal?: AbortSignal): Promise<BroadcastMessageList> {
  return apiRequest<BroadcastMessageList>({ method: 'GET', path: '/admin/broadcasts', signal });
}

export function createBroadcastMessage(
  body: CreateBroadcastMessageRequest,
): Promise<BroadcastMessage> {
  return apiRequest<BroadcastMessage>({
    method: 'POST',
    path: '/admin/broadcasts',
    body,
    csrf: true,
  });
}

/**
 * Queues the broadcast through the backend's transactional outbox; the worker performs
 * delivery. Returning 200 rather than 201 is deliberate — nothing is created.
 */
export function sendBroadcastMessage(
  broadcastMessageId: string,
  expectedVersion: number,
): Promise<BroadcastMessageQueued> {
  return apiRequest<BroadcastMessageQueued>({
    method: 'POST',
    path: `/admin/broadcasts/${broadcastMessageId}/send`,
    body: { expected_version: expectedVersion },
    csrf: true,
  });
}

/**
 * Schedules the broadcast for a future instant.
 *
 * SENDING NOW IS NOT SCHEDULING FOR now(). The two are separate endpoints because they are
 * separate decisions: a schedule can be re-read and re-scheduled before it fires, whereas a
 * send is queued to the outbox immediately and cannot be recalled. A page that modelled
 * "send now" as a schedule with the current timestamp would be claiming a reversibility the
 * system does not offer.
 *
 * `expected_version` is the version the caller last read. A concurrent edit makes it stale
 * and the write is refused with `409 BROADCAST_VERSION_CONFLICT` rather than overwriting.
 *
 * THE RESPONSE DOES NOT CARRY THE NEW VERSION — it is the narrow `BroadcastMessageQueued`
 * acknowledgement of id, status and scheduled instant. So a caller intending a second
 * mutation must RE-READ the list rather than incrementing what it holds; guessing the next
 * version is how the following write earns a spurious conflict.
 */
export function scheduleBroadcastMessage(
  broadcastMessageId: string,
  scheduledAt: string,
  expectedVersion: number,
): Promise<BroadcastMessageQueued> {
  return apiRequest<BroadcastMessageQueued>({
    method: 'PUT',
    path: `/admin/broadcasts/${broadcastMessageId}/schedule`,
    body: { scheduled_at: scheduledAt, expected_version: expectedVersion },
    csrf: true,
  });
}

// -------------------------------------------------------------- custom roles

export function listCustomRoles(signal?: AbortSignal): Promise<CustomRoleList> {
  return apiRequest<CustomRoleList>({ method: 'GET', path: '/admin/custom-roles', signal });
}

export function createCustomRole(body: CreateCustomRoleRequest): Promise<CustomRole> {
  return apiRequest<CustomRole>({ method: 'POST', path: '/admin/custom-roles', body, csrf: true });
}

export function updateCustomRole(customRoleId: string, body: UpdateCustomRoleRequest): Promise<CustomRole> {
  return apiRequest<CustomRole>({ method: 'PUT', path: `/admin/custom-roles/${customRoleId}`, body, csrf: true });
}

export function replaceCustomRolePermissions(
  customRoleId: string,
  body: ReplaceCustomRolePermissionsRequest,
): Promise<CustomRole> {
  return apiRequest<CustomRole>({ method: 'PUT', path: `/admin/custom-roles/${customRoleId}/permissions`, body, csrf: true });
}

// -------------------------------------------------------- settings and maintenance

/**
 * Reads all organization settings as a flat list. Each item carries the key, current value
 * and the version a subsequent update must quote.
 */
export function listOrganizationSettings(signal?: AbortSignal): Promise<OrganizationSettingList> {
  return apiRequest<OrganizationSettingList>({
    method: 'GET',
    path: '/admin/settings',
    signal,
  });
}

/**
 * Updates one setting value. Optimistic concurrency: `expected_version` must match the stored
 * version or the write is refused with 409. The response carries the new version, so a caller
 * performing a second edit on the same key can use the returned version rather than re-reading.
 */
export function updateOrganizationSetting(
  settingKey: string,
  body: UpdateOrganizationSettingRequest,
): Promise<OrganizationSettingUpdated> {
  return apiRequest<OrganizationSettingUpdated>({
    method: 'PUT',
    path: `/admin/settings/${settingKey}`,
    body,
    csrf: true,
  });
}

export function listOrganizationSettingVersions(
  settingKey: string,
  signal?: AbortSignal,
): Promise<OrganizationSettingVersionList> {
  return apiRequest<OrganizationSettingVersionList>({
    method: 'GET',
    path: `/admin/settings/${settingKey}/versions`,
    signal,
  });
}

/** Global scope: requires `platform.maintenance:manage:global`, not organization admin. */
export function readPlatformMaintenance(signal?: AbortSignal): Promise<PlatformMaintenanceState> {
  return apiRequest<PlatformMaintenanceState>({ method: 'GET', path: '/admin/maintenance', signal });
}

/** Requires a recent step-up. Disabling must clear the reason and start time. */
export function updatePlatformMaintenance(
  body: UpdatePlatformMaintenanceRequest,
): Promise<PlatformMaintenanceUpdated> {
  return apiRequest<PlatformMaintenanceUpdated>({
    method: 'PUT',
    path: '/admin/maintenance',
    body,
    csrf: true,
  });
}

// ----------------------------------------------------------------- permissions

/**
 * The permission catalogue a custom role may receive. Global-scoped and wildcard
 * permissions are excluded by the backend because the assign endpoint rejects them.
 * Requires `custom_role:manage:organization`.
 */
export function listAdminPermissions(signal?: AbortSignal): Promise<PermissionList> {
  return apiRequest<PermissionList>({ method: 'GET', path: '/admin/permissions', signal });
}

// ------------------------------------------------------------- custom role assignment

/**
 * Assigns or clears a custom role on a membership. Step-up required. Pass `custom_role_id: null`
 * to clear an existing assignment.
 */
export function assignMembershipCustomRole(
  membershipId: string,
  body: { custom_role_id: string | null; expected_version: number },
): Promise<import('@/types/contracts').MembershipAdministrationView> {
  return apiRequest({
    method: 'PUT',
    path: `/admin/memberships/${membershipId}/custom-role`,
    body,
    csrf: true,
  });
}

// ----------------------------------------------------------------- exports

/** Requests a bulk data export. Step-up required — this is a bulk-disclosure action. */
export function requestExport(
  body: RequestExportRequest,
  idempotencyKey: string,
): Promise<ExportJobCreated> {
  return apiRequest<ExportJobCreated>({
    method: 'POST',
    path: '/admin/exports',
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Reads export progress and availability. Poll until `status` is terminal and `downloadable` is true. */
export function readExportJob(exportJobId: string, signal?: AbortSignal): Promise<ExportJobView> {
  return apiRequest<ExportJobView>({
    method: 'GET',
    path: `/admin/exports/${encodeURIComponent(exportJobId)}`,
    signal,
  });
}

// ----------------------------------------------------------------- firmware

/** Creates a firmware rollout (super-admin, `iot.firmware:manage:global`). */
export function createFirmwareRollout(
  body: CreateFirmwareRolloutRequest,
  idempotencyKey: string,
): Promise<FirmwareRollout> {
  return apiRequest<FirmwareRollout>({
    method: 'POST',
    path: '/firmware/rollouts',
    body,
    csrf: true,
    idempotencyKey,
  });
}
