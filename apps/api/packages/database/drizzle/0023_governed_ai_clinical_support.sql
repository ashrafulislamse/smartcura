-- WP-08 governed AI clinical support.
--
-- ONE migration is safe here because every enum is NEW. The 0018/0019 and
-- 0021/0022 splits existed because `ALTER TYPE ... ADD VALUE` cannot be used in
-- the transaction that added it; `CREATE TYPE` has no such restriction.
--
-- STRUCTURAL GUARANTEE. No table here has a foreign key to `prescriptions`,
-- `health_alerts`, `appointments` or any emergency table, and nothing here writes
-- them. The prohibited-action rule is therefore enforced by the shape of the
-- schema rather than by reviewer discipline: there is no column an AI writer could
-- use to change diagnosis, medication, alert or care state even if application
-- code were wrong. Approved output is advisory input a clinician reads.
--
-- pgvector DEFERRED, and deliberately so. The design of record selects pgvector
-- for retrieval, but the pinned local image `postgres:18.4-alpine3.23` does not
-- ship it, and `CREATE EXTENSION vector` would fail the WP-02L migration gate
-- that has already been verified against a real database. Embeddings are stored
-- as `real[]` with an enforced dimension so the data is correct and complete now;
-- adding the `vector` column plus an ANN index is a follow-up migration once the
-- runtime image ships the extension. Retrieval is behind a port, so that swap is
-- a query change and not a schema redesign.

