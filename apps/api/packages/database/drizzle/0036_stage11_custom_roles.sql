-- Organization-scoped custom roles layer over an immutable seeded system role.
CREATE TABLE custom_roles (
  custom_role_id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  role_key varchar(48) NOT NULL,
  display_name varchar(80) NOT NULL,
  base_role_id varchar(32) NOT NULL REFERENCES roles(role_id),
  active boolean NOT NULL DEFAULT true,
  created_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  updated_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_roles_key_check CHECK (role_key ~ '^[a-z][a-z0-9_]{1,46}$'),
  CONSTRAINT custom_roles_name_check CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT custom_roles_base_check CHECK (base_role_id IN ('patient','doctor','driver','pharmacy','emergency','admin')),
  CONSTRAINT custom_roles_version_check CHECK (version >= 0),
  CONSTRAINT custom_roles_org_key_uq UNIQUE(organization_id, role_key),
  CONSTRAINT custom_roles_id_org_base_uq UNIQUE(custom_role_id, organization_id, base_role_id)
);--> statement-breakpoint

CREATE TABLE custom_role_permissions (
  custom_role_id uuid NOT NULL REFERENCES custom_roles(custom_role_id),
  permission_id varchar(128) NOT NULL REFERENCES permissions(permission_id),
  created_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(custom_role_id, permission_id),
  CONSTRAINT custom_role_permissions_safe_check CHECK (
    permission_id !~ '(^|:)global$' AND permission_id !~ '\*'
  )
);--> statement-breakpoint

ALTER TABLE organization_memberships ADD COLUMN custom_role_id uuid;--> statement-breakpoint
ALTER TABLE organization_memberships ADD CONSTRAINT organization_memberships_custom_role_fk
  FOREIGN KEY(custom_role_id, organization_id, role_id)
  REFERENCES custom_roles(custom_role_id, organization_id, base_role_id);--> statement-breakpoint
CREATE INDEX organization_memberships_custom_role_idx ON organization_memberships(custom_role_id)
  WHERE custom_role_id IS NOT NULL;--> statement-breakpoint

INSERT INTO permissions(permission_id, description) VALUES
 ('custom_role:manage:org', 'Manage organization custom roles and their explicit permissions')
ON CONFLICT(permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions(role_id, permission_id) VALUES
 ('admin', 'custom_role:manage:org'), ('super_admin', 'custom_role:manage:org')
ON CONFLICT(role_id, permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO schema_compatibility(component, version) VALUES ('identity', 24)
ON CONFLICT(component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
