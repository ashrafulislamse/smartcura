-- Constraints that USE the enum values added by 0032.
--
-- Separate migration on purpose: PostgreSQL cannot use a new enum value in the transaction that
-- adds it, and the migrator applies one migration per transaction. Splitting is the same pattern
-- 0021/0022 used for the IoT vocabulary.

-- A reason code is required for every outcome a human or a bank REFUSED, and forbidden otherwise.
-- 0025 covered `rejected` and `cancelled`; `failed` belongs with them, because a failed bank
-- transfer without a stated cause leaves nobody able to tell a wrong account number from an
-- insufficient float.
ALTER TABLE "driver_withdrawals" DROP CONSTRAINT "driver_withdrawals_reason_check";--> statement-breakpoint
ALTER TABLE "driver_withdrawals" ADD CONSTRAINT "driver_withdrawals_reason_check" CHECK (
  ("status" IN ('rejected', 'cancelled', 'failed')) = ("reason_code" IS NOT NULL)
);--> statement-breakpoint

-- One withdrawal in flight per driver. Two concurrent requests could each pass an
-- affordability check against the same balance and together exceed it — the same oversell shape
-- as inventory, applied to money.
CREATE UNIQUE INDEX "driver_withdrawals_one_in_flight"
  ON "driver_withdrawals" ("driver_id")
  WHERE "status" IN ('requested', 'under_review', 'approved', 'processing');--> statement-breakpoint

-- A paid withdrawal must name the ledger entry that moved the money, so "paid" can never be
-- asserted without a posting behind it. This mirrors `payout_items_paid_entry_check`.
ALTER TABLE "driver_withdrawals" ADD COLUMN "ledger_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "driver_withdrawals" ADD CONSTRAINT "driver_withdrawals_entry_fk"
  FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("ledger_entry_id");--> statement-breakpoint
ALTER TABLE "driver_withdrawals" ADD CONSTRAINT "driver_withdrawals_paid_entry_check" CHECK (
  ("status" = 'paid') = ("ledger_entry_id" IS NOT NULL)
);--> statement-breakpoint

-- Reviewer attribution, so an approval is signed. An approved withdrawal with no approver is an
-- unsigned authorisation to move money.
ALTER TABLE "driver_withdrawals" ADD COLUMN "reviewed_by_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "driver_withdrawals" ADD CONSTRAINT "driver_withdrawals_reviewer_fk"
  FOREIGN KEY ("reviewed_by_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "driver_withdrawals" ADD CONSTRAINT "driver_withdrawals_reviewer_check" CHECK (
  "status" IN ('requested', 'under_review', 'cancelled') OR "reviewed_by_membership_id" IS NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'withdrawal_status') <> 8 THEN
    RAISE EXCEPTION 'withdrawal_status must carry the eight catalogue values';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'driver_withdrawals_paid_entry_check'
  ) THEN
    RAISE EXCEPTION 'a paid withdrawal must be bound to a ledger entry';
  END IF;
END $$;--> statement-breakpoint

INSERT INTO schema_compatibility (component, version) VALUES ('identity', 24)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
