-- Align `withdrawal_status` with the frozen catalogue.
--
-- `enum-state-catalogue.md` §11 specifies eight values: `requested`, `under_review`, `approved`,
-- `processing`, `paid`, `failed`, `rejected`, `cancelled`. Migration `0025` created only five,
-- omitting `under_review`, `processing` and `failed`. The catalogue is authoritative, so the
-- database is corrected rather than the document.
--
-- THIS MATTERS BEYOND TIDINESS. Without `processing` there is no state for "the bank transfer
-- has been initiated but not confirmed", so a payout in flight would have to be recorded as
-- either not-yet-started or already-paid — and recording an unconfirmed transfer as `paid` is
-- how money goes missing without anyone noticing. Without `failed` a rejected bank transfer
-- would have to be represented as `rejected`, which means an operator decision, conflating a
-- bank failure with a human refusal.
--
-- Values are added in THIS migration and used only afterwards. PostgreSQL cannot use a new enum
-- value in the transaction that adds it, and the migrator applies one migration per transaction,
-- so a later migration or the running application may use them safely.

ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'under_review' AFTER 'requested';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'processing' AFTER 'approved';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'failed' AFTER 'paid';--> statement-breakpoint

INSERT INTO permissions (permission_id, description) VALUES
  ('withdrawal:review:org', 'Review, approve or reject driver withdrawal requests')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'withdrawal:review:org')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint

DO $$
BEGIN
  -- A driver must never be able to approve their own withdrawal. The request is `own`-scoped and
  -- the review is an organization capability, and those must stay disjoint.
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'withdrawal:review:org' AND role_id = 'driver'
  ) THEN
    RAISE EXCEPTION 'a driver must not hold withdrawal review authority';
  END IF;
END $$;
