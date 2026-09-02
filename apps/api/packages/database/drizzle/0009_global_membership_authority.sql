-- Grants the platform super-administrator explicit global membership
-- permissions for the three actions the API defines.
--
-- `super_admin` previously relied on `membership:*:global`, and
-- `permissionMatches` treats a `*` action as matching any action, so that single
-- grant authorised every present and future membership operation. These explicit
-- grants are added first; migration 0010 removes the wildcard once they exist,
-- so the super-administrator is never left without authority between steps.
INSERT INTO permissions (permission_id, description)
VALUES
  ('membership:read:global', 'Read membership administration metadata in any organization'),
  ('membership:invite:global', 'Invite an existing profile into a role in any organization'),
  ('membership:transition:global', 'Suspend, reactivate, or revoke memberships in any organization')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('super_admin', 'membership:read:global'),
  ('super_admin', 'membership:invite:global'),
  ('super_admin', 'membership:transition:global')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 5)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
