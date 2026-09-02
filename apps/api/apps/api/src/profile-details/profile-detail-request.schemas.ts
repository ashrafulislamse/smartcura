import { z } from 'zod';
import {
  DOCTOR_DETAIL_REASON_CODES,
  PROFILE_DETAIL_REASON_CODES,
} from '@smartcura/database/profile-detail-events';

const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

/** Same E.164 shape the database enforces on every stored phone number. */
const phoneE164 = z.string().regex(/^\+[1-9][0-9]{7,14}$/);

/**
 * Calendar date, not an instant. A `Date` would carry a timezone the patient
 * never supplied, and an onset date is a day, not a moment.
 */
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().startsWith(value);
});

/**
 * Coordinates stay decimal strings end to end, matching the `numeric` column.
 * Parsing them into a float here and re-serializing would change the stored value
 * for some inputs, which is exactly what the column type exists to prevent.
 */
const latitude = z.string().regex(/^-?(?:90(?:\.0{1,6})?|[1-8]?\d(?:\.\d{1,6})?)$/);
const longitude = z.string().regex(/^-?(?:180(?:\.0{1,6})?|1[0-7]\d(?:\.\d{1,6})?|\d{1,2}(?:\.\d{1,6})?)$/);

const expectedVersion = z.number().int().min(0);

/**
 * Every mutation carries a structured reason code and never operator or patient
 * free text. Audit rows are retained broadly, and a free-text field on a form
 * that sits beside an allergy or a condition is the most likely route for
 * clinical detail to leak into them.
 */
const profileDetailReason = z.enum(PROFILE_DETAIL_REASON_CODES);

export const profileDetailPathSchema = z.object({
  detailId: uuidV7,
}).strict();

/** DELETE carries its concurrency token and reason in the query string. */
export const removeProfileDetailQuerySchema = z.object({
  expected_version: z.coerce.number().int().min(0),
  reason_code: profileDetailReason,
}).strict();

const addressFields = {
  label: z.string().trim().min(1).max(80).nullable().default(null),
  line1: z.string().trim().min(1).max(160),
  line2: z.string().trim().min(1).max(160).nullable().default(null),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(120),
  postcode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/),
  country_code: z.string().regex(/^[A-Z]{2}$/).default('MY'),
  is_primary: z.boolean().default(false),
  latitude: latitude.nullable().default(null),
  longitude: longitude.nullable().default(null),
  reason_code: profileDetailReason,
};

/** Half a coordinate pair is not a location; the column check says the same. */
const coordinatePair = <Shape extends { latitude: string | null; longitude: string | null }>(
  value: Shape,
): boolean => (value.latitude === null) === (value.longitude === null);

export const createAddressSchema = z.object(addressFields).strict().refine(coordinatePair);

export const updateAddressSchema = z.object({
  ...addressFields,
  expected_version: expectedVersion,
}).strict().refine(coordinatePair);

const emergencyContactFields = {
  name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().min(1).max(64),
  phone_e164: phoneE164,
  is_primary: z.boolean().default(false),
  reason_code: profileDetailReason,
};

export const createEmergencyContactSchema = z.object(emergencyContactFields).strict();

export const updateEmergencyContactSchema = z.object({
  ...emergencyContactFields,
  expected_version: expectedVersion,
}).strict();

/**
 * `noted_by_profile_id` is deliberately NOT accepted from the client. Attribution
 * is derived from the authenticated session, because a request that could name
 * any profile as the noter would let a patient attribute their own entry to a
 * clinician who never saw it.
 */
const allergyFields = {
  substance: z.string().trim().min(1).max(160),
  reaction: z.string().trim().min(1).max(240).nullable().default(null),
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']),
  recorded_at: z.string().datetime({ offset: true }).optional(),
  reason_code: profileDetailReason,
};

export const createAllergySchema = z.object(allergyFields).strict();

export const updateAllergySchema = z.object({
  ...allergyFields,
  expected_version: expectedVersion,
}).strict();

const conditionFields = {
  condition_name: z.string().trim().min(1).max(200),
  status: z.enum(['active', 'resolved', 'in_remission']),
  onset_date: calendarDate.nullable().default(null),
  resolved_date: calendarDate.nullable().default(null),
  notes: z.string().trim().min(1).max(2000).nullable().default(null),
  reason_code: profileDetailReason,
};

/**
 * Mirrors `patient_conditions_resolved_status_check` and its ordering rule.
 * Rejecting here returns VALIDATION_FAILED instead of surfacing a constraint
 * violation as a 500, and keeps the two definitions of "resolved" in step.
 */
const resolutionConsistent = <
  Shape extends {
    status: 'active' | 'resolved' | 'in_remission';
    onset_date: string | null;
    resolved_date: string | null;
  },
>(value: Shape): boolean => {
  if (value.resolved_date === null) return value.status !== 'resolved';
  if (value.status !== 'resolved') return false;
  return value.onset_date === null || value.resolved_date >= value.onset_date;
};

export const createConditionSchema = z.object(conditionFields)
  .strict().refine(resolutionConsistent);

export const updateConditionSchema = z.object({
  ...conditionFields,
  expected_version: expectedVersion,
}).strict().refine(resolutionConsistent);

const specialtyCode = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const languageCode = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

export const doctorDetailPathSchema = z.object({
  membershipId: uuidV7,
}).strict();

/**
 * Money is an integer count of MYR sen, and the currency is not a request field:
 * accepting one would imply the platform can price in something else.
 * `consultation_fee_sen` is bounded to the same ceiling as the column check so a
 * ringgit-for-sen mistake is rejected at the edge.
 */
export const saveDoctorDetailSchema = z.object({
  biography: z.string().trim().min(1).max(4000).nullable().default(null),
  years_experience: z.number().int().min(0).max(80),
  consultation_fee_sen: z.number().int().min(0).max(10_000_000),
  accepts_new_patients: z.boolean(),
  specialties: z.array(z.object({
    code: specialtyCode,
    is_primary: z.boolean().default(false),
  }).strict()).max(20).refine(
    (values) => new Set(values.map((value) => value.code)).size === values.length,
  ).refine(
    // At most one primary, mirroring `doctor_professional_specialties_primary_uq`.
    (values) => values.filter((value) => value.is_primary).length <= 1,
  ),
  languages: z.array(languageCode).max(20).refine(
    (values) => new Set(values).size === values.length,
  ),
  expected_version: expectedVersion,
  reason_code: z.enum(DOCTOR_DETAIL_REASON_CODES),
}).strict();

export type RemoveProfileDetailQuery = z.infer<typeof removeProfileDetailQuerySchema>;
export type CreateAddressRequest = z.infer<typeof createAddressSchema>;
export type UpdateAddressRequest = z.infer<typeof updateAddressSchema>;
export type CreateEmergencyContactRequest = z.infer<typeof createEmergencyContactSchema>;
export type UpdateEmergencyContactRequest = z.infer<typeof updateEmergencyContactSchema>;
export type CreateAllergyRequest = z.infer<typeof createAllergySchema>;
export type UpdateAllergyRequest = z.infer<typeof updateAllergySchema>;
export type CreateConditionRequest = z.infer<typeof createConditionSchema>;
export type UpdateConditionRequest = z.infer<typeof updateConditionSchema>;
export type SaveDoctorDetailRequest = z.infer<typeof saveDoctorDetailSchema>;
