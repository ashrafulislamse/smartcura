-- Removes a duplicate set of profile-detail tables.
--
-- WHY THESE EXIST AT ALL
-- Migration 0011 and migration 0015 were authored independently and modelled the
-- same facts under different names, so the database ended up holding two rival
-- sets of tables for one concept:
--
--   0011 (orphaned)                0015 (canonical)
--   profile_addresses              patient_addresses
--   profile_allergies              patient_allergies
--   profile_conditions             patient_conditions
--   profile_emergency_contacts     patient_emergency_contacts
--   doctor_details                 doctor_professional_details
--   doctor_languages               doctor_professional_languages
--   doctor_specialties             doctor_professional_specialties
--
-- WHY THE 0015 SET IS THE ONE KEPT
-- Only the 0015 set has repositories and HTTP endpoints behind it
-- (`patient-profile-repository.ts`, `doctor-detail-repository.ts`,
-- `ProfileDetailsController`, `DoctorDetailsController`). Nothing wrote to the
-- 0011 set. Keeping both is not a neutral cost: "does this patient have a
-- recorded allergy?" had two answers, and the appointment fee lookup was in fact
-- reading the empty `doctor_details` table, so no appointment could ever be
-- priced.
--
-- SAFETY
-- These tables are dropped rather than renamed because they were never written
-- to, so there is no data to preserve and a rename would leave two names for one
-- table in the migration history. The DROPs are ordered children-before-parents
-- and use CASCADE only where a dependent index or constraint belongs solely to
-- the table being removed. If a future deployment finds rows here, the drop
-- should be halted and the rows migrated first, which the guard below enforces.
DO $$
DECLARE
  populated text;
BEGIN
  SELECT string_agg(format('%s (%s rows)', source.table_name, source.row_count), ', ')
  INTO populated
  FROM (
    SELECT 'profile_addresses' AS table_name, count(*) AS row_count FROM profile_addresses
    UNION ALL SELECT 'profile_allergies', count(*) FROM profile_allergies
    UNION ALL SELECT 'profile_conditions', count(*) FROM profile_conditions
    UNION ALL SELECT 'profile_emergency_contacts', count(*) FROM profile_emergency_contacts
    UNION ALL SELECT 'doctor_details', count(*) FROM doctor_details
    UNION ALL SELECT 'doctor_languages', count(*) FROM doctor_languages
    UNION ALL SELECT 'doctor_specialties', count(*) FROM doctor_specialties
  ) AS source
  WHERE source.row_count > 0;

  IF populated IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0016 aborted: orphaned profile-detail tables are not empty (%). Migrate these rows into the patient_*/doctor_professional_* tables before dropping.',
      populated;
  END IF;
END;
$$;--> statement-breakpoint
DROP TABLE IF EXISTS "doctor_languages";--> statement-breakpoint
DROP TABLE IF EXISTS "doctor_specialties";--> statement-breakpoint
DROP TABLE IF EXISTS "doctor_details";--> statement-breakpoint
DROP TABLE IF EXISTS "profile_allergies";--> statement-breakpoint
DROP TABLE IF EXISTS "profile_conditions";--> statement-breakpoint
DROP TABLE IF EXISTS "profile_emergency_contacts";--> statement-breakpoint
DROP TABLE IF EXISTS "profile_addresses";--> statement-breakpoint
INSERT INTO schema_compatibility (component, version)
VALUES ('profiles', 2)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
