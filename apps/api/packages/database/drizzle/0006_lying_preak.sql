ALTER TABLE "profiles" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "profiles"
SET "onboarding_completed_at" = COALESCE("updated_at", "created_at", now())
WHERE "status" = 'active' AND "onboarding_completed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_version_check" CHECK ("profiles"."version" >= 0);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_onboarding_status_check" CHECK ("profiles"."onboarding_completed_at" IS NULL OR "profiles"."status" <> 'pending');

--> statement-breakpoint
INSERT INTO permissions (permission_id, description)
VALUES
  ('profile:read:own', 'Read the authenticated profile'),
  ('profile:update:own', 'Update allowed fields on the authenticated profile')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, permission_id
FROM (VALUES
  ('patient'), ('doctor'), ('driver'), ('pharmacy'),
  ('emergency'), ('admin'), ('super_admin')
) AS seeded_roles(role_id)
CROSS JOIN (VALUES
  ('profile:read:own'), ('profile:update:own')
) AS profile_permissions(permission_id)
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 2)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
