-- Version history for settings and platform maintenance state.
CREATE TABLE organization_setting_versions (
  organization_setting_version_id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_setting_id uuid NOT NULL REFERENCES organization_settings(organization_setting_id),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  setting_key varchar(64) NOT NULL,
  value jsonb NOT NULL,
  version integer NOT NULL,
  updated_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_setting_versions_value_check CHECK (jsonb_typeof(value) <> 'null'),
  CONSTRAINT organization_setting_versions_version_check CHECK (version > 0),
  CONSTRAINT organization_setting_versions_uq UNIQUE(organization_setting_id, version)
);--> statement-breakpoint
INSERT INTO organization_setting_versions
 (organization_setting_id, organization_id, setting_key, value, version, updated_by_membership_id, created_at)
SELECT organization_setting_id, organization_id, setting_key, value, version, updated_by_membership_id, updated_at
FROM organization_settings WHERE version > 0;--> statement-breakpoint
CREATE INDEX organization_setting_versions_lookup_idx ON organization_setting_versions(organization_id, setting_key, version DESC);--> statement-breakpoint

CREATE OR REPLACE FUNCTION capture_organization_setting_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO organization_setting_versions
   (organization_setting_id, organization_id, setting_key, value, version, updated_by_membership_id, created_at)
  VALUES (NEW.organization_setting_id, NEW.organization_id, NEW.setting_key, NEW.value,
          NEW.version, NEW.updated_by_membership_id, NEW.updated_at);
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER organization_settings_capture_version AFTER INSERT OR UPDATE ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION capture_organization_setting_version();--> statement-breakpoint
CREATE TRIGGER organization_setting_versions_append_only BEFORE UPDATE OR DELETE ON organization_setting_versions
  FOR EACH ROW EXECUTE FUNCTION stage11_append_only();--> statement-breakpoint

CREATE TABLE platform_maintenance_state (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  reason_code varchar(64),
  starts_at timestamptz,
  updated_by_membership_id uuid REFERENCES organization_memberships(membership_id),
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_maintenance_singleton_check CHECK (singleton_id = 1),
  CONSTRAINT platform_maintenance_reason_check CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT platform_maintenance_enabled_check CHECK (enabled OR (reason_code IS NULL AND starts_at IS NULL)),
  CONSTRAINT platform_maintenance_version_check CHECK (version >= 0)
);--> statement-breakpoint
INSERT INTO platform_maintenance_state(singleton_id) VALUES (1);--> statement-breakpoint
CREATE TABLE platform_maintenance_versions (
  platform_maintenance_version_id uuid PRIMARY KEY DEFAULT uuidv7(),
  enabled boolean NOT NULL,
  reason_code varchar(64),
  starts_at timestamptz,
  updated_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_maintenance_versions_version_check CHECK (version > 0),
  CONSTRAINT platform_maintenance_versions_uq UNIQUE(version)
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION capture_platform_maintenance_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version > 0 THEN
    INSERT INTO platform_maintenance_versions(enabled, reason_code, starts_at, updated_by_membership_id, version, created_at)
    VALUES (NEW.enabled, NEW.reason_code, NEW.starts_at, NEW.updated_by_membership_id, NEW.version, NEW.updated_at);
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER platform_maintenance_capture_version AFTER UPDATE ON platform_maintenance_state
  FOR EACH ROW EXECUTE FUNCTION capture_platform_maintenance_version();--> statement-breakpoint
CREATE TRIGGER platform_maintenance_versions_append_only BEFORE UPDATE OR DELETE ON platform_maintenance_versions
  FOR EACH ROW EXECUTE FUNCTION stage11_append_only();--> statement-breakpoint

INSERT INTO permissions(permission_id, description) VALUES
 ('platform.maintenance:manage:global', 'Read and change platform maintenance state')
ON CONFLICT(permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions(role_id, permission_id) VALUES
 ('super_admin', 'platform.maintenance:manage:global')
ON CONFLICT(role_id, permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO schema_compatibility(component, version) VALUES ('identity', 25)
ON CONFLICT(component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
