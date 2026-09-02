CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'processed', 'dead_letter');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"audit_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"actor_profile_id" uuid,
	"action" varchar(128) NOT NULL,
	"object_type" varchar(128) NOT NULL,
	"object_id" uuid,
	"reason" text,
	"correlation_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dead_letter_events" (
	"dead_letter_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"error_code" varchar(128) NOT NULL,
	"attempts" integer NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replayed_at" timestamp with time zone,
	"replay_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"organization_id" uuid NOT NULL,
	"actor_profile_id" uuid NOT NULL,
	"operation_id" varchar(128) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(128) NOT NULL,
	"state" varchar(32) NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pk" PRIMARY KEY("organization_id","actor_profile_id","operation_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "inbox_deduplication" (
	"consumer" varchar(128) NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_deduplication_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"event_version" integer NOT NULL,
	"aggregate_type" varchar(128) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"causation_id" uuid,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(128),
	"occurred_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"firebase_uid" varchar(128) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_profile_id_profiles_profile_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_event_id_outbox_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_profile_id_profiles_profile_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_organization_time_idx" ON "audit_logs" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_object_idx" ON "audit_logs" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dead_letter_event_uq" ON "dead_letter_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "outbox_claim_idx" ON "outbox_events" USING btree ("status","available_at","occurred_at");--> statement-breakpoint
CREATE INDEX "outbox_lease_idx" ON "outbox_events" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_firebase_uid_uq" ON "profiles" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "sites_organization_idx" ON "sites" USING btree ("organization_id");