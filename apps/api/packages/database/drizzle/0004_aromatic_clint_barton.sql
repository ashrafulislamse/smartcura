CREATE TYPE "public"."app_session_status" AS ENUM('active', 'idle_expired', 'absolute_expired', 'revoked', 'membership_ended');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('pending', 'active', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."session_client_type" AS ENUM('patient_flutter', 'doctor_flutter', 'driver_flutter', 'web_portal');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('not_submitted', 'pending_review', 'changes_requested', 'approved', 'rejected', 'suspended', 'expired');--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"active_membership_id" uuid,
	"token_hash" varchar(64) NOT NULL,
	"csrf_hash" varchar(64) NOT NULL,
	"status" "app_session_status" DEFAULT 'active' NOT NULL,
	"client_type" "session_client_type" NOT NULL,
	"device_name" varchar(120) NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"step_up_valid_until" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_sessions_token_hash_check" CHECK ("app_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "app_sessions_csrf_hash_check" CHECK ("app_sessions"."csrf_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "app_sessions_expiry_order_check" CHECK ("app_sessions"."idle_expires_at" <= "app_sessions"."absolute_expires_at")
);
--> statement-breakpoint
CREATE TABLE "membership_sites" (
	"membership_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_sites_pk" PRIMARY KEY("membership_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role_id" varchar(32) NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"verification_status" "verification_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"permission_id" varchar(128) PRIMARY KEY NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" varchar(32) NOT NULL,
	"permission_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"role_id" varchar(32) PRIMARY KEY NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"actor_profile_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "status" SET DATA TYPE "public"."profile_status" USING "status"::"public"."profile_status";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."profile_status";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "display_name" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email" varchar(320);--> statement-breakpoint
UPDATE "profiles"
SET "display_name" = 'Profile',
    "email" = "firebase_uid" || '@identity.invalid'
WHERE "display_name" IS NULL OR "email" IS NULL;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "phone_e164" varchar(16);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "preferred_locale" varchar(35) DEFAULT 'en-MY' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "timezone" varchar(64) DEFAULT 'Asia/Kuala_Lumpur' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_profile_id_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_active_membership_id_organization_memberships_membership_id_fk" FOREIGN KEY ("active_membership_id") REFERENCES "public"."organization_memberships"("membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_sites" ADD CONSTRAINT "membership_sites_membership_id_organization_memberships_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."organization_memberships"("membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_sites" ADD CONSTRAINT "membership_sites_site_id_sites_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_profile_id_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_role_id_roles_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_permission_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("permission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_app_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_actor_profile_id_profiles_profile_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_sessions_token_hash_uq" ON "app_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "app_sessions_profile_status_idx" ON "app_sessions" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "app_sessions_active_membership_idx" ON "app_sessions" USING btree ("active_membership_id");--> statement-breakpoint
CREATE INDEX "app_sessions_expiry_idx" ON "app_sessions" USING btree ("status","idle_expires_at","absolute_expires_at");--> statement-breakpoint
CREATE INDEX "membership_sites_site_idx" ON "membership_sites" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_profile_org_role_uq" ON "organization_memberships" USING btree ("profile_id","organization_id","role_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_profile_status_idx" ON "organization_memberships" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "organization_memberships_org_role_status_idx" ON "organization_memberships" USING btree ("organization_id","role_id","status");--> statement-breakpoint
CREATE INDEX "session_events_session_time_idx" ON "session_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "profiles_status_idx" ON "profiles" USING btree ("status");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_phone_e164_check" CHECK ("profiles"."phone_e164" IS NULL OR "profiles"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$');


--> statement-breakpoint
INSERT INTO organizations (organization_id, name)
VALUES ('018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', 'SmartCura Demo')
ON CONFLICT (organization_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO sites (site_id, organization_id, name, kind)
VALUES (
  '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  'SmartCura Virtual Clinic',
  'virtual_clinic'
)
ON CONFLICT (site_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO roles (role_id, display_name, system)
VALUES
  ('patient', 'Patient', true),
  ('doctor', 'Doctor', true),
  ('driver', 'Driver', true),
  ('pharmacy', 'Pharmacy', true),
  ('emergency', 'Emergency', true),
  ('admin', 'Administrator', true),
  ('super_admin', 'Super Administrator', true)
ON CONFLICT (role_id) DO UPDATE
SET display_name = EXCLUDED.display_name, system = true;
--> statement-breakpoint
CREATE TEMP TABLE smartcura_role_permission_seed (
  role_id varchar(32) NOT NULL,
  permission_id varchar(128) NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO smartcura_role_permission_seed
SELECT 'patient', unnest(ARRAY[
  'profile:read:own', 'profile:update:own', 'patient.record:read',
  'appointment:read:own', 'appointment:create:own', 'appointment:cancel:own',
  'consultation:join:own', 'conversation:read:own',
  'conversation.message:create:own', 'prescription:read:own',
  'iot.device:manage:own', 'iot.reading:read:own', 'ai.artifact:read:own',
  'emergency.event:create:own', 'support.ticket:manage:own'
]);
--> statement-breakpoint
INSERT INTO smartcura_role_permission_seed
SELECT 'doctor', unnest(ARRAY[
  'profile:manage:own', 'patient.record:read', 'appointment:read:assigned',
  'appointment:update:assigned', 'availability:manage:own',
  'consultation:manage:assigned', 'clinical_note:manage:assigned',
  'prescription:create:assigned', 'prescription.sign:assigned',
  'conversation.message:create:assigned', 'iot.reading:read:assigned',
  'iot.alert:manage:assigned', 'ai.artifact:review:assigned',
  'break_glass:activate'
]);
--> statement-breakpoint
INSERT INTO smartcura_role_permission_seed
SELECT 'driver', unnest(ARRAY[
  'profile:manage:own', 'driver.document:manage:own',
  'dispatch.offer:read:assigned', 'dispatch.offer:respond:assigned',
  'delivery:update:assigned', 'delivery.proof:create:assigned',
  'location.waypoint:create:assigned', 'earning:read:own',
  'withdrawal:create:own'
]);
--> statement-breakpoint
INSERT INTO smartcura_role_permission_seed
SELECT 'pharmacy', unnest(ARRAY[
  'profile:manage:own', 'pharmacy.order:read:site',
  'pharmacy.order:update:site', 'prescription_validation:manage:site',
  'inventory:read:site', 'inventory.reservation:manage:site',
  'stock_ledger:post:site', 'procurement:manage:site', 'return:manage:site',
  'reconciliation:manage:site', 'dispatch_job:create:site'
]);
--> statement-breakpoint
INSERT INTO smartcura_role_permission_seed
SELECT 'emergency', unnest(ARRAY[
  'profile:manage:own', 'patient.record:read', 'emergency.event:read:site',
  'emergency.triage:manage:site', 'emergency.dispatch:manage:site',
  'emergency.communication:manage:site', 'emergency.fleet:read:site',
  'emergency.resolution:create:site', 'break_glass:activate'
]);
--> statement-breakpoint
INSERT INTO smartcura_role_permission_seed
SELECT 'admin', unnest(ARRAY[
  'profile:manage:own', 'membership:manage:organization',
  'doctor_verification:manage:organization', 'appointment:read:organization',
  'support.ticket:manage:organization', 'content:manage:organization',
  'finance:read:organization', 'audit:read:organization',
  'export:create:organization', 'system.setting:manage:organization'
]);
--> statement-breakpoint
INSERT INTO smartcura_role_permission_seed
SELECT 'super_admin', unnest(ARRAY[
  'system.security:*:global', 'system.setting:*:global',
  'organization:*:global', 'membership:*:global', 'role:*:global',
  'audit:read:global', 'export:create:global'
]);
--> statement-breakpoint
INSERT INTO permissions (permission_id)
SELECT DISTINCT permission_id FROM smartcura_role_permission_seed
ON CONFLICT (permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, permission_id FROM smartcura_role_permission_seed
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
DROP TABLE smartcura_role_permission_seed;
--> statement-breakpoint
INSERT INTO schema_compatibility (component, version)
VALUES ('identity', 1)
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version, updated_at = now();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_session_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'session_events are append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER session_events_reject_mutation
BEFORE UPDATE OR DELETE ON session_events
FOR EACH ROW EXECUTE FUNCTION smartcura_reject_session_event_mutation();
