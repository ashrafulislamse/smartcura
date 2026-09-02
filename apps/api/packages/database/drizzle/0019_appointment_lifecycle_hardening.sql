-- WP-05 lifecycle and policy hardening. Migration 0018 must commit first so the
-- canonical checked_in/in_progress enum values are safe to reference here.

-- Patient overlap checks serialize by patient advisory lock in the repository;
-- this partial index keeps the locked overlap query bounded to live appointments.
CREATE INDEX "appointments_patient_live_slot_idx"
ON "appointments" USING btree ("patient_profile_id","slot_id")
WHERE status IN ('pending_payment','confirmed','checked_in','in_progress');--> statement-breakpoint
CREATE INDEX "appointment_slots_organization_window_idx"
ON "appointment_slots" USING btree ("organization_id","starts_at","slot_id");--> statement-breakpoint
CREATE INDEX "appointments_created_idx"
ON "appointments" USING btree ("created_at","appointment_id");--> statement-breakpoint

-- A booked slot may not be released while any canonical live appointment state
-- occupies it. Cancellation/payment failure changes the appointment first, then
-- closes the slot in the same transaction.
CREATE OR REPLACE FUNCTION smartcura_guard_slot_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state = 'booked' AND NEW.state <> 'booked' AND EXISTS (
    SELECT 1 FROM appointments
    WHERE appointments.slot_id = OLD.slot_id
      AND appointments.status IN ('pending_payment','confirmed','checked_in','in_progress')
  ) THEN
    RAISE EXCEPTION
      'appointment_slot % cannot leave state booked while a live appointment occupies it', OLD.slot_id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

INSERT INTO permissions (permission_id, description)
VALUES
  ('appointment:cancel:assigned', 'Cancel an appointment assigned to the acting doctor'),
  ('appointment:check_in:own', 'Check in to an appointment where the actor is the patient'),
  ('appointment:start:assigned', 'Start an appointment assigned to the acting doctor'),
  ('appointment:read:global', 'Read non-clinical appointment metadata across organizations')
ON CONFLICT (permission_id) DO UPDATE SET description = EXCLUDED.description;--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('patient', 'appointment:check_in:own'),
  ('doctor', 'appointment:cancel:assigned'),
  ('doctor', 'appointment:start:assigned'),
  ('super_admin', 'appointment:read:global')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id IN (
      'appointment:cancel:assigned','appointment:start:assigned'
    ) AND role_id <> 'doctor'
  ) THEN
    RAISE EXCEPTION 'WP-05 assigned lifecycle permissions must remain doctor-only';
  END IF;
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'appointment:read:global' AND role_id <> 'super_admin'
  ) THEN
    RAISE EXCEPTION 'WP-05 global appointment metadata must remain super-admin-only';
  END IF;
END;
$$;--> statement-breakpoint

INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 12)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
