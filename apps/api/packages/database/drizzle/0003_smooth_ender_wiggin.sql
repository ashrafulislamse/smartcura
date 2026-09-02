CREATE TABLE "schema_compatibility" (
	"component" varchar(128) PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schema_compatibility_version_check" CHECK ("schema_compatibility"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" varchar(128) PRIMARY KEY NOT NULL,
	"build_version" varchar(128) NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "worker_heartbeats_last_seen_idx" ON "worker_heartbeats" USING btree ("last_seen_at");

--> statement-breakpoint
INSERT INTO schema_compatibility (component, version)
VALUES ('foundation', 1)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();
