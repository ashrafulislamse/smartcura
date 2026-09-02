-- WP-04 approved-doctor discovery and verified patient reviews.
-- Forward-only migration. It reuses canonical doctor_professional_* and
-- appointments tables; no duplicate profile/detail schema is introduced.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE UNIQUE INDEX "appointments_review_participants_org_uq"
ON "appointments" USING btree
("appointment_id", "doctor_membership_id", "patient_profile_id", "organization_id");--> statement-breakpoint

CREATE TABLE "doctor_reviews" (
  "review_id" uuid PRIMARY KEY NOT NULL,
  "appointment_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "doctor_membership_id" uuid NOT NULL,
  "patient_profile_id" uuid NOT NULL,
  "rating" integer NOT NULL,
  "comment" text,
  "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "doctor_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "doctor_reviews_comment_check" CHECK ("comment" IS NULL OR char_length("comment") BETWEEN 1 AND 1000),
  CONSTRAINT "doctor_reviews_tags_count_check" CHECK (cardinality("tags") <= 5),
  CONSTRAINT "doctor_reviews_tags_allowed_check" CHECK ("tags" <@ ARRAY['good_listener','on_time','clear_explanation','professional','helpful']::text[]),
  CONSTRAINT "doctor_reviews_version_check" CHECK ("version" >= 0)
);--> statement-breakpoint

ALTER TABLE "doctor_reviews" ADD CONSTRAINT "doctor_reviews_appointment_participants_org_fk"
FOREIGN KEY ("appointment_id", "doctor_membership_id", "patient_profile_id", "organization_id")
REFERENCES "appointments"("appointment_id", "doctor_membership_id", "patient_profile_id", "organization_id")
ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_reviews" ADD CONSTRAINT "doctor_reviews_doctor_org_fk"
FOREIGN KEY ("doctor_membership_id", "organization_id")
REFERENCES "organization_memberships"("membership_id", "organization_id")
ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_reviews" ADD CONSTRAINT "doctor_reviews_patient_fk"
FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id")
ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "doctor_reviews_appointment_uq" ON "doctor_reviews" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "doctor_reviews_doctor_created_idx" ON "doctor_reviews" USING btree ("doctor_membership_id", "created_at", "review_id");--> statement-breakpoint
CREATE INDEX "doctor_reviews_doctor_rating_idx" ON "doctor_reviews" USING btree ("doctor_membership_id", "rating");--> statement-breakpoint
CREATE INDEX "profiles_display_name_trgm_idx" ON "profiles" USING gin ("display_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "doctor_professional_details_biography_trgm_idx" ON "doctor_professional_details" USING gin ((COALESCE("biography", '')) gin_trgm_ops);--> statement-breakpoint

-- A review can only be created for a completed appointment. The composite FK
-- proves the patient and doctor identities; this trigger proves the terminal
-- status at the same statement boundary.
CREATE OR REPLACE FUNCTION doctor_reviews_require_completed_appointment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM appointments
    WHERE appointment_id = NEW.appointment_id
      AND doctor_membership_id = NEW.doctor_membership_id
      AND patient_profile_id = NEW.patient_profile_id
      AND organization_id = NEW.organization_id
      AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'doctor review requires the owning completed appointment'
      USING ERRCODE = '23514', CONSTRAINT = 'doctor_reviews_completed_appointment_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER doctor_reviews_require_completed_appointment
BEFORE INSERT OR UPDATE ON doctor_reviews
FOR EACH ROW EXECUTE FUNCTION doctor_reviews_require_completed_appointment();--> statement-breakpoint

INSERT INTO permissions (permission_id, description)
VALUES
  ('doctor_review:read:global', 'Read reviews attached to approved doctor directory profiles'),
  ('doctor_review:write:own', 'Create or replace a review for the authenticated patient completed appointment')
ON CONFLICT (permission_id) DO UPDATE SET description = EXCLUDED.description;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('patient', 'doctor_review:read:global'),
  ('patient', 'doctor_review:write:own'),
  ('doctor', 'doctor_review:read:global'),
  ('admin', 'doctor_review:read:global'),
  ('super_admin', 'doctor_review:read:global')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint

INSERT INTO schema_compatibility (component, version)
VALUES ('profiles', 3)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
