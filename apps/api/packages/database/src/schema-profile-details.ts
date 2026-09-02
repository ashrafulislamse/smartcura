/**
 * WP-04a drizzle table definitions: extended patient profile data and doctor
 * professional detail. Mirrors migration
 * `drizzle/0015_patient_profile_data.sql` exactly.
 *
 * These live in their own module, not in `schema.ts`, only because `schema.ts` is
 * being edited concurrently. `HANDOFF-0011.md` lists the re-exports to add there
 * so `drizzle-kit generate` sees one schema graph again. Until those re-exports
 * exist, drizzle-kit will not know about these tables and would try to drop
 * them: do not run `db:generate` before wiring the re-export.
 *
 * Table names are prefixed (`patient_*`, `doctor_professional_*`) to avoid
 * colliding with the similarly-shaped tables migration 0011 creates. See
 * HANDOFF-0011.md for the overlap that needs reconciling.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { allergySeverity, organizationMemberships, profiles } from './schema.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * `in_remission` is why this vocabulary is not `clinical_record_status`.
 * Remission is not resolution: the condition is clinically inactive but expected
 * to recur, so it carries no resolution date and must not be folded into
 * `resolved`.
 */
export const patientConditionStatus = pgEnum('patient_condition_status', [
  'active', 'resolved', 'in_remission',
]);

/**
 * Addresses owned by a profile. Hard-deleted by the API: an address is contact
 * data, not clinical history. See `patient-profile-repository.ts`.
 */
