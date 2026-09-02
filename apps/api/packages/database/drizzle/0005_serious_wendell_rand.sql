ALTER TABLE "app_sessions" DROP CONSTRAINT "app_sessions_active_membership_id_organization_memberships_membership_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_id_profile_uq" ON "organization_memberships" USING btree ("membership_id","profile_id");--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_active_membership_profile_fk" FOREIGN KEY ("active_membership_id","profile_id") REFERENCES "public"."organization_memberships"("membership_id","profile_id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_end_inactive_membership_sessions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' THEN
    UPDATE app_sessions
    SET status = 'membership_ended', revoked_at = now(),
        revocation_reason = 'membership_' || NEW.status::text, updated_at = now()
    WHERE active_membership_id = NEW.membership_id AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_memberships_end_sessions
AFTER UPDATE OF status ON organization_memberships
FOR EACH ROW EXECUTE FUNCTION smartcura_end_inactive_membership_sessions();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_revoke_profile_access()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('suspended', 'deactivated') AND NEW.status <> OLD.status THEN
    UPDATE organization_memberships
    SET status = CASE
      WHEN NEW.status = 'deactivated' THEN 'revoked'::membership_status
      ELSE 'suspended'::membership_status
    END,
    updated_at = now()
    WHERE profile_id = NEW.profile_id AND status IN ('invited', 'active');

    UPDATE app_sessions
    SET status = 'revoked', revoked_at = now(),
        revocation_reason = 'profile_' || NEW.status::text, updated_at = now()
    WHERE profile_id = NEW.profile_id AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER profiles_revoke_access
AFTER UPDATE OF status ON profiles
FOR EACH ROW EXECUTE FUNCTION smartcura_revoke_profile_access();
