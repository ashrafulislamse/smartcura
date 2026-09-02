-- WP-04b: professional verification review workflow and the private file
-- pipeline (request upload -> finalize with checksum proof -> malware scan ->
-- short-lived pre-signed download).
--
-- RECONCILIATION NOTICE - READ BEFORE EDITING
-- -------------------------------------------
-- `stored_objects` and `verification_documents` were already created by
-- migration 0011, together with the `stored_object_status`,
-- `malware_scan_state`, `verification_status` and `verification_document_kind`
-- enums and the `verification.document:*` / `file.object:*` permission seed.
-- This migration therefore EXTENDS that schema instead of creating it a second
-- time. Re-declaring either table under the WP-04b column names would have
-- produced two parallel vocabularies for one concept, and the download
-- invariant would then depend on which table a given code path happened to
-- read. The WP-04b column list maps onto 0011 as follows:
--
--   requested            existing (0011)            note
--   ------------------   ------------------------   ---------------------------
--   owner_profile_id     uploaded_by_profile_id     same fact, existing name
--   storage_key          object_key                 unique index added below
--   content_type         media_type                 same fact, existing name
--   sha256               declared_sha256 +          declared at request time,
--                        verified_sha256            verified at finalize
--   upload_state         upload_status              'rejected' added below
--   scan_state           scan_state                 pending  = not_scanned
--                                                   failed   = scan_failed
--   finalized => sha256  stored_objects_finalized_checksum_check (0011)
--
-- Deliberate deviations from the WP-04b brief, each with its reason:
--   * `organization_id` stays NOT NULL. 0011 built the cross-organization guard
--     out of COMPOSITE foreign keys on (object_id, organization_id) and
--     (membership_id, organization_id). A nullable organization column makes
--     those MATCH SIMPLE keys unenforced, which would silently reopen the
--     "organization A points a document at organization B's file" hole that
--     `verification_documents_object_org_fk` exists to close.
--   * No second `stored_objects_finalized_*_check` is added; 0011 already
--     forbids `finalized` without a verified digest, and a duplicate constraint
--     would just be a second thing to keep in step.
--   * No new permission ids. 0011 already seeded the exact WP-04b capability
--     set under the project's canonical `resource.subresource:action:scope`
--     naming, and granted review to `admin` at organization scope and to
--     `super_admin` at global scope. The seed below re-asserts those rows
--     idempotently and then ASSERTS the grants, rather than introducing an
--     `verification:*` / `object:*` alias vocabulary that would leave every
--     role holding two permission ids for one action.
--
-- Preflight. This migration ALTERs two tables it does not own and creates one
-- append-only table, so every precondition is asserted first with a specific
-- message, following the precedent set by migrations 0008 and 0011.
DO $$
DECLARE
  server_version integer;
  missing_tables text;
  missing_roles text;
