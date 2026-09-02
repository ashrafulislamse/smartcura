/**
 * Drizzle declarations for the WP-04b verification review history.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * `schema.ts` already declares `storedObjects` and `verificationDocuments` from
 * migration 0011 and is owned by another work package in flight. Only the new
 * table lives here. The 0011 tables are IMPORTED rather than re-declared: two
 * declarations of one physical table would let the drizzle snapshot disagree
 * with itself, and `drizzle-kit generate` would then emit destructive DDL.
 *
 * Migration 0012 additionally ALTERs `stored_objects` (adds `quarantined_at`,
 * `retention_expires_at`, a quarantine equivalence check, an
 * infected-not-downloadable check and a unique index on `object_key`) and
 * `verification_documents` (pins `review_decision_reason` to the fixed reason
 * code list and forces `review_note` to NULL). Those columns and constraints
 * must be folded into the `schema.ts` declarations by whoever owns that file -
 * see `HANDOFF-0012.md`.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { profiles, verificationDocuments, verificationStatus } from './schema.js';

/**
 * Structured, PHI-free reasons for a verification review decision.
 *
 * Free text is deliberately impossible. Review outcomes are shown to the
 * applicant and retained in broadly readable history, and operators cannot be
 * relied upon to keep identity or clinical detail out of an open string field.
 * The same list is a CHECK constraint on `verification_reviews.reason_code` and
 * on `verification_documents.review_decision_reason`, so the vocabulary is
 * enforced by the database rather than by request validation alone.
 */
export const VERIFICATION_REASON_CODES = [
  'document_illegible',
  'document_expired',
  'name_mismatch',
  'wrong_document_type',
  'suspected_forgery',
  'licence_not_verifiable',
  'approved_verified',
  'administrative_request',
  'policy_violation',
] as const;

export type VerificationReasonCode = typeof VERIFICATION_REASON_CODES[number];

/**
 * Append-only review history.
 *
 * `verification_documents` carries only the CURRENT decision, which cannot
 * answer "who approved this licence, when, and on what grounds" once a later
 * suspension has overwritten it. A row is written here inside the same
 * transaction as every document status change, and migration 0012 installs
 * `verification_reviews_reject_mutation` so UPDATE and DELETE are refused by the
 * database - a history that can be edited is not evidence.
 */
export const verificationReviews = pgTable('verification_reviews', {
  reviewId: uuid('review_id').primaryKey(),
  documentId: uuid('document_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  /**
   * The reviewer's durable PROFILE, not their membership: a membership can be
   * revoked and re-created, which would leave history pointing at a row that no
   * longer describes the human who decided. The authorising membership is
   * captured in the audit log row written in the same transaction.
   */
  reviewerProfileId: uuid('reviewer_profile_id').notNull(),
  previousStatus: verificationStatus('previous_status').notNull(),
  nextStatus: verificationStatus('next_status').notNull(),
  reasonCode: varchar('reason_code', { length: 64 }).notNull(),
  correlationId: uuid('correlation_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    // Composite: the history row, the document and the organization must agree.
    // A single-column document reference would let organization A's history
    // claim a document owned by organization B.
    name: 'verification_reviews_document_org_fk',
    columns: [table.documentId, table.organizationId],
    foreignColumns: [verificationDocuments.documentId, verificationDocuments.organizationId],
  }),
  foreignKey({
    name: 'verification_reviews_reviewer_profile_id_profiles_profile_id_fk',
    columns: [table.reviewerProfileId],
    foreignColumns: [profiles.profileId],
  }),
  index('verification_reviews_document_idx').on(
    table.documentId, table.occurredAt, table.reviewId,
  ),
  index('verification_reviews_org_occurred_idx').on(
    table.organizationId, table.occurredAt, table.reviewId,
  ),
  index('verification_reviews_reviewer_idx').on(table.reviewerProfileId, table.occurredAt),
  index('verification_reviews_correlation_idx').on(table.correlationId),
  check(
    'verification_reviews_status_change_check',
    sql`${table.previousStatus} <> ${table.nextStatus}`,
  ),
  check(
    'verification_reviews_reason_code_check',
    sql`${table.reasonCode} IN ('document_illegible', 'document_expired', 'name_mismatch', 'wrong_document_type', 'suspected_forgery', 'licence_not_verifiable', 'approved_verified', 'administrative_request', 'policy_violation')`,
  ),
  check(
    'verification_reviews_approval_reason_check',
    sql`(${table.nextStatus} = 'approved') = (${table.reasonCode} = 'approved_verified')`,
  ),
  check(
    'verification_reviews_next_status_check',
    sql`${table.nextStatus} IN ('changes_requested', 'approved', 'rejected', 'suspended', 'expired')`,
  ),
]);
