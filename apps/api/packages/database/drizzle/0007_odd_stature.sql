ALTER TABLE "organization_memberships" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "organization_memberships_org_created_idx" ON "organization_memberships" USING btree ("organization_id","created_at","membership_id");--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_version_check" CHECK ("organization_memberships"."version" >= 0);

--> statement-breakpoint
INSERT INTO permissions (permission_id, description)
VALUES
  ('membership:read:organization', 'Read minimum membership administration metadata'),
  ('membership:transition:organization', 'Suspend, reactivate, or revoke organization memberships')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('admin', 'membership:read:organization'),
  ('admin', 'membership:transition:organization')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 3)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