BEGIN
  -- `verification_reviews.review_id` is written by the built-in `uuidv7()`,
  -- which does not exist before PostgreSQL 18.
  SELECT current_setting('server_version_num')::integer INTO server_version;
  IF server_version < 180000 THEN
    RAISE EXCEPTION
      'Migration 0012 aborted: PostgreSQL 18 or newer is required for built-in uuidv7(), found server_version_num=%.',
      server_version;
  END IF;

  SELECT COALESCE(string_agg(required.table_name, ', ' ORDER BY required.table_name), '')
  INTO missing_tables
  FROM (VALUES
    ('stored_objects'), ('verification_documents'), ('organization_memberships'),
    ('profiles'), ('organizations'), ('audit_logs'), ('outbox_events'),
    ('idempotency_keys')
  ) AS required(table_name)
  WHERE to_regclass('public.' || required.table_name) IS NULL;

  IF missing_tables <> '' THEN
    RAISE EXCEPTION
      'Migration 0012 aborted: required table(s) missing: %. Migrations 0000-0011 must be applied before this migration.',
      missing_tables;
  END IF;

  -- CREATE TABLE below is deliberately not IF NOT EXISTS: silently skipping it
  -- would leave the schema out of step with the drizzle snapshot.
  IF to_regclass('public.verification_reviews') IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0012 aborted: table verification_reviews already exists from a partially applied attempt. Drop it deliberately or repair the drizzle journal before retrying.';
  END IF;

  -- The permission re-assertion at the end has a foreign key to roles.
  SELECT COALESCE(string_agg(expected.role_id, ', ' ORDER BY expected.role_id), '')
  INTO missing_roles
  FROM (VALUES
    ('patient'), ('doctor'), ('driver'), ('pharmacy'),
    ('emergency'), ('admin'), ('super_admin')
  ) AS expected(role_id)
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE roles.role_id = expected.role_id);

  IF missing_roles <> '' THEN
    RAISE EXCEPTION
      'Migration 0012 aborted: required system role(s) missing from roles: %. Migration 0004 must be applied before this migration.',
      missing_roles;
  END IF;

  -- `verification_status` is REUSED for review history. If the enum ever loses a
  -- label the history table would silently narrow, so the vocabulary is pinned.
  IF NOT EXISTS (
    SELECT 1 FROM pg_type AS t
    JOIN pg_enum AS e ON e.enumtypid = t.oid
    WHERE t.typname = 'verification_status' AND e.enumlabel = 'changes_requested'
  ) THEN
    RAISE EXCEPTION
      'Migration 0012 aborted: enum verification_status is missing the changes_requested label.';
  END IF;