export const patientAddresses = pgTable('patient_addresses', {
  addressId: uuid('address_id').primaryKey(),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  label: varchar('label', { length: 80 }),
  line1: varchar('line1', { length: 160 }).notNull(),
  line2: varchar('line2', { length: 160 }),
  city: varchar('city', { length: 120 }).notNull(),
  state: varchar('state', { length: 120 }).notNull(),
  postcode: varchar('postcode', { length: 16 }).notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull().default('MY'),
  isPrimary: boolean('is_primary').notNull().default(false),
  // Numeric, not float: coordinates are compared for equality when
  // de-duplicating pinned locations, and binary floating point makes that
  // comparison depend on how the value was parsed.
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index('patient_addresses_profile_idx').on(table.profileId, table.isPrimary),
  // At most one primary per profile, enforced by the database because two
  // concurrent promotions would otherwise both succeed.
  uniqueIndex('patient_addresses_primary_uq')
    .on(table.profileId)
    .where(sql`is_primary`),
  check('patient_addresses_version_check', sql`${table.version} >= 0`),
  check('patient_addresses_country_code_check', sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
  check('patient_addresses_postcode_check', sql`${table.postcode} ~ '^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$'`),
  check('patient_addresses_latitude_check', sql`${table.latitude} IS NULL OR (${table.latitude} >= -90 AND ${table.latitude} <= 90)`),
  check('patient_addresses_longitude_check', sql`${table.longitude} IS NULL OR (${table.longitude} >= -180 AND ${table.longitude} <= 180)`),
  // Half a coordinate pair is not a location.
  check('patient_addresses_coordinate_pair_check', sql`(${table.latitude} IS NULL) = (${table.longitude} IS NULL)`),
]);

/**
 * Emergency contacts owned by a profile. Hard-deleted by the API: a removed
 * contact must genuinely stop being called.
 */
export const patientEmergencyContacts = pgTable('patient_emergency_contacts', {
  contactId: uuid('contact_id').primaryKey(),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  name: varchar('name', { length: 120 }).notNull(),
  relationship: varchar('relationship', { length: 64 }).notNull(),
  phoneE164: varchar('phone_e164', { length: 16 }).notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index('patient_emergency_contacts_profile_idx').on(table.profileId, table.isPrimary),
  uniqueIndex('patient_emergency_contacts_primary_uq')
    .on(table.profileId)
    .where(sql`is_primary`),
  check('patient_emergency_contacts_version_check', sql`${table.version} >= 0`),
  // Same E.164 pattern as `profiles.phone_e164`, but NOT NULL: a contact that
  // cannot be dialled is not a contact.
  check('patient_emergency_contacts_phone_e164_check', sql`${table.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
]);

/**
 * Allergy list entries owned by a profile. Soft-deleted (`deletedAt`) because an
 * allergy a clinician has seen is clinical history.
 */
export const patientAllergies = pgTable('patient_allergies', {
  allergyId: uuid('allergy_id').primaryKey(),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  substance: varchar('substance', { length: 160 }).notNull(),
  reaction: varchar('reaction', { length: 240 }),
  // Reuses the `allergy_severity` enum rather than redefining the vocabulary:
  // severity is compared across records during triage.
  severity: allergySeverity('severity').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  // Nullable: a patient-entered allergy has no separate noter, and that
  // difference is clinically meaningful.
  notedByProfileId: uuid('noted_by_profile_id').references(() => profiles.profileId),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index('patient_allergies_profile_idx')
    .on(table.profileId, table.severity)
    .where(sql`deleted_at IS NULL`),
  index('patient_allergies_noted_by_idx').on(table.notedByProfileId),
  // One live row per substance: duplicate entries with different severities give
  // a clinician no way to tell which is current.
  uniqueIndex('patient_allergies_live_substance_uq')
    .on(table.profileId, table.substance)
    .where(sql`deleted_at IS NULL`),
  check('patient_allergies_version_check', sql`${table.version} >= 0`),
]);

/** Condition list entries owned by a profile. Soft-deleted for the same reason. */
export const patientConditions = pgTable('patient_conditions', {
  conditionId: uuid('condition_id').primaryKey(),
  profileId: uuid('profile_id').notNull().references(() => profiles.profileId),
  conditionName: varchar('condition_name', { length: 200 }).notNull(),
  status: patientConditionStatus('status').notNull().default('active'),
  onsetDate: date('onset_date'),
  resolvedDate: date('resolved_date'),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index('patient_conditions_profile_idx')
    .on(table.profileId, table.status)
    .where(sql`deleted_at IS NULL`),
  uniqueIndex('patient_conditions_live_name_uq')
    .on(table.profileId, table.conditionName)
    .where(sql`deleted_at IS NULL`),
  check('patient_conditions_version_check', sql`${table.version} >= 0`),
  // A resolution date on an active or in-remission condition reads as "ongoing"
  // and "finished on this date" at once.
  check('patient_conditions_resolved_status_check', sql`${table.resolvedDate} IS NULL OR ${table.status} = 'resolved'`),
  check('patient_conditions_resolved_order_check', sql`${table.resolvedDate} IS NULL OR ${table.onsetDate} IS NULL OR ${table.resolvedDate} >= ${table.onsetDate}`),
]);

/**
 * Professional detail for a doctor MEMBERSHIP, not a profile. One profile may
 * hold several memberships, and a biography, fee and availability flag belong to
 * the organization the doctor practises in.
 */
export const doctorProfessionalDetails = pgTable('doctor_professional_details', {
  membershipId: uuid('membership_id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  biography: text('biography'),
  yearsExperience: integer('years_experience').notNull().default(0),
  // Integer MYR sen. `mode: 'number'` is safe here because the ceiling check
  // keeps values far inside the safe-integer range.
  consultationFeeSen: bigint('consultation_fee_sen', { mode: 'number' }).notNull().default(0),
  currency: varchar('currency', { length: 3 }).notNull().default('MYR'),
  acceptsNewPatients: boolean('accepts_new_patients').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  // Composite: the detail row must belong to the same organization as the
  // membership it describes.
  foreignKey({
    name: 'doctor_professional_details_membership_org_fk',
    columns: [table.membershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  uniqueIndex('doctor_professional_details_membership_org_uq').on(
    table.membershipId, table.organizationId,
  ),
  index('doctor_professional_details_org_fee_idx').on(
    table.organizationId, table.acceptsNewPatients, table.consultationFeeSen,
  ),
  index('doctor_professional_details_biography_trgm_idx').using(
    'gin', sql`COALESCE(${table.biography}, '') gin_trgm_ops`,
  ),
  check('doctor_professional_details_version_check', sql`${table.version} >= 0`),
  check('doctor_professional_details_experience_check', sql`${table.yearsExperience} >= 0 AND ${table.yearsExperience} <= 80`),
  check('doctor_professional_details_fee_check', sql`${table.consultationFeeSen} >= 0`),
  // Keeps a unit mistake (ringgit entered as sen) out of payment authorization.
  check('doctor_professional_details_fee_ceiling_check', sql`${table.consultationFeeSen} <= 10000000`),
  check('doctor_professional_details_currency_check', sql`${table.currency} = 'MYR'`),
]);

/** Normalized specialty codes, so discovery can index and join on them. */
export const doctorProfessionalSpecialties = pgTable('doctor_professional_specialties', {
  membershipId: uuid('membership_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  specialtyCode: varchar('specialty_code', { length: 64 }).notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({
    name: 'doctor_professional_specialties_pk',
    columns: [table.membershipId, table.specialtyCode],
  }),
  foreignKey({
    name: 'doctor_professional_specialties_doctor_org_fk',
    columns: [table.membershipId, table.organizationId],
    foreignColumns: [
      doctorProfessionalDetails.membershipId,
      doctorProfessionalDetails.organizationId,
    ],
  }),
  index('doctor_professional_specialties_code_idx').on(
    table.specialtyCode, table.organizationId,
  ),
  uniqueIndex('doctor_professional_specialties_primary_uq')
    .on(table.membershipId)
    .where(sql`is_primary`),
  check('doctor_professional_specialties_code_check', sql`${table.specialtyCode} ~ '^[a-z][a-z0-9_]{1,62}$'`),
]);

/** Normalized BCP 47 language codes for the same reason as specialties. */
export const doctorProfessionalLanguages = pgTable('doctor_professional_languages', {
  membershipId: uuid('membership_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  languageCode: varchar('language_code', { length: 35 }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({
    name: 'doctor_professional_languages_pk',
    columns: [table.membershipId, table.languageCode],
  }),
  foreignKey({
    name: 'doctor_professional_languages_doctor_org_fk',
    columns: [table.membershipId, table.organizationId],
    foreignColumns: [
      doctorProfessionalDetails.membershipId,
      doctorProfessionalDetails.organizationId,
    ],
  }),
  index('doctor_professional_languages_code_idx').on(
    table.languageCode, table.organizationId,
  ),
  check('doctor_professional_languages_code_check', sql`${table.languageCode} ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'`),
]);
