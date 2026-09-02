-- 0043: doctor-authored clinical templates (SOAP structure, fields, defaults).
--
-- WHY. Doctors re-enter the same SOAP scaffolding, observation prompts and default
-- orders for every encounter. A template they own and curate lets the consultation
-- composer pre-fill that structure instead of retyping it. The table is deliberately
-- author-scoped: a template belongs to the doctor who wrote it, within their
-- organization, and no other actor can mutate it. The body is JSONB so the shape can
-- evolve (SOAP sections, field types, default values) without a migration per field,
-- but the size is bounded so a template cannot become a document store.
--
-- `status` is a TEXT CHECK, not an enum, because the only two states are `active` and
-- `archived` and deleting a template is an archive, never a row removal: a consultation
-- that referenced a template must keep resolving it. `version` is optimistic-concurrency
-- currency for updates, matching the pattern `prescriptions` and `clinical_notes` use.

CREATE TABLE clinical_templates (
  template_id uuid PRIMARY KEY DEFAULT uuidv7(),
  author_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  name text NOT NULL,
  description text,
  specialty text,
  content jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_templates_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT clinical_templates_description_check CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
  CONSTRAINT clinical_templates_specialty_check CHECK (specialty IS NULL OR length(btrim(specialty)) BETWEEN 1 AND 120),
  CONSTRAINT clinical_templates_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT clinical_templates_version_check CHECK (version >= 1),
  CONSTRAINT clinical_templates_content_size_check CHECK (octet_length(content::text) <= 65536)
);--> statement-breakpoint

-- A doctor's active templates are the hot read path; index it so listing never scans
-- archived rows and name search stays within one author's set. The author+id unique
-- index makes the read-one ownership check a single index probe, matching the
-- `notification_templates_id_org_uq` pattern that lets a repository prove a row belongs
-- to an actor in one seek rather than a join-and-filter.
CREATE INDEX clinical_templates_author_status_idx
  ON clinical_templates(author_membership_id, status, updated_at);--> statement-breakpoint
CREATE UNIQUE INDEX clinical_templates_id_author_uq
  ON clinical_templates(template_id, author_membership_id);--> statement-breakpoint
-- Organization-scoped listing is secondary but supported, for a future shared-template
-- directory; the author index serves the primary (own-templates) read path.
CREATE INDEX clinical_templates_organization_idx
  ON clinical_templates(organization_id, status, updated_at);--> statement-breakpoint

INSERT INTO schema_compatibility(component, version) VALUES ('identity', 29)
  ON CONFLICT(component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();--> statement-breakpoint

-- The content-size CHECK (octet_length(content::text) <= 65536) is defined in the
-- CREATE TABLE above. A runtime probe block (DO $$ INSERT oversize... EXCEPTION...)
-- was removed because it executed against production data and could fail for edge-case
-- reasons in deployed environments, causing the entire migration to roll back and the
-- readiness check to return 503. The CHECK constraint itself is sufficient protection.
