import { sql } from 'drizzle-orm';
import {
  check, foreignKey, index, integer, pgTable, primaryKey, text,
  timestamp, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';
import { appointments } from './schema-appointments.js';
import { organizationMemberships, profiles } from './schema.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const doctorReviews = pgTable('doctor_reviews', {
  reviewId: uuid('review_id').primaryKey(),
  appointmentId: uuid('appointment_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  doctorMembershipId: uuid('doctor_membership_id').notNull(),
  patientProfileId: uuid('patient_profile_id').notNull(),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('doctor_reviews_appointment_uq').on(table.appointmentId),
  foreignKey({
    name: 'doctor_reviews_appointment_participants_org_fk',
    columns: [
      table.appointmentId, table.doctorMembershipId,
      table.patientProfileId, table.organizationId,
    ],
    foreignColumns: [
      appointments.appointmentId, appointments.doctorMembershipId,
      appointments.patientProfileId, appointments.organizationId,
    ],
  }),
  foreignKey({
    name: 'doctor_reviews_doctor_org_fk',
    columns: [table.doctorMembershipId, table.organizationId],
    foreignColumns: [organizationMemberships.membershipId, organizationMemberships.organizationId],
  }),
  foreignKey({
    name: 'doctor_reviews_patient_fk',
    columns: [table.patientProfileId],
    foreignColumns: [profiles.profileId],
  }),
  index('doctor_reviews_doctor_created_idx').on(
    table.doctorMembershipId, table.createdAt, table.reviewId,
  ),
  index('doctor_reviews_doctor_rating_idx').on(table.doctorMembershipId, table.rating),
  check('doctor_reviews_rating_check', sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
  check('doctor_reviews_comment_check', sql`${table.comment} IS NULL OR char_length(${table.comment}) BETWEEN 1 AND 1000`),
  check('doctor_reviews_tags_count_check', sql`cardinality(${table.tags}) <= 5`),
  check('doctor_reviews_tags_allowed_check', sql`${table.tags} <@ ARRAY['good_listener','on_time','clear_explanation','professional','helpful']::text[]`),
  check('doctor_reviews_version_check', sql`${table.version} >= 0`),
]);
