-- Add in-database avatar and prescription document storage.
--
-- For the FYP demo, avatars and generated prescription documents are stored as
-- bytea directly in PostgreSQL. This avoids requiring R2 credentials or a separate
-- object-storage pipeline for the demo, while still being a real, persistent backend
-- implementation. The columns are nullable and have a sensible byte-size limit for
-- profile photos and single-page prescription PDFs.

ALTER TABLE "public"."profiles"
  ADD COLUMN "avatar_bytes" bytea,
  ADD COLUMN "avatar_media_type" varchar(160);

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_avatar_media_type_set_check"
    CHECK (("avatar_bytes" IS NULL) = ("avatar_media_type" IS NULL));

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_avatar_bytes_size_check"
    CHECK ("avatar_bytes" IS NULL OR octet_length("avatar_bytes") <= 2 * 1024 * 1024);

ALTER TABLE "public"."prescriptions"
  ADD COLUMN "document_bytes" bytea,
  ADD COLUMN "document_media_type" varchar(160);

ALTER TABLE "public"."prescriptions"
  ADD CONSTRAINT "prescriptions_document_media_type_set_check"
    CHECK (("document_bytes" IS NULL) = ("document_media_type" IS NULL));

ALTER TABLE "public"."prescriptions"
  ADD CONSTRAINT "prescriptions_document_bytes_size_check"
    CHECK ("document_bytes" IS NULL OR octet_length("document_bytes") <= 5 * 1024 * 1024);

-- Record the schema level so the code/migration pair stays aligned.
-- This migration only adds nullable columns and CHECK constraints, so it does not
-- change the identity compatibility version.
