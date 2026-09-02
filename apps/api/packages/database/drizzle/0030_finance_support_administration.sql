-- WP-13 finance, support and administration.
--
-- THE CENTRAL RULE: every financial change posts BALANCED, IMMUTABLE double-entry
-- records. Refunds and reversals never edit a prior entry; they post a new opposing one.
-- Cached balances do not exist as stored columns anywhere here, because a stored balance
-- is a second source of truth that will eventually disagree with the ledger, and the
-- ledger is the one that must win. Balances are projections and can be rebuilt.

CREATE TYPE "public"."ledger_account_kind" AS ENUM('asset', 'liability', 'revenue', 'expense', 'equity');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_kind" AS ENUM('appointment_payment', 'appointment_refund', 'delivery_fee', 'doctor_payout', 'driver_withdrawal', 'platform_fee', 'adjustment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."payout_run_status" AS ENUM('draft', 'approved', 'processing', 'completed', 'partially_failed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payout_item_status" AS ENUM('pending', 'paid', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_status" AS ENUM('open', 'assigned', 'in_progress', 'waiting_requester', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."export_job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'expired', 'cancelled');

-- Chart of accounts. `normal_side` records whether the account increases on debit or
-- credit, so a projection can compute a signed balance without special-casing each kind.
CREATE TABLE "ledger_accounts" (
  "ledger_account_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "account_code" varchar(48) NOT NULL,
  "kind" "ledger_account_kind" NOT NULL,
  "normal_side" varchar(6) NOT NULL,
  "currency" varchar(3) DEFAULT 'MYR' NOT NULL,
  -- An account tied to a specific counterparty, so a doctor's payable or a driver's
  -- earnings balance is a real account rather than a filtered view of one shared account.
  "owner_profile_id" uuid,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ledger_accounts_code_check" CHECK ("account_code" ~ '^[a-z][a-z0-9_.]{1,47}$'),
  CONSTRAINT "ledger_accounts_side_check" CHECK ("normal_side" IN ('debit', 'credit')),
  CONSTRAINT "ledger_accounts_currency_check" CHECK ("currency" = 'MYR')
);--> statement-breakpoint

