-- Converge the permission scope vocabulary from the legacy `:org` alias to
-- the canonical `:organization` suffix that the policy engine recognizes.
--
-- The policy engine (apps/api/packages/policy/src/permission-policy.ts) regex
-- only accepts `own|assigned|site|organization|global`. The `:org` suffix was
-- an informal alias used by four services (finance, stage11, metrics, logistics)
-- that bypass the policy engine with raw Array.includes(). This migration
-- renames the 10 `:org` permission strings to `:organization` in permissions,
-- role_permissions, and custom_role_permissions so the backend code can switch
-- to `:organization` everywhere and the policy engine becomes the single
-- enforcement path.
--
-- content:manage:organization already exists (seeded in 0004), so
-- content:manage:org is a duplicate to be deleted, not renamed.

-- 1. Insert the new :organization permissions that don't already exist.
INSERT INTO permissions (permission_id, description)
VALUES
  ('ledger:read:organization', 'Read organization ledger accounts and entries'),
  ('ledger.entry:post:organization', 'Post balanced ledger entries'),
  ('payout_run:manage:organization', 'Prepare and manage doctor payout runs'),
  ('payout_run:approve:organization', 'Approve a payout run for settlement'),
  ('support.ticket:manage:organization', 'Triage, assign and resolve support tickets'),
  ('export_job:manage:organization', 'Request and manage data exports'),
  ('organization.setting:manage:organization', 'Read and update organization settings'),
  ('withdrawal:review:organization', 'Review, approve or reject driver withdrawal requests'),
  ('custom_role:manage:organization', 'Manage organization custom roles and their explicit permissions')
ON CONFLICT (permission_id) DO UPDATE SET description = EXCLUDED.description;
--> statement-breakpoint

-- 2. Re-point role_permissions from :org to :organization.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id,
       REPLACE(rp.permission_id, ':org', ':organization') AS new_pid
FROM role_permissions rp
WHERE rp.permission_id LIKE '%:org'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    WHERE rp2.role_id = rp.role_id
      AND rp2.permission_id = REPLACE(rp.permission_id, ':org', ':organization')
  );
--> statement-breakpoint

-- 3. Re-point custom_role_permissions from :org to :organization.
INSERT INTO custom_role_permissions (custom_role_id, permission_id, created_by_membership_id)
SELECT crp.custom_role_id,
       REPLACE(crp.permission_id, ':org', ':organization') AS new_pid,
       crp.created_by_membership_id
FROM custom_role_permissions crp
WHERE crp.permission_id LIKE '%:org'
  AND NOT EXISTS (
    SELECT 1 FROM custom_role_permissions crp2
    WHERE crp2.custom_role_id = crp.custom_role_id
      AND crp2.permission_id = REPLACE(crp.permission_id, ':org', ':organization')
  );
--> statement-breakpoint

-- 4. Delete the old :org role_permissions and custom_role_permissions.
DELETE FROM role_permissions WHERE permission_id LIKE '%:org';
--> statement-breakpoint
DELETE FROM custom_role_permissions WHERE permission_id LIKE '%:org';
--> statement-breakpoint

-- 5. Delete the old :org permission definitions (content:manage:org is a
--    duplicate of the already-existing content:manage:organization).
DELETE FROM permissions WHERE permission_id LIKE '%:org';
--> statement-breakpoint

-- 6. Re-check the separation-of-duties invariant from migration 0030, now
--    with the canonical suffix.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM role_permissions a
    JOIN role_permissions b ON a.role_id = b.role_id
    WHERE a.permission_id = 'payout_run:manage:organization'
      AND b.permission_id = 'payout_run:approve:organization'
  ) THEN
    RAISE EXCEPTION 'no role may both prepare and approve a payout run';
  END IF;
  IF EXISTS (SELECT 1 FROM role_permissions WHERE permission_id = 'ledger.entry:post:organization') THEN
    RAISE EXCEPTION 'ledger posting must not be granted to an interactive role';
  END IF;
END $$;
--> statement-breakpoint

-- This migration renames permission strings but does not change the identity schema,
-- so the schema_compatibility identity version is not touched.
