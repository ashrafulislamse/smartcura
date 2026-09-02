-- Unified communication: notification priority, push-device hygiene, and
-- notification access for every role.
--
-- Three gaps this migration closes:
--
-- 1. PRIORITY. The notifications table had no notion of urgency, so an emergency
--    dispatch and a broadcast carried identical weight on every channel. The new
--    `notification_priority` enum is set by producers through createNotification
--    (default `normal`) and consumed by the worker to choose FCM priority and the
--    Android notification channel. `expires_at` is nullable and reserved for
--    time-boxed notices; nothing sets it yet, but the column makes the contract
--    explicit instead of implicit absence.
--
-- 2. PUSH DEVICES OUTLIVING REVOCATION. Ending a membership or suspending a
--    profile ended sessions but left `push_devices.enabled = true`, so a revoked
--    member kept receiving pushes indefinitely. The two revocation trigger
--    functions now also disable the profile's push devices — push follows the
--    same access boundary as sessions.
--
-- 3. NOTIFICATION ACCESS WAS PATIENT/DOCTOR ONLY. Migration 0020 seeded
--    notification:read:own and notification.preference:manage:own for patient and
--    doctor roles only, so GET /notifications 403s for drivers, pharmacy, emergency,
--    admin, and super_admin — exactly the roles the unified communication system
--    needs to reach (dispatch offers to drivers, escalations to emergency staff,
--    system alerts to admins). The permissions already exist; only the grants were
--    missing.

CREATE TYPE "public"."notification_priority" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "priority" "public"."notification_priority" NOT NULL DEFAULT 'normal';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notifications_profile_unread_idx" ON "notifications" ("profile_id","created_at","notification_id") WHERE "read_at" IS NULL;--> statement-breakpoint

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
    -- A member whose membership ended must also stop receiving push: the device
    -- token is a capability to read notifications, and capabilities follow the
    -- session boundary. Disabling (not deleting) keeps the audit row.
    UPDATE push_devices
    SET enabled = false, updated_at = now()
    WHERE profile_id = NEW.profile_id AND enabled = true;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
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

    UPDATE push_devices
    SET enabled = false, updated_at = now()
    WHERE profile_id = NEW.profile_id AND enabled = true;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id) VALUES
 ('driver','notification:read:own'), ('driver','notification.preference:manage:own'),
 ('pharmacy','notification:read:own'), ('pharmacy','notification.preference:manage:own'),
 ('emergency','notification:read:own'), ('emergency','notification.preference:manage:own'),
 ('admin','notification:read:own'), ('admin','notification.preference:manage:own'),
 ('super_admin','notification:read:own'), ('super_admin','notification.preference:manage:own')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO schema_compatibility (component, version) VALUES ('identity', 30)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