CREATE TYPE "public"."ai_conversation_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('patient', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."ai_generation_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."ai_artifact_type" AS ENUM('symptom_summary', 'care_navigation', 'risk_flag', 'forecast', 'anomaly');--> statement-breakpoint
CREATE TYPE "public"."ai_review_status" AS ENUM('pending_review', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."ai_risk_level" AS ENUM('unknown', 'low', 'moderate', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ai_safety_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('mock', 'gemini');--> statement-breakpoint
CREATE TYPE "public"."knowledge_document_status" AS ENUM('draft', 'published', 'retired');

--> statement-breakpoint
-- Model governance. `provides_calibrated_confidence` is the gate that makes the
-- catalogue's confidence rule enforceable: a confidence score may only be stored
-- when the producing model actually defines and validates one. An LLM's own
-- certainty percentage is not a calibrated score, so `mock` and `gemini` rows set
-- this false and every artifact they produce must leave confidence NULL.
CREATE TABLE "ai_models" (
  "model_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "provider" "ai_provider" NOT NULL,
  "name" varchar(128) NOT NULL,
  "version" varchar(64) NOT NULL,
  "provides_calibrated_confidence" boolean DEFAULT false NOT NULL,
  "retired_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_models_name_check" CHECK ("name" ~ '^[a-z0-9][a-z0-9._-]{1,127}$'),
  CONSTRAINT "ai_models_version_check" CHECK (length("version") BETWEEN 1 AND 64)
);--> statement-breakpoint

-- Prompt templates are versioned and content-hashed. The hash is what makes a
-- generation reproducible: without it an edited template would silently change
-- what a stored artifact claims it was produced from.
CREATE TABLE "prompt_templates" (
  "prompt_template_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "template_key" varchar(64) NOT NULL,
  "version" integer NOT NULL,
  "artifact_type" "ai_artifact_type" NOT NULL,
  "body" text NOT NULL,
  "body_sha256" varchar(64) NOT NULL,
  "retired_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prompt_templates_key_check" CHECK ("template_key" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "prompt_templates_version_check" CHECK ("version" >= 1),
  CONSTRAINT "prompt_templates_sha_check" CHECK ("body_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "prompt_templates_body_check" CHECK (length("body") BETWEEN 1 AND 20000)
);--> statement-breakpoint

CREATE TABLE "knowledge_sources" (
  "source_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "name" varchar(160) NOT NULL,
  "publisher" varchar(160) NOT NULL,
  "url" varchar(1024),
  "licence_code" varchar(64) NOT NULL,
  "retrieved_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_sources_licence_check" CHECK ("licence_code" ~ '^[a-z][a-z0-9_.-]{1,62}$')
);--> statement-breakpoint

-- Knowledge is general clinical reference material, never patient data. There is
-- deliberately no patient foreign key: mixing one patient's record into a shared
-- retrieval corpus would leak it into every other patient's generation.
CREATE TABLE "knowledge_documents" (
  "document_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "source_id" uuid NOT NULL,
  "title" varchar(320) NOT NULL,
  "language" varchar(35) DEFAULT 'en' NOT NULL,
  "status" "knowledge_document_status" DEFAULT 'draft' NOT NULL,
  "content_sha256" varchar(64) NOT NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_documents_sha_check" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "knowledge_documents_published_check" CHECK (("status" = 'published') = ("published_at" IS NOT NULL))
);--> statement-breakpoint

CREATE TABLE "knowledge_chunks" (
  "chunk_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "document_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "content" text NOT NULL,
  "token_count" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_chunks_ordinal_check" CHECK ("ordinal" >= 1),
  CONSTRAINT "knowledge_chunks_content_check" CHECK (length("content") BETWEEN 1 AND 8000),
  CONSTRAINT "knowledge_chunks_token_check" CHECK ("token_count" > 0)
);--> statement-breakpoint

-- One embedding per chunk per embedding model. `dimension` is stored and checked
-- against the array length so a model swap cannot silently mix incompatible
-- vector spaces, which would return confidently wrong neighbours.
CREATE TABLE "knowledge_embeddings" (
  "embedding_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "chunk_id" uuid NOT NULL,
  "model_id" uuid NOT NULL,
  "dimension" integer NOT NULL,
  "embedding" real[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_embeddings_dimension_check" CHECK ("dimension" BETWEEN 1 AND 4096),
  CONSTRAINT "knowledge_embeddings_length_check" CHECK (array_length("embedding", 1) = "dimension")
);--> statement-breakpoint

CREATE TABLE "ai_conversations" (
  "conversation_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "patient_profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "status" "ai_conversation_status" DEFAULT 'active' NOT NULL,
  "next_sequence_no" bigint DEFAULT 1 NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_conversations_sequence_check" CHECK ("next_sequence_no" >= 1),
  CONSTRAINT "ai_conversations_version_check" CHECK ("version" >= 0)
);--> statement-breakpoint

-- Append-only transcript. `role` is server-assigned: a patient request can never
-- inject an `assistant` or `system` turn, which is the cheapest prompt-injection
-- foothold in a chat product.
CREATE TABLE "ai_messages" (
  "message_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "conversation_id" uuid NOT NULL,
  "role" "ai_message_role" NOT NULL,
  "sequence_no" bigint NOT NULL,
  "content" text NOT NULL,
  "client_correlation_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_messages_sequence_check" CHECK ("sequence_no" >= 1),
  CONSTRAINT "ai_messages_content_check" CHECK (length("content") BETWEEN 1 AND 8000),
  -- Only a patient turn carries a client correlation id; a server-authored turn
  -- has no offline retry identity to deduplicate.
  CONSTRAINT "ai_messages_correlation_check" CHECK (("role" = 'patient') OR ("client_correlation_id" IS NULL))
);--> statement-breakpoint

-- A generation attempt. Separate from the artifact because an attempt may end
-- `failed` or `blocked` and produce no artifact at all, and that outcome must
-- still be recorded with its reason.
CREATE TABLE "ai_generations" (
  "generation_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "conversation_id" uuid,
  "patient_profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "artifact_type" "ai_artifact_type" NOT NULL,
  "model_id" uuid NOT NULL,
  "prompt_template_id" uuid NOT NULL,
  "status" "ai_generation_status" DEFAULT 'queued' NOT NULL,
  "generation_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "input_data_classes" varchar(32)[] NOT NULL,
  "input_window_from" timestamp with time zone,
  "input_window_to" timestamp with time zone,
  "requested_by_profile_id" uuid NOT NULL,
  "failure_code" varchar(64),
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_generations_version_check" CHECK ("version" >= 0),
  CONSTRAINT "ai_generations_parameters_check" CHECK (jsonb_typeof("generation_parameters") = 'object' AND octet_length("generation_parameters"::text) <= 4096),
  -- The input data classes are the privacy record of what was fed to a provider.
  -- An empty array would make the generation unauditable.
  CONSTRAINT "ai_generations_input_classes_check" CHECK (array_length("input_data_classes", 1) BETWEEN 1 AND 16),
  CONSTRAINT "ai_generations_window_check" CHECK ("input_window_from" IS NULL OR "input_window_to" IS NULL OR "input_window_to" > "input_window_from"),
  -- A terminal failure must say why; a success must not carry a failure code.
  CONSTRAINT "ai_generations_failure_check" CHECK (("status" IN ('failed', 'blocked')) = ("failure_code" IS NOT NULL))
);--> statement-breakpoint

-- Raw provider candidates, retained for reproducibility and safety review. These
-- are never patient-visible: an unfiltered candidate is exactly the text the
-- safety layer exists to withhold.
CREATE TABLE "ai_candidates" (
  "candidate_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "generation_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "content" jsonb NOT NULL,
  "blocked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_candidates_ordinal_check" CHECK ("ordinal" >= 1),
  CONSTRAINT "ai_candidates_content_check" CHECK (jsonb_typeof("content") = 'object' AND octet_length("content"::text) <= 65536)
);--> statement-breakpoint

-- The governed artifact. Immutable except for its review status: a rerun creates
-- a NEW version rather than editing this row, so what a clinician approved can
-- always be reproduced exactly.
CREATE TABLE "ai_artifacts" (
  "artifact_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "generation_id" uuid NOT NULL,
  "patient_profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "artifact_type" "ai_artifact_type" NOT NULL,
  "version_no" integer NOT NULL,
  "review_status" "ai_review_status" DEFAULT 'pending_review' NOT NULL,
  "risk_level" "ai_risk_level" DEFAULT 'unknown' NOT NULL,
  "confidence" numeric(5, 4),
  "content" jsonb NOT NULL,
  "model_id" uuid NOT NULL,
  "prompt_template_id" uuid NOT NULL,
  "replaces_artifact_id" uuid,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_artifacts_version_no_check" CHECK ("version_no" >= 1),
  CONSTRAINT "ai_artifacts_version_check" CHECK ("version" >= 0),
  CONSTRAINT "ai_artifacts_confidence_range_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "ai_artifacts_content_check" CHECK (jsonb_typeof("content") = 'object' AND octet_length("content"::text) <= 65536),
  CONSTRAINT "ai_artifacts_replacement_self_check" CHECK ("replaces_artifact_id" IS NULL OR "replaces_artifact_id" <> "artifact_id"),
  -- Patient-facing output must be labelled non-diagnostic at the data layer, not
  -- only in a UI string a client could omit.
  CONSTRAINT "ai_artifacts_disclaimer_check" CHECK (("content" -> 'non_diagnostic') = 'true'::jsonb)
);--> statement-breakpoint

-- Retrieval provenance: exactly which chunks were placed in the prompt. Without
-- this an artifact's claims cannot be traced back to a source.
CREATE TABLE "ai_artifact_sources" (
  "artifact_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL,
  "rank" integer NOT NULL,
  "similarity" numeric(6, 5),
  CONSTRAINT "ai_artifact_sources_pk" PRIMARY KEY("artifact_id", "chunk_id"),
  CONSTRAINT "ai_artifact_sources_rank_check" CHECK ("rank" >= 1),
  CONSTRAINT "ai_artifact_sources_similarity_check" CHECK ("similarity" IS NULL OR ("similarity" >= -1 AND "similarity" <= 1))
);--> statement-breakpoint

-- Immutable review trail with actor, decision and rationale.
CREATE TABLE "ai_review_events" (
  "review_event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "artifact_id" uuid NOT NULL,
  "reviewer_membership_id" uuid NOT NULL,
  "reviewer_profile_id" uuid NOT NULL,
  "previous_status" "ai_review_status" NOT NULL,
  "decision" "ai_review_status" NOT NULL,
  "rationale_code" varchar(64) NOT NULL,
  "correlation_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_review_events_rationale_check" CHECK ("rationale_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT "ai_review_events_progress_check" CHECK ("previous_status" <> "decision"),
  -- A review decision is a human verdict. `pending_review` is the state a
  -- generation produces, so it can never be the outcome of a review.
  CONSTRAINT "ai_review_events_decision_check" CHECK ("decision" IN ('approved', 'rejected', 'superseded'))
);--> statement-breakpoint

CREATE TABLE "ai_usage" (
  "usage_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "generation_id" uuid NOT NULL,
  "model_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "prompt_tokens" integer NOT NULL,
  "completion_tokens" integer NOT NULL,
  "latency_ms" integer NOT NULL,
  "estimated_cost_sen" bigint DEFAULT 0 NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_usage_prompt_tokens_check" CHECK ("prompt_tokens" >= 0),
  CONSTRAINT "ai_usage_completion_tokens_check" CHECK ("completion_tokens" >= 0),
  CONSTRAINT "ai_usage_latency_check" CHECK ("latency_ms" >= 0),
  -- Integer MYR sen, matching every other money value in the platform.
  CONSTRAINT "ai_usage_cost_check" CHECK ("estimated_cost_sen" >= 0)
);--> statement-breakpoint

CREATE TABLE "ai_safety_events" (
  "safety_event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "generation_id" uuid NOT NULL,
  "severity" "ai_safety_severity" NOT NULL,
  "category_code" varchar(64) NOT NULL,
  "blocked" boolean NOT NULL,
  "detail_code" varchar(64),
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_safety_events_category_check" CHECK ("category_code" ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- Only a critical finding may block delivery; an informational note must not
  -- silently withhold output, and a block must not be recorded as harmless.
  CONSTRAINT "ai_safety_events_block_check" CHECK ("blocked" = false OR "severity" = 'critical')
);--> statement-breakpoint

-- Statistical prediction from the narrow FastAPI sidecar. Separate from LLM
-- artifacts because a forecast DOES have a calibrated interval, which is exactly
-- the case the confidence rule permits.
CREATE TABLE "forecasts" (
  "forecast_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "patient_profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "metric" "vital_metric" NOT NULL,
  "model_id" uuid NOT NULL,
  "horizon_hours" integer NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "forecasts_horizon_check" CHECK ("horizon_hours" BETWEEN 1 AND 720)
);--> statement-breakpoint

CREATE TABLE "forecast_points" (
  "forecast_point_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "forecast_id" uuid NOT NULL,
  "predicted_for" timestamp with time zone NOT NULL,
  "value" numeric(12, 4) NOT NULL,
  "lower_bound" numeric(12, 4) NOT NULL,
  "upper_bound" numeric(12, 4) NOT NULL,
  CONSTRAINT "forecast_points_bounds_check" CHECK ("lower_bound" <= "value" AND "value" <= "upper_bound")
);--> statement-breakpoint

CREATE TABLE "detected_anomalies" (
  "anomaly_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "patient_profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "metric" "vital_metric" NOT NULL,
  "model_id" uuid NOT NULL,
  "score" numeric(8, 5) NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "detected_anomalies_score_check" CHECK ("score" >= 0)
);--> statement-breakpoint

CREATE UNIQUE INDEX "ai_models_identity_uq" ON "ai_models" ("provider", "name", "version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_templates_key_version_uq" ON "prompt_templates" ("template_key", "version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_document_ordinal_uq" ON "knowledge_chunks" ("document_id", "ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_embeddings_chunk_model_uq" ON "knowledge_embeddings" ("chunk_id", "model_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_patient_idx" ON "ai_conversations" ("patient_profile_id", "created_at", "conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_messages_conversation_sequence_uq" ON "ai_messages" ("conversation_id", "sequence_no");--> statement-breakpoint
-- Offline retry identity for a patient turn, mirroring the chat contract.
CREATE UNIQUE INDEX "ai_messages_correlation_uq" ON "ai_messages" ("conversation_id", "client_correlation_id") WHERE "client_correlation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_generations_work_idx" ON "ai_generations" ("status", "created_at", "generation_id") WHERE "status" IN ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "ai_candidates_generation_ordinal_uq" ON "ai_candidates" ("generation_id", "ordinal");--> statement-breakpoint
-- One artifact per generation: a second would make "the output" ambiguous.
CREATE UNIQUE INDEX "ai_artifacts_generation_uq" ON "ai_artifacts" ("generation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_artifacts_version_uq" ON "ai_artifacts" ("patient_profile_id", "artifact_type", "version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_artifacts_replacement_uq" ON "ai_artifacts" ("replaces_artifact_id") WHERE "replaces_artifact_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_artifacts_review_idx" ON "ai_artifacts" ("organization_id", "review_status", "created_at", "artifact_id");--> statement-breakpoint
CREATE INDEX "ai_review_events_artifact_idx" ON "ai_review_events" ("artifact_id", "occurred_at", "review_event_id");--> statement-breakpoint
CREATE INDEX "ai_usage_organization_idx" ON "ai_usage" ("organization_id", "occurred_at", "usage_id");--> statement-breakpoint
CREATE INDEX "ai_safety_events_generation_idx" ON "ai_safety_events" ("generation_id", "occurred_at", "safety_event_id");--> statement-breakpoint
CREATE INDEX "forecast_points_forecast_idx" ON "forecast_points" ("forecast_id", "predicted_for");--> statement-breakpoint
CREATE INDEX "detected_anomalies_patient_idx" ON "detected_anomalies" ("patient_profile_id", "observed_at", "anomaly_id");--> statement-breakpoint

ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_fk" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("source_id");--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_fk" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("document_id");--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_chunk_fk" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("chunk_id");--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_model_fk" FOREIGN KEY ("model_id") REFERENCES "ai_models"("model_id");--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("conversation_id");--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("conversation_id");--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_model_fk" FOREIGN KEY ("model_id") REFERENCES "ai_models"("model_id");--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_prompt_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "prompt_templates"("prompt_template_id");--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_requester_fk" FOREIGN KEY ("requested_by_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "ai_candidates" ADD CONSTRAINT "ai_candidates_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "ai_generations"("generation_id");--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "ai_generations"("generation_id");--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_model_fk" FOREIGN KEY ("model_id") REFERENCES "ai_models"("model_id");--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_prompt_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "prompt_templates"("prompt_template_id");--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_replaces_fk" FOREIGN KEY ("replaces_artifact_id") REFERENCES "ai_artifacts"("artifact_id");--> statement-breakpoint
ALTER TABLE "ai_artifact_sources" ADD CONSTRAINT "ai_artifact_sources_artifact_fk" FOREIGN KEY ("artifact_id") REFERENCES "ai_artifacts"("artifact_id");--> statement-breakpoint
ALTER TABLE "ai_artifact_sources" ADD CONSTRAINT "ai_artifact_sources_chunk_fk" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("chunk_id");--> statement-breakpoint
ALTER TABLE "ai_review_events" ADD CONSTRAINT "ai_review_events_artifact_fk" FOREIGN KEY ("artifact_id") REFERENCES "ai_artifacts"("artifact_id");--> statement-breakpoint
ALTER TABLE "ai_review_events" ADD CONSTRAINT "ai_review_events_membership_fk" FOREIGN KEY ("reviewer_membership_id") REFERENCES "organization_memberships"("membership_id");--> statement-breakpoint
ALTER TABLE "ai_review_events" ADD CONSTRAINT "ai_review_events_reviewer_fk" FOREIGN KEY ("reviewer_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "ai_generations"("generation_id");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_model_fk" FOREIGN KEY ("model_id") REFERENCES "ai_models"("model_id");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "ai_safety_events" ADD CONSTRAINT "ai_safety_events_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "ai_generations"("generation_id");--> statement-breakpoint
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_model_fk" FOREIGN KEY ("model_id") REFERENCES "ai_models"("model_id");--> statement-breakpoint
ALTER TABLE "forecast_points" ADD CONSTRAINT "forecast_points_forecast_fk" FOREIGN KEY ("forecast_id") REFERENCES "forecasts"("forecast_id");--> statement-breakpoint
ALTER TABLE "detected_anomalies" ADD CONSTRAINT "detected_anomalies_patient_fk" FOREIGN KEY ("patient_profile_id") REFERENCES "profiles"("profile_id");--> statement-breakpoint
ALTER TABLE "detected_anomalies" ADD CONSTRAINT "detected_anomalies_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("organization_id");--> statement-breakpoint
ALTER TABLE "detected_anomalies" ADD CONSTRAINT "detected_anomalies_model_fk" FOREIGN KEY ("model_id") REFERENCES "ai_models"("model_id");--> statement-breakpoint
ALTER TABLE "vital_readings" ADD CONSTRAINT "vital_readings_calibration_fk" FOREIGN KEY ("calibration_id") REFERENCES "device_calibrations"("calibration_id");

--> statement-breakpoint
-- Artifacts are immutable except for review status and its bookkeeping. Editing
-- approved content in place would destroy the guarantee that a clinician's
-- decision can be reproduced.
CREATE OR REPLACE FUNCTION smartcura_protect_ai_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content
     OR NEW.generation_id IS DISTINCT FROM OLD.generation_id
     OR NEW.model_id IS DISTINCT FROM OLD.model_id
     OR NEW.prompt_template_id IS DISTINCT FROM OLD.prompt_template_id
     OR NEW.artifact_type IS DISTINCT FROM OLD.artifact_type
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.patient_profile_id IS DISTINCT FROM OLD.patient_profile_id
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.risk_level IS DISTINCT FROM OLD.risk_level THEN
    RAISE EXCEPTION 'ai artifact content and provenance are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER ai_artifacts_protect_content BEFORE UPDATE ON "ai_artifacts" FOR EACH ROW EXECUTE FUNCTION smartcura_protect_ai_artifact();--> statement-breakpoint

-- Retrieval provenance is fixed at generation time.
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_artifact_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'artifact source provenance is append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER ai_artifact_sources_reject_mutation BEFORE UPDATE OR DELETE ON "ai_artifact_sources" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_artifact_source();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_ai_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ai review events are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER ai_review_events_reject_mutation BEFORE UPDATE OR DELETE ON "ai_review_events" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_ai_review();--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_append_only_ai_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ai messages are append-only' USING ERRCODE = '55000'; END; $$;--> statement-breakpoint
CREATE TRIGGER ai_messages_reject_mutation BEFORE UPDATE OR DELETE ON "ai_messages" FOR EACH ROW EXECUTE FUNCTION smartcura_reject_append_only_ai_message();--> statement-breakpoint

-- THE confidence rule, which no CHECK can express because it spans two tables:
-- a confidence score may exist only when the producing model declares a
-- calibrated one. This is what stops an LLM's self-reported certainty from being
-- charted as a validated probability.
CREATE OR REPLACE FUNCTION smartcura_enforce_ai_confidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE calibrated boolean;
BEGIN
  IF NEW.confidence IS NULL THEN RETURN NEW; END IF;
  SELECT provides_calibrated_confidence INTO calibrated FROM ai_models WHERE model_id = NEW.model_id;
  IF calibrated IS NOT TRUE THEN
    RAISE EXCEPTION 'model does not define a calibrated confidence score' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER ai_artifacts_enforce_confidence BEFORE INSERT OR UPDATE ON "ai_artifacts" FOR EACH ROW EXECUTE FUNCTION smartcura_enforce_ai_confidence();--> statement-breakpoint

-- A blocked generation must carry the critical safety event that blocked it, and
-- a succeeded generation must not claim a block. Deferred to statement end so a
-- single transaction may insert the generation and its safety event in any order.
CREATE OR REPLACE FUNCTION smartcura_enforce_ai_block_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'blocked' AND NOT EXISTS (
    SELECT 1 FROM ai_safety_events
    WHERE generation_id = NEW.generation_id AND blocked = true AND severity = 'critical'
  ) THEN
    RAISE EXCEPTION 'a blocked generation requires a critical safety event' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'succeeded' AND EXISTS (
    SELECT 1 FROM ai_safety_events WHERE generation_id = NEW.generation_id AND blocked = true
  ) THEN
    RAISE EXCEPTION 'a blocked generation cannot be reported as succeeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ai_generations_block_evidence AFTER INSERT OR UPDATE ON "ai_generations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION smartcura_enforce_ai_block_evidence();--> statement-breakpoint

INSERT INTO permissions (permission_id, description) VALUES
 ('ai.conversation:manage:own', 'Start and continue an own AI symptom conversation'),
 ('ai.generation:create:own', 'Request a non-diagnostic AI artifact for own record'),
 ('ai.artifact:read:assigned', 'Read AI artifacts for an assigned patient'),
 ('ai.usage:read:global', 'Read AI provider usage and safety metadata')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id) VALUES
 ('patient', 'ai.conversation:manage:own'),
 ('patient', 'ai.generation:create:own'),
 ('doctor', 'ai.artifact:read:assigned'),
 ('super_admin', 'ai.usage:read:global')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Least-privilege assertions. Review authority must stay with doctors, and no
-- administrator may inherit clinical AI review or patient artifact content.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'ai.artifact:review:assigned' AND role_id <> 'doctor'
  ) THEN
    RAISE EXCEPTION 'AI review authority must remain doctor-only';
  END IF;
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id IN ('ai.artifact:read:assigned', 'ai.generation:create:own')
      AND role_id IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'administrators must not inherit AI clinical content access';
  END IF;
END $$;--> statement-breakpoint

-- Seeded governance rows. `mock` is MANDATORY per the service selection: tests and
-- the offline demo must never depend on a network provider. Neither LLM provider
-- declares a calibrated confidence, so the trigger above forbids storing one.
INSERT INTO ai_models (provider, name, version, provides_calibrated_confidence) VALUES
 ('mock', 'mock-clinical-support', '1.0.0', false),
 ('gemini', 'gemini-2.5-flash', '2026-07', false)
ON CONFLICT (provider, name, version) DO NOTHING;--> statement-breakpoint
INSERT INTO schema_compatibility (component, version) VALUES ('identity', 15)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