END;
$$;--> statement-breakpoint
-- A checksum mismatch at finalize is not a malware verdict and not a deletion,
-- so it needs its own terminal upload state. `rejected` can never be
-- downloadable, because `stored_objects_downloadable_check` (0011) admits only
-- `finalized`.
--
-- NOTE: the new label is added but deliberately not referenced anywhere else in
-- this migration. PostgreSQL forbids USING an enum label in the same
-- transaction that added it to a pre-existing type, and the drizzle migrator
-- applies pending migrations inside one transaction.
ALTER TYPE "public"."stored_object_status" ADD VALUE IF NOT EXISTS 'rejected';--> statement-breakpoint
-- Quarantine is recorded as its own timestamp rather than inferred from
-- `scan_state = 'infected'`: retention and incident response need to know WHEN
-- the file was isolated, and a later re-scan must not erase that fact.
ALTER TABLE "stored_objects" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
-- Retention is expressed on the object, not on the document, because the bytes
-- are what a retention rule deletes. NULL means "no scheduled expiry yet".
ALTER TABLE "stored_objects" ADD COLUMN "retention_expires_at" timestamp with time zone;--> statement-breakpoint
-- Quarantine timestamp and quarantine state are the same fact. Binding them
-- stops "quarantined with no isolation time" and "isolated but still servable"
-- rows, either of which would make the download predicate answer differently
-- depending on which column it trusted.
ALTER TABLE "stored_objects" ADD CONSTRAINT "stored_objects_quarantine_check" CHECK (("stored_objects"."quarantined_at" IS NOT NULL) = ("stored_objects"."upload_status" = 'quarantined'));--> statement-breakpoint
ALTER TABLE "stored_objects" ADD CONSTRAINT "stored_objects_retention_order_check" CHECK ("stored_objects"."retention_expires_at" IS NULL OR "stored_objects"."retention_expires_at" > "stored_objects"."created_at");--> statement-breakpoint
-- An infected object must never be left in a servable state. This is the second
-- half of the download invariant: 0011 refuses to CALL an object downloadable
-- unless it is finalized and clean, and this refuses to leave `downloadable`
-- true once a scan has come back infected.
ALTER TABLE "stored_objects" ADD CONSTRAINT "stored_objects_infected_not_downloadable_check" CHECK ("stored_objects"."scan_state" <> 'infected' OR "stored_objects"."downloadable" = false);--> statement-breakpoint
-- The storage key alone is globally unique, not merely unique per
-- provider+bucket. Keys are opaque generated paths, so a collision can only mean
-- two metadata rows describing one physical file, and the download path would
-- then depend on which row was read. 0011's `stored_objects_location_uq` is
-- kept: it still guards a provider or bucket move.
CREATE UNIQUE INDEX "stored_objects_object_key_uq" ON "stored_objects" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "stored_objects_retention_idx" ON "stored_objects" USING btree ("retention_expires_at") WHERE "retention_expires_at" IS NOT NULL;--> statement-breakpoint
-- Structured reason codes only. Review outcomes are shown to the applicant and
-- retained in broadly readable audit history, so an open string field is an
-- unacceptable route for clinical or identity detail to leak. This is the
-- database half of `VERIFICATION_REASON_CODES`; the API half is a zod enum.
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_reason_code_check" CHECK ("verification_documents"."review_decision_reason" IS NULL OR "verification_documents"."review_decision_reason" IN ('document_illegible', 'document_expired', 'name_mismatch', 'wrong_document_type', 'suspected_forgery', 'licence_not_verifiable', 'approved_verified', 'administrative_request', 'policy_violation'));--> statement-breakpoint
-- `review_note` is forced to NULL rather than dropped. Dropping a column that
-- another work package's drizzle snapshot still declares would put the schema
-- and the snapshot out of step; forcing it empty makes free text impossible now
-- and leaves the column removal to a deliberate, snapshot-aligned change.
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_review_note_free_text_check" CHECK ("verification_documents"."review_note" IS NULL);--> statement-breakpoint
-- Needed BEFORE the composite foreign key from verification_reviews.
-- PostgreSQL requires a unique index on exactly the referenced column list.
CREATE UNIQUE INDEX "verification_documents_id_organization_uq" ON "verification_documents" USING btree ("document_id","organization_id");--> statement-breakpoint
-- Append-only review history. `verification_documents` holds only the CURRENT
-- decision, which is not enough to answer "who approved this licence, when, and
-- on what grounds" after a later suspension overwrote it. Every reviewer
-- transition writes exactly one row here inside the same transaction as the
-- document update, so the history cannot diverge from the state it explains.
CREATE TABLE "verification_reviews" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"reviewer_profile_id" uuid NOT NULL,
	"previous_status" "verification_status" NOT NULL,
	"next_status" "verification_status" NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- A review that changes nothing is not a review. Recording no-ops here would
	-- pad the history that an auditor has to read.
	CONSTRAINT "verification_reviews_status_change_check" CHECK ("verification_reviews"."previous_status" <> "verification_reviews"."next_status"),
	-- Same fixed vocabulary as the document's own reason code. Free text is
	-- impossible by construction, not by convention.
	CONSTRAINT "verification_reviews_reason_code_check" CHECK ("verification_reviews"."reason_code" IN ('document_illegible', 'document_expired', 'name_mismatch', 'wrong_document_type', 'suspected_forgery', 'licence_not_verifiable', 'approved_verified', 'administrative_request', 'policy_violation')),
	-- An approval may only ever be recorded as a positive verification, and a
	-- positive verification may not be used to justify anything else. Without
	-- this, "approved because suspected_forgery" would be storable and the
	-- history would stop being reviewable.
	CONSTRAINT "verification_reviews_approval_reason_check" CHECK (("verification_reviews"."next_status" = 'approved') = ("verification_reviews"."reason_code" = 'approved_verified')),
	-- A review cannot land in a pre-decision state: those describe a document
	-- nobody has decided on yet.
	CONSTRAINT "verification_reviews_next_status_check" CHECK ("verification_reviews"."next_status" IN ('changes_requested', 'approved', 'rejected', 'suspended', 'expired'))
);
--> statement-breakpoint
-- Composite: the history row, the document and the organization must agree. A
-- single-column document reference would let organization A's review history
-- claim a document that belongs to organization B.
ALTER TABLE "verification_reviews" ADD CONSTRAINT "verification_reviews_document_org_fk" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."verification_documents"("document_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The reviewer is recorded as a PROFILE, not a membership. A membership can be
-- revoked and re-created, which would leave history pointing at a row that no
-- longer describes the human who made the decision; the profile is the durable
-- identity. The membership that authorised the action is captured in the audit
-- log entry written in the same transaction.
ALTER TABLE "verification_reviews" ADD CONSTRAINT "verification_reviews_reviewer_profile_id_profiles_profile_id_fk" FOREIGN KEY ("reviewer_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_reviews_document_idx" ON "verification_reviews" USING btree ("document_id","occurred_at","review_id");--> statement-breakpoint
CREATE INDEX "verification_reviews_org_occurred_idx" ON "verification_reviews" USING btree ("organization_id","occurred_at","review_id");--> statement-breakpoint
CREATE INDEX "verification_reviews_reviewer_idx" ON "verification_reviews" USING btree ("reviewer_profile_id","occurred_at");--> statement-breakpoint
CREATE INDEX "verification_reviews_correlation_idx" ON "verification_reviews" USING btree ("correlation_id");--> statement-breakpoint
-- Append-only enforced in the database, following the
-- `audit_logs_reject_mutation` (0001) and `session_events_reject_mutation`
-- (0004) precedent. Application discipline is not sufficient: a review history
-- that can be edited is not evidence, and the whole reason this table exists is
-- to be evidence.
CREATE OR REPLACE FUNCTION smartcura_reject_verification_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'verification_reviews are append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER verification_reviews_reject_mutation
BEFORE UPDATE OR DELETE ON verification_reviews
FOR EACH ROW EXECUTE FUNCTION smartcura_reject_verification_review_mutation();
--> statement-breakpoint
-- Permission re-assertion for the WP-04b capability set, following the
-- 0007/0009 seed pattern. These ids were introduced by 0011; re-asserting them
-- here keeps this migration self-describing and idempotent without creating a
-- second naming for the same capability. Every id is an EXPLICIT
-- `resource[.subresource]:action[:scope]` triple - no `*` action is introduced,
-- because `permissionMatches` treats `*` as matching every present and future
-- action, which is exactly what 0009/0010 removed.
INSERT INTO permissions (permission_id, description)
VALUES
  ('verification.document:submit:own', 'Upload and submit a verification document for the authenticated profile''s membership'),
  ('verification.document:read:own', 'Read the authenticated profile''s own verification documents and their status'),
  ('verification.document:read:organization', 'Read verification documents submitted within the organization'),
  ('verification.document:review:organization', 'Approve, reject, request changes to, or suspend a verification document in the organization'),
  ('verification.document:read:global', 'Read verification documents in any organization'),
  ('verification.document:review:global', 'Review verification documents in any organization'),
  ('file.object:read:own', 'Read a private stored object owned by the authenticated profile'),
  ('file.object:read:organization', 'Read a private stored object owned by the organization'),
  ('file.object:read:global', 'Read a private stored object in any organization')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('patient', 'verification.document:submit:own'),
  ('patient', 'verification.document:read:own'),
  ('patient', 'file.object:read:own'),
  ('doctor', 'verification.document:submit:own'),
  ('doctor', 'verification.document:read:own'),
  ('doctor', 'file.object:read:own'),
  ('driver', 'verification.document:submit:own'),
  ('driver', 'verification.document:read:own'),
  ('driver', 'file.object:read:own'),
  ('pharmacy', 'verification.document:submit:own'),
  ('pharmacy', 'verification.document:read:own'),
  ('pharmacy', 'file.object:read:own'),
  ('emergency', 'verification.document:submit:own'),
  ('emergency', 'verification.document:read:own'),
  ('emergency', 'file.object:read:own'),
  ('admin', 'verification.document:read:organization'),
  ('admin', 'verification.document:review:organization'),
  ('admin', 'file.object:read:organization'),
  ('super_admin', 'verification.document:read:global'),
  ('super_admin', 'verification.document:review:global'),
  ('super_admin', 'file.object:read:global')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint
-- Post-seed assertions. Each one is a property the verification and download
-- routes depend on, and each is cheap to check here and expensive to discover
-- in production.
DO $$
DECLARE
  wildcard_permissions text;
  missing_grants text;
  over_broad_grants text;
BEGIN
  -- A `*` action reaching these resources would grant every action added by a
  -- later work package, undoing 0009/0010.
  SELECT COALESCE(string_agg(permission_id, ', ' ORDER BY permission_id), '')
  INTO wildcard_permissions
  FROM permissions
  WHERE (permission_id LIKE '%:*:%' OR permission_id LIKE '%:*')
    AND (permission_id LIKE 'verification.document:%' OR permission_id LIKE 'file.object:%');

  IF wildcard_permissions <> '' THEN
    RAISE EXCEPTION
      'Migration 0012 aborted: wildcard action permission(s) present for verification or file resources: %. Seed explicit per-action permissions instead.',
      wildcard_permissions;
  END IF;

  -- Review authority must exist at exactly the two scopes the API asks for:
  -- organization for `admin`, global for `super_admin`. A missing grant leaves
  -- the review endpoint permanently unreachable.
  SELECT COALESCE(string_agg(expected.role_id || ' -> ' || expected.permission_id, ', '
    ORDER BY expected.role_id, expected.permission_id), '')
  INTO missing_grants
  FROM (VALUES
    ('admin', 'verification.document:read:organization'),
    ('admin', 'verification.document:review:organization'),
    ('admin', 'file.object:read:organization'),
    ('super_admin', 'verification.document:read:global'),
    ('super_admin', 'verification.document:review:global'),
    ('super_admin', 'file.object:read:global'),
    ('doctor', 'verification.document:submit:own'),
    ('doctor', 'verification.document:read:own'),
    ('doctor', 'file.object:read:own'),
    ('driver', 'verification.document:submit:own'),
    ('pharmacy', 'verification.document:submit:own'),
    ('emergency', 'verification.document:submit:own')
  ) AS expected(role_id, permission_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM role_permissions
    WHERE role_permissions.role_id = expected.role_id
      AND role_permissions.permission_id = expected.permission_id
  );

  IF missing_grants <> '' THEN
    RAISE EXCEPTION
      'Migration 0012 aborted: required role grant(s) missing: %.',
      missing_grants;
  END IF;

  -- Global scope is platform administration only. A professional role holding a
  -- global review or global download grant would be able to read every
  -- organization's private files, which no route guard can undo afterwards.
  SELECT COALESCE(string_agg(role_id || ' -> ' || permission_id, ', '
    ORDER BY role_id, permission_id), '')
  INTO over_broad_grants
  FROM role_permissions
  WHERE role_id <> 'super_admin'
    AND (permission_id LIKE 'verification.document:%:global'
      OR permission_id LIKE 'file.object:%:global');

  IF over_broad_grants <> '' THEN
    RAISE EXCEPTION
      'Migration 0012 aborted: non-platform role(s) hold global verification or file authority: %.',
      over_broad_grants;
  END IF;
END;
$$;--> statement-breakpoint
-- Identity schema level 8, as required by the WP-04b brief.
--
-- `FoundationReadinessRepository.check` requires an EXACT match against
-- `IDENTITY_SCHEMA_VERSION`, so that constant is moved to 8 in the same change
-- as this migration. A deployment that ships one without the other reports
-- unready rather than serving traffic against a schema it was not built for -
-- which is the intended behaviour, not a bug to work around.
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 8)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