-- One business event. Immutable once written.
CREATE TABLE "ledger_entries" (
  "ledger_entry_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "kind" "ledger_entry_kind" NOT NULL,
  "currency" varchar(3) DEFAULT 'MYR' NOT NULL,
  "reference_type" varchar(32) NOT NULL,
  "reference_id" uuid NOT NULL,
  "memo_code" varchar(64) NOT NULL,
  -- A reversal points at what it reverses. The reversed entry is NEVER edited, so the
  -- audit trail shows both the original and the correction rather than a rewritten past.
  "reverses_entry_id" uuid,
  "posted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ledger_entries_reference_check" CHECK ("reference_type" ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT "ledger_entries_memo_check" CHECK ("memo_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "ledger_entries_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "ledger_entries_no_self_reversal_check" CHECK (
    "reverses_entry_id" IS NULL OR "reverses_entry_id" <> "ledger_entry_id"
  ),
  -- A reversal is declared as one. Allowing an ordinary kind to carry a reversal link
  -- would let a correction be filed as if it were fresh business activity.
  CONSTRAINT "ledger_entries_reversal_kind_check" CHECK (
    ("reverses_entry_id" IS NULL) OR ("kind" = 'reversal')
  )
);--> statement-breakpoint

-- The two or more sides of an entry. `amount_sen` is SIGNED: debits positive, credits
-- negative, so "balanced" is simply a sum of zero and cannot be fudged by mixing
-- separate debit and credit columns that only agree by convention.
CREATE TABLE "ledger_postings" (
  "ledger_posting_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "ledger_entry_id" uuid NOT NULL,
  "ledger_account_id" uuid NOT NULL,
  "amount_sen" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ledger_postings_nonzero_check" CHECK ("amount_sen" <> 0)
);--> statement-breakpoint

-- Doctor payout batch.
CREATE TABLE "payout_runs" (
  "payout_run_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" "payout_run_status" DEFAULT 'draft' NOT NULL,
  "approved_by_membership_id" uuid,
  "prepared_by_membership_id" uuid NOT NULL,
  "reason_code" varchar(64),
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payout_runs_period_check" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "payout_runs_version_check" CHECK ("version" >= 0),
  CONSTRAINT "payout_runs_reason_check" CHECK (
    "reason_code" IS NULL OR "reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'
  ),
  -- Approval is recorded by WHOM. An approved run with no approver is an unsigned
  -- authorisation to move money.
  CONSTRAINT "payout_runs_approver_check" CHECK (
    "status" IN ('draft', 'cancelled') OR "approved_by_membership_id" IS NOT NULL
  )
);--> statement-breakpoint

CREATE TABLE "payout_items" (
  "payout_item_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "payout_run_id" uuid NOT NULL,
  "payee_membership_id" uuid NOT NULL,
  "payee_profile_id" uuid NOT NULL,
  "gross_sen" bigint NOT NULL,
  "platform_fee_sen" bigint NOT NULL,
  -- Derived, so the arithmetic cannot drift from its inputs.
  "net_sen" bigint GENERATED ALWAYS AS ("gross_sen" - "platform_fee_sen") STORED,
  "status" "payout_item_status" DEFAULT 'pending' NOT NULL,
  "failure_reason_code" varchar(64),
  "ledger_entry_id" uuid,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payout_items_gross_check" CHECK ("gross_sen" > 0),
  CONSTRAINT "payout_items_fee_check" CHECK (
    "platform_fee_sen" >= 0 AND "platform_fee_sen" <= "gross_sen"
  ),
  CONSTRAINT "payout_items_version_check" CHECK ("version" >= 0),
  CONSTRAINT "payout_items_failure_check" CHECK (
    ("status" = 'failed' AND "failure_reason_code" IS NOT NULL
      AND "failure_reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
    OR ("status" <> 'failed' AND "failure_reason_code" IS NULL)
  ),
  -- A paid item must name the ledger entry that moved the money, so "paid" can never be
  -- asserted without a posting behind it.
  CONSTRAINT "payout_items_paid_entry_check" CHECK (
    ("status" = 'paid') = ("ledger_entry_id" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE TABLE "support_tickets" (
  "support_ticket_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "requester_profile_id" uuid NOT NULL,
  "category_code" varchar(64) NOT NULL,
  "subject_code" varchar(64) NOT NULL,
  "status" "support_ticket_status" DEFAULT 'open' NOT NULL,
  "priority" "support_ticket_priority" DEFAULT 'medium' NOT NULL,
  "assigned_membership_id" uuid,
  "resolution_code" varchar(64),
  "resolved_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_tickets_category_check" CHECK ("category_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "support_tickets_subject_check" CHECK ("subject_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "support_tickets_version_check" CHECK ("version" >= 0),
  -- An assigned ticket has an assignee, and an unassigned one does not claim to.
  CONSTRAINT "support_tickets_assignment_check" CHECK (
    "status" NOT IN ('assigned', 'in_progress') OR "assigned_membership_id" IS NOT NULL
  ),
  CONSTRAINT "support_tickets_resolution_check" CHECK (
    ("status" IN ('resolved', 'closed')
      AND "resolved_at" IS NOT NULL
      AND "resolution_code" IS NOT NULL
      AND "resolution_code" ~ '^[a-z][a-z0-9_]{1,62}$')
    OR ("status" NOT IN ('resolved', 'closed')
      AND "resolved_at" IS NULL AND "resolution_code" IS NULL)
  ),
  CONSTRAINT "support_tickets_closed_check" CHECK (
    ("status" = 'closed') = ("closed_at" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE TABLE "ticket_messages" (
  "ticket_message_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "support_ticket_id" uuid NOT NULL,
  "author_profile_id" uuid NOT NULL,
  "body" text NOT NULL,
  -- An internal note is invisible to the requester. Storing that as a flag on the same
  -- table keeps one ordering for the conversation; a separate table would let a note and
  -- a reply disagree about what came first.
  "internal_only" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ticket_messages_body_check" CHECK (length(btrim("body")) BETWEEN 1 AND 8000)
);--> statement-breakpoint

CREATE TABLE "ticket_assignments" (
  "ticket_assignment_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "support_ticket_id" uuid NOT NULL,
  "assigned_membership_id" uuid NOT NULL,
  "assigned_by_membership_id" uuid NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ticket_assignments_reason_check" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
);--> statement-breakpoint

CREATE TABLE "ticket_status_events" (
  "ticket_status_event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "support_ticket_id" uuid NOT NULL,
  "actor_membership_id" uuid,
  "actor_profile_id" uuid NOT NULL,
  "from_status" "support_ticket_status",
  "to_status" "support_ticket_status" NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ticket_status_events_reason_check" CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "ticket_status_events_progress_check" CHECK (
    "from_status" IS NULL OR "from_status" <> "to_status"
  )
);--> statement-breakpoint

-- Data export. The requester is recorded because an export is a bulk disclosure, and the
-- file is private with a bounded lifetime for the same reason.
CREATE TABLE "export_jobs" (
  "export_job_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "requested_by_membership_id" uuid NOT NULL,
  "requested_by_profile_id" uuid NOT NULL,
  "dataset_code" varchar(64) NOT NULL,
  "purpose_code" varchar(64) NOT NULL,
  "status" "export_job_status" DEFAULT 'queued' NOT NULL,
  "row_count" bigint,
  "failure_reason_code" varchar(64),
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "export_jobs_dataset_check" CHECK ("dataset_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "export_jobs_purpose_check" CHECK ("purpose_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "export_jobs_version_check" CHECK ("version" >= 0),
  CONSTRAINT "export_jobs_failure_check" CHECK (
    ("status" = 'failed' AND "failure_reason_code" IS NOT NULL
      AND "failure_reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
    OR ("status" <> 'failed' AND "failure_reason_code" IS NULL)
  ),
  CONSTRAINT "export_jobs_completed_check" CHECK (
    ("status" = 'completed') = ("completed_at" IS NOT NULL)
  ),
  CONSTRAINT "export_jobs_row_count_check" CHECK (
    "row_count" IS NULL OR "row_count" >= 0
  )
);--> statement-breakpoint

CREATE TABLE "export_files" (
  "export_file_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "export_job_id" uuid NOT NULL,
  "stored_object_id" uuid NOT NULL,
  "byte_size" bigint NOT NULL,
  "sha256" varchar(64) NOT NULL,
  -- Bounded lifetime, enforced rather than documented.
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "export_files_size_check" CHECK ("byte_size" > 0),
  CONSTRAINT "export_files_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "export_files_expiry_check" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint

-- Organization-scoped settings. Values are jsonb so a setting can be structured, with a
-- reviewed key vocabulary rather than free-form names.
CREATE TABLE "organization_settings" (
  "organization_setting_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "setting_key" varchar(64) NOT NULL,
  "value" jsonb NOT NULL,
  "updated_by_membership_id" uuid NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organization_settings_key_check" CHECK ("setting_key" ~ '^[a-z][a-z0-9_.]{1,62}$'),
  CONSTRAINT "organization_settings_version_check" CHECK ("version" >= 0),
  -- jsonb `null` is a legal value and would defeat a NOT NULL column, so it is refused
  -- explicitly. This is the same class of hole as a CHECK that evaluates to NULL.
  CONSTRAINT "organization_settings_value_check" CHECK (jsonb_typeof("value") <> 'null')
);--> statement-breakpoint

ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_fk" FOREIGN KEY ("owner_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "ledger_entries"("ledger_entry_id");--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_entry_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("ledger_entry_id");--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_account_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("ledger_account_id");--> statement-breakpoint
ALTER TABLE "payout_runs" ADD CONSTRAINT "payout_runs_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "payout_runs" ADD CONSTRAINT "payout_runs_preparer_fk" FOREIGN KEY ("prepared_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "payout_runs" ADD CONSTRAINT "payout_runs_approver_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_run_fk" FOREIGN KEY ("payout_run_id") REFERENCES "payout_runs"("payout_run_id");--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_payee_membership_fk" FOREIGN KEY ("payee_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_payee_profile_fk" FOREIGN KEY ("payee_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_entry_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("ledger_entry_id");--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requester_fk" FOREIGN KEY ("requester_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_fk" FOREIGN KEY ("assigned_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_fk" FOREIGN KEY ("support_ticket_id") REFERENCES "support_tickets"("support_ticket_id");--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_fk" FOREIGN KEY ("author_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_ticket_fk" FOREIGN KEY ("support_ticket_id") REFERENCES "support_tickets"("support_ticket_id");--> statement-breakpoint
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_assignee_fk" FOREIGN KEY ("assigned_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "ticket_assignments" ADD CONSTRAINT "ticket_assignments_assigner_fk" FOREIGN KEY ("assigned_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "ticket_status_events" ADD CONSTRAINT "ticket_status_events_ticket_fk" FOREIGN KEY ("support_ticket_id") REFERENCES "support_tickets"("support_ticket_id");--> statement-breakpoint
ALTER TABLE "ticket_status_events" ADD CONSTRAINT "ticket_status_events_actor_profile_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_membership_fk" FOREIGN KEY ("requested_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_profile_fk" FOREIGN KEY ("requested_by_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "export_files" ADD CONSTRAINT "export_files_job_fk" FOREIGN KEY ("export_job_id") REFERENCES "export_jobs"("export_job_id");--> statement-breakpoint
ALTER TABLE "export_files" ADD CONSTRAINT "export_files_object_fk" FOREIGN KEY ("stored_object_id") REFERENCES "stored_objects"("object_id");--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_membership_fk" FOREIGN KEY ("updated_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint

CREATE UNIQUE INDEX "ledger_accounts_code_unique" ON "ledger_accounts" ("organization_id", "account_code", COALESCE("owner_profile_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "ledger_entries_reference_idx" ON "ledger_entries" ("reference_type", "reference_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_posted_idx" ON "ledger_entries" ("organization_id", "posted_at");--> statement-breakpoint
-- One reversal per entry: a single mistake cannot be corrected twice into a windfall.
CREATE UNIQUE INDEX "ledger_entries_one_reversal" ON "ledger_entries" ("reverses_entry_id")
  WHERE "reverses_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ledger_postings_entry_idx" ON "ledger_postings" ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "ledger_postings_account_idx" ON "ledger_postings" ("ledger_account_id", "created_at");--> statement-breakpoint
-- One payout per payee per run, so a duplicated line cannot pay someone twice.
CREATE UNIQUE INDEX "payout_items_one_per_payee_per_run" ON "payout_items" ("payout_run_id", "payee_membership_id");--> statement-breakpoint
CREATE INDEX "payout_runs_period_idx" ON "payout_runs" ("organization_id", "period_start", "period_end");--> statement-breakpoint
-- One draft run per period, so two half-built batches cannot both claim the same weeks.
CREATE UNIQUE INDEX "payout_runs_one_open_per_period" ON "payout_runs" ("organization_id", "period_start", "period_end")
  WHERE "status" IN ('draft', 'approved', 'processing');--> statement-breakpoint
CREATE INDEX "support_tickets_queue_idx" ON "support_tickets" ("organization_id", "status", "priority");--> statement-breakpoint
CREATE INDEX "support_tickets_requester_idx" ON "support_tickets" ("requester_profile_id", "created_at");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" ("support_ticket_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_assignments_one_active" ON "ticket_assignments" ("support_ticket_id")
  WHERE "released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ticket_status_events_ticket_idx" ON "ticket_status_events" ("support_ticket_id", "created_at");--> statement-breakpoint
CREATE INDEX "export_jobs_status_idx" ON "export_jobs" ("organization_id", "status", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "export_files_job_unique" ON "export_files" ("export_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_settings_key_unique" ON "organization_settings" ("organization_id", "setting_key");--> statement-breakpoint

-- DOUBLE ENTRY, ENFORCED. Postings must sum to zero and there must be at least two of
-- them. DEFERRABLE so an entry and its postings can be inserted in any order within one
-- transaction, while an unbalanced entry still cannot commit. This is the invariant that
-- makes the ledger trustworthy; without it "balanced" would be a convention that the
-- first buggy call site quietly breaks.
CREATE OR REPLACE FUNCTION "ledger_entry_must_balance"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  posting_count integer;
  net bigint;
  entry_currency varchar(3);
  mismatched integer;
BEGIN
  SELECT count(*), COALESCE(sum("amount_sen"), 0) INTO posting_count, net
    FROM "ledger_postings" WHERE "ledger_entry_id" = NEW."ledger_entry_id";
  IF posting_count < 2 THEN
    RAISE EXCEPTION 'ledger entry % must have at least two postings, found %',
      NEW."ledger_entry_id", posting_count USING ERRCODE = 'check_violation';
  END IF;
  IF net <> 0 THEN
    RAISE EXCEPTION 'ledger entry % is unbalanced by % sen', NEW."ledger_entry_id", net
      USING ERRCODE = 'check_violation';
  END IF;
  -- A posting into an account of another currency would balance numerically while being
  -- economically meaningless.
  SELECT "currency" INTO entry_currency FROM "ledger_entries"
    WHERE "ledger_entry_id" = NEW."ledger_entry_id";
  SELECT count(*) INTO mismatched
    FROM "ledger_postings" p
    JOIN "ledger_accounts" a ON a."ledger_account_id" = p."ledger_account_id"
   WHERE p."ledger_entry_id" = NEW."ledger_entry_id" AND a."currency" <> entry_currency;
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'ledger entry % posts into % account(s) of another currency',
      NEW."ledger_entry_id", mismatched USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_entries_balance_trigger"
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger_entry_must_balance"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_postings_balance_trigger"
  AFTER INSERT ON "ledger_postings"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger_entry_must_balance"();--> statement-breakpoint

-- A reversal must exactly negate what it reverses, or it is not a reversal.
CREATE OR REPLACE FUNCTION "ledger_reversal_must_negate"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original bigint;
  reversal bigint;
BEGIN
  IF NEW."reverses_entry_id" IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(abs("amount_sen")), 0) INTO original
    FROM "ledger_postings" WHERE "ledger_entry_id" = NEW."reverses_entry_id";
  SELECT COALESCE(sum(abs("amount_sen")), 0) INTO reversal
    FROM "ledger_postings" WHERE "ledger_entry_id" = NEW."ledger_entry_id";
  IF original <> reversal THEN
    RAISE EXCEPTION 'reversal % moves % sen but the reversed entry moved % sen',
      NEW."ledger_entry_id", reversal, original USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_entries_reversal_trigger"
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger_reversal_must_negate"();--> statement-breakpoint

-- The ledger is APPEND-ONLY. A correction is a new opposing entry, never an edit, so the
-- history cannot be rewritten to make a past state look different from what happened.
CREATE OR REPLACE FUNCTION "ledger_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the ledger is append-only; post a reversing entry instead'
    USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();--> statement-breakpoint
CREATE TRIGGER "ledger_postings_append_only" BEFORE UPDATE OR DELETE ON "ledger_postings"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();--> statement-breakpoint
CREATE TRIGGER "ticket_status_events_append_only" BEFORE UPDATE OR DELETE ON "ticket_status_events"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only"();--> statement-breakpoint

-- An approved or later payout run is frozen: items cannot be added, removed or repriced
-- after someone authorised the total. Otherwise approval would guarantee nothing.
CREATE OR REPLACE FUNCTION "payout_items_frozen_after_approval"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_status "payout_run_status";
  target uuid;
BEGIN
  target := COALESCE(NEW."payout_run_id", OLD."payout_run_id");
  SELECT "status" INTO run_status FROM "payout_runs" WHERE "payout_run_id" = target;
  IF run_status IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF run_status = 'draft' THEN RETURN COALESCE(NEW, OLD); END IF;
  -- Settlement outcomes are still recordable; the AMOUNTS are what freeze.
  IF TG_OP = 'UPDATE'
     AND NEW."gross_sen" = OLD."gross_sen"
     AND NEW."platform_fee_sen" = OLD."platform_fee_sen"
     AND NEW."payee_membership_id" = OLD."payee_membership_id" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payout run % is % and its item amounts are frozen', target, run_status
    USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payout_items_frozen_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "payout_items"
  FOR EACH ROW EXECUTE FUNCTION "payout_items_frozen_after_approval"();--> statement-breakpoint

INSERT INTO permissions (permission_id, description) VALUES
  ('ledger:read:org', 'Read organization ledger accounts and entries'),
  ('ledger.entry:post:org', 'Post balanced ledger entries'),
  ('payout_run:manage:org', 'Prepare and manage doctor payout runs'),
  ('payout_run:approve:org', 'Approve a payout run for settlement'),
  ('support.ticket:manage:org', 'Triage, assign and resolve support tickets'),
  ('export_job:manage:org', 'Request and manage data exports'),
  ('organization.setting:manage:org', 'Read and update organization settings')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'ledger:read:org'),
  ('admin', 'payout_run:manage:org'),
  ('admin', 'support.ticket:manage:org'),
  ('admin', 'export_job:manage:org'),
  ('admin', 'organization.setting:manage:org'),
  ('super_admin', 'ledger:read:org'),
  ('super_admin', 'payout_run:approve:org'),
  ('super_admin', 'support.ticket:manage:org'),
  ('super_admin', 'export_job:manage:org'),
  ('super_admin', 'organization.setting:manage:org')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint

DO $$
BEGIN
  -- SEPARATION OF DUTIES: whoever prepares a payout run must not be the one who approves
  -- it. Granting both to one role would make self-approval the normal path, which is the
  -- control that matters most in a money-moving flow.
  IF EXISTS (
    SELECT 1 FROM role_permissions a
    JOIN role_permissions b ON a.role_id = b.role_id
    WHERE a.permission_id = 'payout_run:manage:org'
      AND b.permission_id = 'payout_run:approve:org'
  ) THEN
    RAISE EXCEPTION 'no role may both prepare and approve a payout run';
  END IF;
  -- Posting to the ledger is a service capability, not an interactive one. No role holds
  -- it, so money movement can only originate from a domain command.
  IF EXISTS (SELECT 1 FROM role_permissions WHERE permission_id = 'ledger.entry:post:org') THEN
    RAISE EXCEPTION 'ledger posting must not be granted to an interactive role';
  END IF;
END $$;--> statement-breakpoint

INSERT INTO schema_compatibility (component, version) VALUES ('identity', 22)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
