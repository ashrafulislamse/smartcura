import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable('organizations', {
  organizationId: uuid('organization_id').primaryKey(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sites = pgTable('sites', {
  siteId: uuid('site_id').primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  name: text('name').notNull(),
  kind: varchar('kind', { length: 64 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index('sites_organization_idx').on(table.organizationId),
  uniqueIndex('sites_id_organization_uq').on(table.siteId, table.organizationId),
]);

export const profileStatus = pgEnum('profile_status', [
  'pending', 'active', 'suspended', 'deactivated',
]);
export const membershipStatus = pgEnum('membership_status', [
  'applied', 'invited', 'active', 'suspended', 'revoked', 'expired',
]);
export const verificationStatus = pgEnum('verification_status', [
  'not_submitted', 'pending_review', 'changes_requested', 'approved',
  'rejected', 'suspended', 'expired',
]);
export const appSessionStatus = pgEnum('app_session_status', [
  'active', 'idle_expired', 'absolute_expired', 'revoked', 'membership_ended',
]);
export const sessionClientType = pgEnum('session_client_type', [
  'patient_flutter', 'doctor_flutter', 'driver_flutter', 'web_portal',
]);

export const profiles = pgTable('profiles', {
  profileId: uuid('profile_id').primaryKey(),
  firebaseUid: varchar('firebase_uid', { length: 128 }).notNull(),
  status: profileStatus('status').notNull().default('pending'),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  phoneE164: varchar('phone_e164', { length: 16 }),
  preferredLocale: varchar('preferred_locale', { length: 35 }).notNull().default('en-MY'),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kuala_Lumpur'),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('profiles_firebase_uid_uq').on(table.firebaseUid),
  index('profiles_status_idx').on(table.status),
  index('profiles_display_name_trgm_idx').using('gin', sql`${table.displayName} gin_trgm_ops`),
  check('profiles_version_check', sql`${table.version} >= 0`),
  check('profiles_onboarding_status_check', sql`${table.onboardingCompletedAt} IS NULL OR ${table.status} <> 'pending'`),
  check('profiles_phone_e164_check', sql`${table.phoneE164} IS NULL OR ${table.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
]);

export const roles = pgTable('roles', {
  roleId: varchar('role_id', { length: 32 }).primaryKey(),
  displayName: varchar('display_name', { length: 80 }).notNull(),
  system: boolean('system').notNull().default(true),
  createdAt: createdAt(),
});

export const permissions = pgTable('permissions', {
  permissionId: varchar('permission_id', { length: 128 }).primaryKey(),
  description: text('description'),
  createdAt: createdAt(),
});

export const rolePermissions = pgTable('role_permissions', {
  roleId: varchar('role_id', { length: 32 }).notNull().references(() => roles.roleId),
  permissionId: varchar('permission_id', { length: 128 }).notNull().references(() => permissions.permissionId),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ name: 'role_permissions_pk', columns: [table.roleId, table.permissionId] }),
]);

export const organizationMemberships = pgTable('organization_memberships', {
  membershipId: uuid('membership_id').primaryKey(),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  roleId: varchar('role_id', { length: 32 }).notNull().references(() => roles.roleId),
  customRoleId: uuid('custom_role_id'),
  status: membershipStatus('status').notNull().default('invited'),
  verificationStatus: verificationStatus('verification_status'),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('organization_memberships_profile_org_role_uq').on(
    table.profileId, table.organizationId, table.roleId,
  ),
  uniqueIndex('organization_memberships_id_profile_uq').on(
    table.membershipId, table.profileId,
  ),
  uniqueIndex('organization_memberships_id_org_uq').on(
    table.membershipId, table.organizationId,
  ),
  index('organization_memberships_profile_status_idx').on(table.profileId, table.status),
  index('organization_memberships_org_role_status_idx').on(
    table.organizationId, table.roleId, table.status,
  ),
  index('organization_memberships_org_created_idx').on(
    table.organizationId, table.createdAt, table.membershipId,
  ),
  check('organization_memberships_version_check', sql`${table.version} >= 0`),
]);

export const membershipSites = pgTable('membership_sites', {
  membershipId: uuid('membership_id').notNull(),
  siteId: uuid('site_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ name: 'membership_sites_pk', columns: [table.membershipId, table.siteId] }),
  foreignKey({
    name: 'membership_sites_membership_org_fk',
    columns: [table.membershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  foreignKey({
    name: 'membership_sites_site_org_fk',
    columns: [table.siteId, table.organizationId],
    foreignColumns: [sites.siteId, sites.organizationId],
  }),
  index('membership_sites_site_idx').on(table.siteId),
]);

export const appSessions = pgTable('app_sessions', {
  sessionId: uuid('session_id').primaryKey(),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  activeMembershipId: uuid('active_membership_id'),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  csrfHash: varchar('csrf_hash', { length: 64 }).notNull(),
  status: appSessionStatus('status').notNull().default('active'),
  clientType: sessionClientType('client_type').notNull(),
  deviceName: varchar('device_name', { length: 120 }).notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  stepUpValidUntil: timestamp('step_up_valid_until', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revocationReason: varchar('revocation_reason', { length: 128 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('app_sessions_token_hash_uq').on(table.tokenHash),
  foreignKey({
    name: 'app_sessions_active_membership_profile_fk',
    columns: [table.activeMembershipId, table.profileId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.profileId],
  }),
  index('app_sessions_profile_status_idx').on(table.profileId, table.status),
  index('app_sessions_active_membership_idx').on(table.activeMembershipId),
  index('app_sessions_expiry_idx').on(table.status, table.idleExpiresAt, table.absoluteExpiresAt),
  check('app_sessions_token_hash_check', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check('app_sessions_csrf_hash_check', sql`${table.csrfHash} ~ '^[0-9a-f]{64}$'`),
  check('app_sessions_expiry_order_check', sql`${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`),
]);

export const sessionEvents = pgTable('session_events', {
  eventId: uuid('event_id').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => appSessions.sessionId),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  actorProfileId: uuid('actor_profile_id').notNull().references(() => profiles.profileId),
  correlationId: uuid('correlation_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  index('session_events_session_time_idx').on(table.sessionId, table.occurredAt),
]);

export const idempotencyKeys = pgTable('idempotency_keys', {
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  actorProfileId: uuid('actor_profile_id').notNull().references(() => profiles.profileId),
  operationId: varchar('operation_id', { length: 128 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  requestHash: varchar('request_hash', { length: 128 }).notNull(),
  state: varchar('state', { length: 32 }).notNull(),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body').$type<Record<string, unknown>>(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({
    name: 'idempotency_keys_pk',
    columns: [table.organizationId, table.actorProfileId, table.operationId, table.idempotencyKey],
  }),
  index('idempotency_keys_expiry_idx').on(table.expiresAt),
  check('idempotency_keys_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  check('idempotency_keys_response_status_check', sql`${table.responseStatus} IS NULL OR (${table.responseStatus} >= 100 AND ${table.responseStatus} <= 599)`),
]);

export const outboxStatus = pgEnum('outbox_status', [
  'pending',
  'processing',
  'processed',
  'dead_letter',
]);

export const outboxEvents = pgTable('outbox_events', {
  eventId: uuid('event_id').primaryKey(),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  eventVersion: integer('event_version').notNull(),
  aggregateType: varchar('aggregate_type', { length: 128 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  aggregateVersion: integer('aggregate_version').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  correlationId: uuid('correlation_id').notNull(),
  causationId: uuid('causation_id'),
  status: outboxStatus('status').notNull().default('pending'),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: varchar('lease_owner', { length: 128 }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastErrorCode: varchar('last_error_code', { length: 128 }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  index('outbox_claim_idx').on(table.status, table.availableAt, table.occurredAt),
  index('outbox_lease_idx').on(table.status, table.leaseExpiresAt),
  check('outbox_event_version_check', sql`${table.eventVersion} > 0`),
  check('outbox_aggregate_version_check', sql`${table.aggregateVersion} >= 0`),
  check('outbox_attempts_check', sql`${table.attempts} >= 0`),
  check('outbox_lease_check', sql`(${table.status} = 'processing' AND ${table.leaseOwner} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.status} <> 'processing' AND ${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL)`),
]);

export const inboxDeduplication = pgTable('inbox_deduplication', {
  consumer: varchar('consumer', { length: 128 }).notNull(),
  eventId: uuid('event_id').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'inbox_deduplication_pk', columns: [table.consumer, table.eventId] }),
]);

export const deadLetterEvents = pgTable('dead_letter_events', {
  deadLetterId: uuid('dead_letter_id').primaryKey(),
  eventId: uuid('event_id').notNull().references(() => outboxEvents.eventId),
  errorCode: varchar('error_code', { length: 128 }).notNull(),
  attempts: integer('attempts').notNull(),
  failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
  replayedAt: timestamp('replayed_at', { withTimezone: true }),
  replayReason: text('replay_reason'),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('dead_letter_event_uq').on(table.eventId),
]);

export const auditLogs = pgTable('audit_logs', {
  auditId: uuid('audit_id').primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.organizationId),
  actorProfileId: uuid('actor_profile_id').references(() => profiles.profileId),
  action: varchar('action', { length: 128 }).notNull(),
  objectType: varchar('object_type', { length: 128 }).notNull(),
  objectId: uuid('object_id'),
  reason: text('reason'),
  correlationId: uuid('correlation_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [
  index('audit_organization_time_idx').on(table.organizationId, table.occurredAt),
  index('audit_object_idx').on(table.objectType, table.objectId),
]);

export const foundationTransactionProbes = pgTable('foundation_transaction_probes', {
  probeId: uuid('probe_id').primaryKey(),
  marker: varchar('marker', { length: 128 }).notNull(),
  createdAt: createdAt(),
});

export const schemaCompatibility = pgTable('schema_compatibility', {
  component: varchar('component', { length: 128 }).primaryKey(),
  version: integer('version').notNull(),
  updatedAt: updatedAt(),
}, (table) => [
  check('schema_compatibility_version_check', sql`${table.version} > 0`),
]);

export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: varchar('worker_id', { length: 128 }).primaryKey(),
  buildVersion: varchar('build_version', { length: 128 }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('worker_heartbeats_last_seen_idx').on(table.lastSeenAt),
]);
// ---------------------------------------------------------------------------
// WP-04: profile detail, verification, private objects, consent and care access
// ---------------------------------------------------------------------------

export const addressKind = pgEnum('address_kind', [
  'home', 'work', 'billing', 'delivery', 'other',
]);
export const allergySeverity = pgEnum('allergy_severity', [
  'mild', 'moderate', 'severe', 'life_threatening',
]);
export const conditionSeverity = pgEnum('condition_severity', [
  'mild', 'moderate', 'severe', 'critical',
]);
export const clinicalRecordStatus = pgEnum('clinical_record_status', [
  'active', 'inactive', 'resolved', 'entered_in_error',
]);
export const verificationDocumentKind = pgEnum('verification_document_kind', [
  'medical_license', 'national_id', 'driving_licence', 'vehicle_registration',
  'pharmacy_licence', 'qualification_certificate', 'professional_indemnity',
]);
export const storedObjectStatus = pgEnum('stored_object_status', [
  'pending', 'finalized', 'quarantined', 'deleted', 'rejected',
]);
export const malwareScanState = pgEnum('malware_scan_state', [
  'not_scanned', 'scanning', 'clean', 'infected', 'scan_failed',
]);
export const consentScope = pgEnum('consent_scope', [
  'profile_contact', 'clinical_record', 'medication', 'iot_reading',
  'ai_artifact', 'full_record',
]);
export const consentRevocationReason = pgEnum('consent_revocation_reason', [
  'grantor_request', 'grantee_request', 'admin_action', 'superseded',
  'policy_violation', 'membership_ended',
]);
export const careAssignmentStatus = pgEnum('care_assignment_status', [
  'active', 'completed', 'revoked', 'expired',
]);

// The 0011 profile-detail tables (profile_addresses, profile_emergency_contacts,
// profile_allergies, profile_conditions, doctor_details, doctor_specialties,
// doctor_languages) were removed here and dropped by migration 0016. They
// duplicated the canonical patient_*/doctor_professional_* tables declared in
// schema-profile-details.ts, which are the ones the repositories and HTTP
// endpoints actually use.

export const storedObjects = pgTable('stored_objects', {
  objectId: uuid('object_id').primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  storageProvider: varchar('storage_provider', { length: 32 }).notNull(),
  bucket: varchar('bucket', { length: 128 }).notNull(),
  objectKey: varchar('object_key', { length: 512 }).notNull(),
  mediaType: varchar('media_type', { length: 160 }).notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  declaredSha256: varchar('declared_sha256', { length: 64 }).notNull(),
  verifiedSha256: varchar('verified_sha256', { length: 64 }),
  uploadStatus: storedObjectStatus('upload_status').notNull().default('pending'),
  scanState: malwareScanState('scan_state').notNull().default('not_scanned'),
  downloadable: boolean('downloadable').notNull().default(false),
  scannedAt: timestamp('scanned_at', { withTimezone: true }),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }),
  retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  uploadedByProfileId: uuid('uploaded_by_profile_id').notNull().references(() => profiles.profileId),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('stored_objects_location_uq').on(table.storageProvider, table.bucket, table.objectKey),
  uniqueIndex('stored_objects_object_key_uq').on(table.objectKey),
  uniqueIndex('stored_objects_id_organization_uq').on(table.objectId, table.organizationId),
  index('stored_objects_scan_queue_idx').on(table.scanState, table.uploadStatus, table.createdAt),
  index('stored_objects_uploader_idx').on(table.uploadedByProfileId, table.createdAt),
  index('stored_objects_retention_idx').on(table.retentionExpiresAt)
    .where(sql`retention_expires_at IS NOT NULL`),
  check('stored_objects_version_check', sql`${table.version} >= 0`),
  check('stored_objects_byte_size_check', sql`${table.byteSize} > 0`),
  check('stored_objects_declared_sha256_check', sql`${table.declaredSha256} ~ '^[0-9a-f]{64}$'`),
  check('stored_objects_verified_sha256_check', sql`${table.verifiedSha256} IS NULL OR ${table.verifiedSha256} ~ '^[0-9a-f]{64}$'`),
  check('stored_objects_downloadable_check', sql`${table.downloadable} = false OR (${table.uploadStatus} = 'finalized' AND ${table.scanState} = 'clean' AND ${table.verifiedSha256} IS NOT NULL AND ${table.verifiedSha256} = ${table.declaredSha256})`),
  check('stored_objects_finalized_checksum_check', sql`${table.uploadStatus} <> 'finalized' OR (${table.finalizedAt} IS NOT NULL AND ${table.verifiedSha256} IS NOT NULL)`),
  check('stored_objects_pending_finalized_at_check', sql`${table.finalizedAt} IS NULL OR ${table.uploadStatus} <> 'pending'`),
  check('stored_objects_scanned_at_check', sql`(${table.scanState} IN ('not_scanned', 'scanning')) = (${table.scannedAt} IS NULL)`),
  check('stored_objects_deleted_at_check', sql`(${table.uploadStatus} = 'deleted') = (${table.deletedAt} IS NOT NULL)`),
  check('stored_objects_quarantine_check', sql`(${table.quarantinedAt} IS NOT NULL) = (${table.uploadStatus} = 'quarantined')`),
  check('stored_objects_retention_order_check', sql`${table.retentionExpiresAt} IS NULL OR ${table.retentionExpiresAt} > ${table.createdAt}`),
  check('stored_objects_infected_not_downloadable_check', sql`${table.scanState} <> 'infected' OR ${table.downloadable} = false`),
]);

export const verificationDocuments = pgTable('verification_documents', {
  documentId: uuid('document_id').primaryKey(),
  membershipId: uuid('membership_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  objectId: uuid('object_id').notNull(),
  documentKind: verificationDocumentKind('document_kind').notNull(),
  status: verificationStatus('status').notNull().default('pending_review'),
  issuingAuthority: varchar('issuing_authority', { length: 160 }),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedByMembershipId: uuid('reviewed_by_membership_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewDecisionReason: varchar('review_decision_reason', { length: 128 }),
  reviewNote: text('review_note'),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    name: 'verification_documents_membership_org_fk',
    columns: [table.membershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  foreignKey({
    name: 'verification_documents_reviewer_org_fk',
    columns: [table.reviewedByMembershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  foreignKey({
    name: 'verification_documents_object_org_fk',
    columns: [table.objectId, table.organizationId],
    foreignColumns: [storedObjects.objectId, storedObjects.organizationId],
  }),
  uniqueIndex('verification_documents_object_uq').on(table.objectId),
  uniqueIndex('verification_documents_membership_kind_current_uq')
    .on(table.membershipId, table.documentKind)
    .where(sql`status IN ('pending_review', 'changes_requested', 'approved')`),
  index('verification_documents_queue_idx').on(table.organizationId, table.status, table.submittedAt),
  index('verification_documents_membership_kind_idx').on(table.membershipId, table.documentKind),
  index('verification_documents_expiry_idx').on(table.status, table.expiresAt),
  check('verification_documents_version_check', sql`${table.version} >= 0`),
  check('verification_documents_validity_order_check', sql`${table.issuedAt} IS NULL OR ${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.issuedAt}`),
  check('verification_documents_review_pair_check', sql`(${table.reviewedAt} IS NULL) = (${table.reviewedByMembershipId} IS NULL)`),
  check('verification_documents_review_status_check', sql`${table.reviewedAt} IS NULL OR ${table.status} IN ('changes_requested', 'approved', 'rejected', 'suspended')`),
  check('verification_documents_decision_reason_check', sql`${table.reviewDecisionReason} IS NULL OR ${table.reviewedAt} IS NOT NULL`),
  check('verification_documents_rejection_reason_check', sql`${table.status} NOT IN ('changes_requested', 'rejected') OR ${table.reviewDecisionReason} IS NOT NULL`),
]);

export const consentGrants = pgTable('consent_grants', {
  consentId: uuid('consent_id').primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  grantorProfileId: uuid('grantor_profile_id').notNull().references(() => profiles.profileId),
  granteeProfileId: uuid('grantee_profile_id').references(() => profiles.profileId),
  granteeMembershipId: uuid('grantee_membership_id'),
  scope: consentScope('scope').notNull(),
  purpose: varchar('purpose', { length: 160 }).notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revocationReason: consentRevocationReason('revocation_reason'),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    name: 'consent_grants_grantee_membership_org_fk',
    columns: [table.granteeMembershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  index('consent_grants_grantor_scope_idx').on(table.grantorProfileId, table.scope, table.revokedAt),
  index('consent_grants_grantee_membership_idx').on(table.granteeMembershipId, table.revokedAt),
  index('consent_grants_grantee_profile_idx').on(table.granteeProfileId, table.revokedAt),
  index('consent_grants_expiry_idx').on(table.expiresAt),
  uniqueIndex('consent_grants_active_profile_grantee_uq')
    .on(table.grantorProfileId, table.granteeProfileId, table.scope, table.purpose)
    .where(sql`revoked_at IS NULL AND grantee_profile_id IS NOT NULL`),
  uniqueIndex('consent_grants_active_membership_grantee_uq')
    .on(table.grantorProfileId, table.granteeMembershipId, table.scope, table.purpose)
    .where(sql`revoked_at IS NULL AND grantee_membership_id IS NOT NULL`),
  check('consent_grants_version_check', sql`${table.version} >= 0`),
  check('consent_grants_grantee_exclusive_check', sql`(${table.granteeProfileId} IS NOT NULL) <> (${table.granteeMembershipId} IS NOT NULL)`),
  check('consent_grants_self_grant_check', sql`${table.granteeProfileId} IS NULL OR ${table.granteeProfileId} <> ${table.grantorProfileId}`),
  check('consent_grants_expiry_order_check', sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.grantedAt}`),
  check('consent_grants_revocation_order_check', sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.grantedAt}`),
  check('consent_grants_revocation_reason_check', sql`(${table.revokedAt} IS NULL) = (${table.revocationReason} IS NULL)`),
]);

export const careAssignments = pgTable('care_assignments', {
  assignmentId: uuid('assignment_id').primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.organizationId),
  clinicianMembershipId: uuid('clinician_membership_id').notNull(),
  patientProfileId: uuid('patient_profile_id').notNull().references(() => profiles.profileId),
  status: careAssignmentStatus('status').notNull().default('active'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  endedReason: varchar('ended_reason', { length: 64 }),
  assignedByMembershipId: uuid('assigned_by_membership_id'),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({
    name: 'care_assignments_clinician_org_fk',
    columns: [table.clinicianMembershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  foreignKey({
    name: 'care_assignments_assigner_org_fk',
    columns: [table.assignedByMembershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  uniqueIndex('care_assignments_active_uq')
    .on(table.clinicianMembershipId, table.patientProfileId)
    .where(sql`status = 'active'`),
  index('care_assignments_patient_status_idx').on(table.patientProfileId, table.status),
  index('care_assignments_clinician_status_idx').on(table.clinicianMembershipId, table.status),
  index('care_assignments_org_assigned_idx').on(table.organizationId, table.assignedAt, table.assignmentId),
  check('care_assignments_version_check', sql`${table.version} >= 0`),
  check('care_assignments_ended_order_check', sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.assignedAt}`),
  check('care_assignments_lifecycle_check', sql`(${table.status} = 'active') = (${table.endedAt} IS NULL)`),
  check('care_assignments_ended_reason_check', sql`${table.endedReason} IS NULL OR ${table.endedAt} IS NOT NULL`),
]);
