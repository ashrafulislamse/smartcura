ALTER TYPE "public"."membership_status" ADD VALUE 'applied' BEFORE 'invited';--> statement-breakpoint
ALTER TABLE "membership_sites" DROP CONSTRAINT "membership_sites_membership_id_organization_memberships_membership_id_fk";--> statement-breakpoint
ALTER TABLE "membership_sites" DROP CONSTRAINT "membership_sites_site_id_sites_site_id_fk";--> statement-breakpoint
ALTER TABLE "membership_sites" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "membership_sites" AS membership_site
SET "organization_id" = membership."organization_id"
FROM "organization_memberships" AS membership
WHERE membership."membership_id" = membership_site."membership_id";--> statement-breakpoint
ALTER TABLE "membership_sites" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
-- Preflight: the composite site foreign key added below cannot be satisfied by
-- legacy rows whose site belongs to a different organization than the
-- membership. Those rows were possible before the composite key existed. Fail
-- loudly with the offending pairs rather than letting ADD CONSTRAINT abort with
-- an opaque error, so the data can be remediated deliberately.
DO $$
DECLARE
  offending_count integer;
  offending_sample text;
BEGIN
  SELECT count(*), COALESCE(string_agg(
    format('membership=%s site=%s', membership_site.membership_id, membership_site.site_id),
    ', ' ORDER BY membership_site.membership_id
  ), '')
  INTO offending_count, offending_sample
  FROM membership_sites AS membership_site
  JOIN sites AS site ON site.site_id = membership_site.site_id
  WHERE site.organization_id <> membership_site.organization_id;

  IF offending_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0008 aborted: % membership_sites row(s) reference a site in a different organization. Remediate before retrying. Offending rows: %',
      offending_count, left(offending_sample, 500);
  END IF;
END;
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_id_org_uq" ON "organization_memberships" USING btree ("membership_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_id_organization_uq" ON "sites" USING btree ("site_id","organization_id");--> statement-breakpoint
ALTER TABLE "membership_sites" ADD CONSTRAINT "membership_sites_membership_org_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "public"."organization_memberships"("membership_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_sites" ADD CONSTRAINT "membership_sites_site_org_fk" FOREIGN KEY ("site_id","organization_id") REFERENCES "public"."sites"("site_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_revoke_profile_access()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('suspended', 'deactivated') AND NEW.status <> OLD.status THEN
    -- Safety net only. The supported path is an explicit profile-administration
    -- transaction that versions, audits and publishes each membership change.
    -- This trigger still increments `version` so that a cascade can never be
    -- mistaken for a no-op by optimistic concurrency: a client holding a stale
    -- version is forced to re-read instead of overwriting a revoked membership.
    -- It deliberately does not write outbox events, because a per-row trigger
    -- cannot construct a correlated event envelope; a cascade is therefore
    -- observable through the audit row below and through session revocation, and
    -- reconciliation is the application's responsibility.
    UPDATE organization_memberships
    SET status = CASE
      WHEN NEW.status = 'deactivated' THEN 'revoked'::membership_status
      ELSE 'suspended'::membership_status
    END,
    version = version + 1,
    updated_at = now()
    WHERE profile_id = NEW.profile_id AND status IN ('applied', 'invited', 'active');

    INSERT INTO audit_logs
      (audit_id, organization_id, actor_profile_id, action, object_type,
       object_id, reason, correlation_id, metadata)
    SELECT uuidv7(), membership.organization_id, NEW.profile_id,
      'membership.cascade_revoked', 'organization_membership',
      membership.membership_id, 'profile_' || NEW.status::text, uuidv7(),
      jsonb_build_object(
        'target_role', membership.role_id,
        'status', membership.status,
        'version', membership.version,
        'source', 'profile_status_cascade'
      )
    FROM organization_memberships AS membership
    WHERE membership.profile_id = NEW.profile_id
      AND membership.updated_at = now();

    UPDATE app_sessions
    SET status = 'revoked', revoked_at = now(),
        revocation_reason = 'profile_' || NEW.status::text, updated_at = now()
    WHERE profile_id = NEW.profile_id AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
INSERT INTO permissions (permission_id, description)
VALUES ('membership:invite:organization', 'Invite an existing profile into an organization role')
ON CONFLICT (permission_id) DO UPDATE SET description = EXCLUDED.description;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
VALUES ('admin', 'membership:invite:organization')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 4)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();