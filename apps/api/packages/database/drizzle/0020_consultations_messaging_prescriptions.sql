CREATE TYPE "public"."consultation_status" AS ENUM('not_started', 'ready', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."clinical_note_status" AS ENUM('draft', 'signed', 'superseded', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."prescription_status" AS ENUM('draft', 'signed', 'superseded', 'cancelled', 'expired', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'file', 'system');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('queued', 'processing', 'delivered', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('account_security', 'appointments', 'consultations', 'messages', 'prescriptions', 'vitals_alerts', 'ai_review', 'delivery', 'emergency', 'system');--> statement-breakpoint
CREATE TYPE "public"."generated_document_status" AS ENUM('pending', 'ready', 'failed');

--> statement-breakpoint
CREATE TABLE "consultations" (
  "consultation_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "appointment_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_profile_id" uuid NOT NULL,
  "doctor_membership_id" uuid NOT NULL,
  "status" "consultation_status" DEFAULT 'not_started' NOT NULL,
  "outcome_code" varchar(64),
  "version" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "consultations_appointment_uq" UNIQUE("appointment_id"),
  CONSTRAINT "consultations_version_check" CHECK ("version" >= 0),
  CONSTRAINT "consultations_outcome_code_check" CHECK ("outcome_code" IS NULL OR "outcome_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "consultations_started_check" CHECK (("status" IN ('in_progress','completed')) = ("started_at" IS NOT NULL)),
  CONSTRAINT "consultations_completed_check" CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "consultation_status_history" (
  "history_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "consultation_id" uuid NOT NULL,
  "previous_status" "consultation_status",
  "status" "consultation_status" NOT NULL,
  "reason_code" varchar(64),
  "actor_profile_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "consultation_history_progress_check" CHECK ("previous_status" IS NULL OR "previous_status" <> "status"),
  CONSTRAINT "consultation_history_reason_check" CHECK ("reason_code" IS NULL OR "reason_code" ~ '^[a-z][a-z0-9_]{1,62}$')
);--> statement-breakpoint
CREATE TABLE "conversations" (
  "conversation_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "consultation_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "status" "conversation_status" DEFAULT 'active' NOT NULL,
  "next_sequence_no" bigint DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversations_consultation_uq" UNIQUE("consultation_id"),
  CONSTRAINT "conversations_sequence_check" CHECK ("next_sequence_no" >= 1)
);--> statement-breakpoint
CREATE TABLE "conversation_participants" (
  "conversation_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "membership_id" uuid,
  "participant_kind" varchar(16) NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  "muted_at" timestamp with time zone,
  CONSTRAINT "conversation_participants_pk" PRIMARY KEY("conversation_id","profile_id"),
  CONSTRAINT "conversation_participant_kind_check" CHECK ("participant_kind" IN ('patient','doctor')),
  CONSTRAINT "conversation_participant_membership_check" CHECK (("participant_kind" = 'doctor') = ("membership_id" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "messages" (
  "message_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "conversation_id" uuid NOT NULL,
  "sender_profile_id" uuid NOT NULL,
  "sequence_no" bigint NOT NULL,
  "client_correlation_id" uuid NOT NULL,
  "message_type" "message_type" NOT NULL,
  "text_content" text,
  "file_object_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "messages_sequence_positive_check" CHECK ("sequence_no" >= 1),
  CONSTRAINT "messages_shape_check" CHECK (
    ("message_type" = 'text' AND "text_content" IS NOT NULL AND length(btrim("text_content")) BETWEEN 1 AND 4000 AND "file_object_id" IS NULL)
    OR ("message_type" = 'file' AND "text_content" IS NULL AND "file_object_id" IS NOT NULL)
    OR ("message_type" = 'system' AND "text_content" IS NOT NULL AND length("text_content") BETWEEN 1 AND 4000 AND "file_object_id" IS NULL)
  )
);--> statement-breakpoint
CREATE TABLE "message_receipts" (
  "message_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "delivered_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  CONSTRAINT "message_receipts_pk" PRIMARY KEY("message_id","profile_id"),
  CONSTRAINT "message_receipts_order_check" CHECK ("read_at" IS NULL OR "delivered_at" IS NULL OR "read_at" >= "delivered_at")
);--> statement-breakpoint
CREATE TABLE "clinical_notes" (
  "note_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "consultation_id" uuid NOT NULL,
  "author_membership_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "version_no" integer NOT NULL,
  "status" "clinical_note_status" DEFAULT 'draft' NOT NULL,
  "content" jsonb NOT NULL,
  "replaces_note_id" uuid,
  "signed_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "clinical_notes_version_no_check" CHECK ("version_no" >= 1),
  CONSTRAINT "clinical_notes_version_check" CHECK ("version" >= 0),
  CONSTRAINT "clinical_notes_content_check" CHECK (jsonb_typeof("content") = 'object' AND octet_length("content"::text) <= 65536),
  CONSTRAINT "clinical_notes_signed_check" CHECK (("status" IN ('signed','superseded')) = ("signed_at" IS NOT NULL)),
  CONSTRAINT "clinical_notes_replacement_self_check" CHECK ("replaces_note_id" IS NULL OR "replaces_note_id" <> "note_id")
);--> statement-breakpoint
CREATE TABLE "prescriptions" (
  "prescription_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "consultation_id" uuid NOT NULL,
  "patient_profile_id" uuid NOT NULL,
  "doctor_membership_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "status" "prescription_status" DEFAULT 'draft' NOT NULL,
  "replaces_prescription_id" uuid,
  "cancellation_reason_code" varchar(64),
  "signed_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prescriptions_version_check" CHECK ("version" >= 0),
  CONSTRAINT "prescriptions_signed_check" CHECK (("status" IN ('signed','superseded','cancelled','expired')) = ("signed_at" IS NOT NULL)),
  CONSTRAINT "prescriptions_cancel_reason_check" CHECK (("status" = 'cancelled') = ("cancellation_reason_code" IS NOT NULL)),
  CONSTRAINT "prescriptions_cancel_reason_code_check" CHECK ("cancellation_reason_code" IS NULL OR "cancellation_reason_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "prescriptions_expiry_check" CHECK ("expires_at" IS NULL OR "signed_at" IS NULL OR "expires_at" > "signed_at"),
  CONSTRAINT "prescriptions_replacement_self_check" CHECK ("replaces_prescription_id" IS NULL OR "replaces_prescription_id" <> "prescription_id")
);--> statement-breakpoint
CREATE TABLE "prescription_items" (
  "prescription_item_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "prescription_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "medication_reference" varchar(128),
  "medication_text" varchar(240),
  "dose_value" numeric(12,4) NOT NULL,
  "dose_unit" varchar(32) NOT NULL,
  "route_code" varchar(64) NOT NULL,
  "frequency_code" varchar(64),
  "frequency_text" varchar(160),
  "duration_days" integer NOT NULL,
  "patient_instructions" text,
  CONSTRAINT "prescription_items_position_check" CHECK ("position" >= 1),
  CONSTRAINT "prescription_items_medication_check" CHECK (("medication_reference" IS NOT NULL) OR ("medication_text" IS NOT NULL AND length(btrim("medication_text")) BETWEEN 1 AND 240)),
  CONSTRAINT "prescription_items_dose_check" CHECK ("dose_value" > 0),
  CONSTRAINT "prescription_items_duration_check" CHECK ("duration_days" BETWEEN 1 AND 365),
  CONSTRAINT "prescription_items_frequency_check" CHECK ("frequency_code" IS NOT NULL OR ("frequency_text" IS NOT NULL AND length(btrim("frequency_text")) > 0))
);--> statement-breakpoint
CREATE TABLE "prescription_status_history" (
  "history_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "prescription_id" uuid NOT NULL,
  "previous_status" "prescription_status",
  "status" "prescription_status" NOT NULL,
  "reason_code" varchar(64),
  "actor_profile_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prescription_history_progress_check" CHECK ("previous_status" IS NULL OR "previous_status" <> "status")
);--> statement-breakpoint
CREATE TABLE "prescription_documents" (
  "prescription_id" uuid PRIMARY KEY NOT NULL,
  "status" "generated_document_status" DEFAULT 'pending' NOT NULL,
  "object_key" varchar(512),
  "sha256" varchar(64),
  "size_bytes" bigint,
  "generated_at" timestamp with time zone,
  "failure_code" varchar(64),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prescription_documents_ready_check" CHECK (("status" = 'ready') = ("object_key" IS NOT NULL AND "sha256" IS NOT NULL AND "size_bytes" IS NOT NULL AND "generated_at" IS NOT NULL)),
  CONSTRAINT "prescription_documents_sha_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "prescription_documents_size_check" CHECK ("size_bytes" IS NULL OR "size_bytes" > 0)
);--> statement-breakpoint
CREATE TABLE "notifications" (
  "notification_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "profile_id" uuid NOT NULL,
  "category" "notification_category" NOT NULL,
  "resource_type" varchar(64) NOT NULL,
  "resource_id" uuid NOT NULL,
  "title_code" varchar(64) NOT NULL,
  "body_code" varchar(64) NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_title_code_check" CHECK ("title_code" ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  CONSTRAINT "notifications_body_code_check" CHECK ("body_code" ~ '^[a-z][a-z0-9_.-]{1,62}$')
);--> statement-breakpoint
CREATE TABLE "notification_preferences" (
  "profile_id" uuid NOT NULL,
  "category" "notification_category" NOT NULL,
  "channel" "notification_channel" NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "quiet_hours_start" time,
  "quiet_hours_end" time,
  "timezone" varchar(64) DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_preferences_pk" PRIMARY KEY("profile_id","category","channel"),
  CONSTRAINT "notification_preferences_in_app_check" CHECK ("channel" <> 'in_app' OR "enabled"),
  CONSTRAINT "notification_preferences_quiet_pair_check" CHECK (("quiet_hours_start" IS NULL) = ("quiet_hours_end" IS NULL)),
  CONSTRAINT "notification_preferences_timezone_check" CHECK (length("timezone") BETWEEN 1 AND 64)
);--> statement-breakpoint
CREATE TABLE "push_devices" (
  "push_device_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "profile_id" uuid NOT NULL,
  "platform" varchar(16) NOT NULL,
  "token_ciphertext" text NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_devices_platform_check" CHECK ("platform" IN ('android','ios','web')),
  CONSTRAINT "push_devices_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
  "delivery_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "notification_id" uuid NOT NULL,
  "channel" "notification_channel" NOT NULL,
  "status" "notification_delivery_status" DEFAULT 'queued' NOT NULL,
  "provider_reference" varchar(128),
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error_code" varchar(64),
  "delivered_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_deliveries_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "notification_deliveries_delivered_check" CHECK (("status" = 'delivered') = ("delivered_at" IS NOT NULL))
);--> statement-breakpoint

CREATE INDEX "consultations_patient_created_idx" ON "consultations" ("patient_profile_id","created_at","consultation_id");--> statement-breakpoint
CREATE INDEX "consultations_doctor_created_idx" ON "consultations" ("doctor_membership_id","created_at","consultation_id");--> statement-breakpoint
CREATE INDEX "consultation_history_consultation_idx" ON "consultation_status_history" ("consultation_id","occurred_at","history_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_sequence_uq" ON "messages" ("conversation_id","sequence_no");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_sender_correlation_uq" ON "messages" ("conversation_id","sender_profile_id","client_correlation_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_cursor_idx" ON "messages" ("conversation_id","sequence_no","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_notes_consultation_version_uq" ON "clinical_notes" ("consultation_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_notes_replacement_uq" ON "clinical_notes" ("replaces_note_id") WHERE "replaces_note_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "clinical_notes_consultation_created_idx" ON "clinical_notes" ("consultation_id","created_at","note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_replacement_uq" ON "prescriptions" ("replaces_prescription_id") WHERE "replaces_prescription_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prescriptions_patient_created_idx" ON "prescriptions" ("patient_profile_id","created_at","prescription_id");--> statement-breakpoint
CREATE INDEX "prescriptions_doctor_created_idx" ON "prescriptions" ("doctor_membership_id","created_at","prescription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescription_items_position_uq" ON "prescription_items" ("prescription_id","position");--> statement-breakpoint
CREATE INDEX "notifications_profile_cursor_idx" ON "notifications" ("profile_id","created_at" DESC,"notification_id" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_token_hash_uq" ON "push_devices" ("token_hash");--> statement-breakpoint
CREATE INDEX "push_devices_profile_enabled_idx" ON "push_devices" ("profile_id","enabled","push_device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_notification_channel_uq" ON "notification_deliveries" ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_work_idx" ON "notification_deliveries" ("status","updated_at","delivery_id") WHERE "channel" = 'push';--> statement-breakpoint

ALTER TABLE "consultations" ADD CONSTRAINT "consultations_appointment_fk" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("appointment_id");--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_doctor_fk" FOREIGN KEY ("doctor_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "consultation_status_history" ADD CONSTRAINT "consultation_history_consultation_fk" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("consultation_id");--> statement-breakpoint
ALTER TABLE "consultation_status_history" ADD CONSTRAINT "consultation_history_actor_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_consultation_fk" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("consultation_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("conversation_id");--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_membership_fk" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("conversation_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_fk" FOREIGN KEY ("sender_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_file_fk" FOREIGN KEY ("file_object_id") REFERENCES "stored_objects"("object_id");--> statement-breakpoint
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_message_fk" FOREIGN KEY ("message_id") REFERENCES "messages"("message_id");--> statement-breakpoint
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_consultation_fk" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("consultation_id");--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_author_fk" FOREIGN KEY ("author_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_replaces_fk" FOREIGN KEY ("replaces_note_id") REFERENCES "clinical_notes"("note_id");--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_consultation_fk" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("consultation_id");--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_fk" FOREIGN KEY ("doctor_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_replaces_fk" FOREIGN KEY ("replaces_prescription_id") REFERENCES "prescriptions"("prescription_id");--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_fk" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("prescription_id");--> statement-breakpoint
ALTER TABLE "prescription_status_history" ADD CONSTRAINT "prescription_history_prescription_fk" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("prescription_id");--> statement-breakpoint
ALTER TABLE "prescription_status_history" ADD CONSTRAINT "prescription_history_actor_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "prescription_documents" ADD CONSTRAINT "prescription_documents_prescription_fk" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("prescription_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_fk" FOREIGN KEY ("notification_id") REFERENCES "notifications"("notification_id");

--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_consultation_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'consultation history is append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER consultation_history_reject_mutation BEFORE UPDATE OR DELETE ON "consultation_status_history" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_consultation_history();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_prescription_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'prescription history is append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER prescription_history_reject_mutation BEFORE UPDATE OR DELETE ON "prescription_status_history" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_prescription_history();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_protect_signed_clinical_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status IN ('signed','superseded') AND (NEW.content IS DISTINCT FROM OLD.content OR NEW.author_membership_id IS DISTINCT FROM OLD.author_membership_id OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id OR NEW.signed_at IS DISTINCT FROM OLD.signed_at) THEN RAISE EXCEPTION 'signed clinical note content is immutable' USING ERRCODE = '55000'; END IF; RETURN NEW; END; $$;--> statement-breakpoint
CREATE TRIGGER clinical_notes_protect_signed BEFORE UPDATE ON "clinical_notes" FOR EACH ROW EXECUTE FUNCTION smartcura_protect_signed_clinical_note();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_protect_signed_prescription() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status IN ('signed','superseded','cancelled','expired') AND (NEW.patient_profile_id IS DISTINCT FROM OLD.patient_profile_id OR NEW.doctor_membership_id IS DISTINCT FROM OLD.doctor_membership_id OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id OR NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN RAISE EXCEPTION 'signed prescription is immutable' USING ERRCODE = '55000'; END IF; RETURN NEW; END; $$;--> statement-breakpoint
CREATE TRIGGER prescriptions_protect_signed BEFORE UPDATE ON "prescriptions" FOR EACH ROW EXECUTE FUNCTION smartcura_protect_signed_prescription();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_protect_prescription_items() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE parent_status prescription_status; parent_id uuid; BEGIN parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.prescription_id ELSE NEW.prescription_id END; SELECT status INTO parent_status FROM prescriptions WHERE prescription_id = parent_id; IF parent_status <> 'draft' THEN RAISE EXCEPTION 'signed prescription items are immutable' USING ERRCODE = '55000'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $$;--> statement-breakpoint
CREATE TRIGGER prescription_items_protect_signed BEFORE INSERT OR UPDATE OR DELETE ON "prescription_items" FOR EACH ROW EXECUTE FUNCTION smartcura_protect_prescription_items();

--> statement-breakpoint
INSERT INTO permissions (permission_id, description) VALUES
 ('consultation:read:own', 'Read an owned consultation'),
 ('clinical_note:read:assigned', 'Read assigned consultation notes'),
 ('prescription:read:assigned', 'Read an issued assigned prescription'),
 ('conversation:read:assigned', 'Read an assigned consultation conversation'),
 ('notification:read:own', 'Read own in-app notifications'),
 ('notification.preference:manage:own', 'Manage own optional notification preferences')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) VALUES
 ('patient','consultation:read:own'), ('patient','notification:read:own'), ('patient','notification.preference:manage:own'),
 ('doctor','clinical_note:read:assigned'), ('doctor','prescription:read:assigned'), ('doctor','conversation:read:assigned'),
 ('doctor','notification:read:own'), ('doctor','notification.preference:manage:own')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO schema_compatibility (component, version) VALUES ('identity', 13)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
