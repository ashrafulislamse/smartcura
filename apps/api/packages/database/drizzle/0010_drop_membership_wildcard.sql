-- Removes the super-administrator's broad membership wildcard now that the
-- explicit per-action grants from migration 0009 are in place.
--
-- Least privilege: with `membership:*:global` present, any membership permission
-- added later would be inherited automatically by the super-administrator rather
-- than granted deliberately. Ordering matters, so this runs only after 0009.
DELETE FROM role_permissions
WHERE role_id = 'super_admin' AND permission_id = 'membership:*:global';--> statement-breakpoint
DELETE FROM permissions
WHERE permission_id = 'membership:*:global'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions WHERE permission_id = 'membership:*:global'
  );--> statement-breakpoint
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 6)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
