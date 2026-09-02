-- Stage 11 content administration and outbox-driven broadcasts.
CREATE TYPE content_publish_state AS ENUM ('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE broadcast_status AS ENUM ('draft', 'scheduled', 'dispatching', 'sent', 'cancelled');--> statement-breakpoint
CREATE TYPE broadcast_audience AS ENUM ('all', 'patients', 'staff');--> statement-breakpoint

CREATE TABLE faq_entries (
  faq_entry_id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  slug varchar(80) NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  publish_state content_publish_state NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  updated_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT faq_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT faq_question_check CHECK (length(btrim(question)) BETWEEN 1 AND 500),
  CONSTRAINT faq_answer_check CHECK (length(btrim(answer)) BETWEEN 1 AND 12000),
  CONSTRAINT faq_version_check CHECK (version >= 0),
  CONSTRAINT faq_published_at_check CHECK ((publish_state = 'published') = (published_at IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX faq_entries_org_slug_uq ON faq_entries(organization_id, slug);--> statement-breakpoint
CREATE INDEX faq_entries_public_idx ON faq_entries(organization_id, publish_state, updated_at);--> statement-breakpoint

CREATE TABLE notification_templates (
  notification_template_id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  template_key varchar(64) NOT NULL,
  category notification_category NOT NULL,
  active_version integer,
  created_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_templates_key_check CHECK (template_key ~ '^[a-z][a-z0-9_.]{1,62}$'),
  CONSTRAINT notification_templates_active_version_check CHECK (active_version IS NULL OR active_version > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX notification_templates_org_key_uq ON notification_templates(organization_id, template_key);--> statement-breakpoint
CREATE UNIQUE INDEX notification_templates_id_org_uq ON notification_templates(notification_template_id, organization_id);--> statement-breakpoint

CREATE TABLE notification_template_versions (
  notification_template_version_id uuid PRIMARY KEY DEFAULT uuidv7(),
  notification_template_id uuid NOT NULL REFERENCES notification_templates(notification_template_id),
  version integer NOT NULL,
  title_template text NOT NULL,
  body_template text NOT NULL,
  created_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_template_versions_version_check CHECK (version > 0),
  CONSTRAINT notification_template_versions_title_check CHECK (length(btrim(title_template)) BETWEEN 1 AND 200),
  CONSTRAINT notification_template_versions_body_check CHECK (length(btrim(body_template)) BETWEEN 1 AND 4000),
  CONSTRAINT notification_template_versions_template_version_uq UNIQUE(notification_template_id, version)
);--> statement-breakpoint

CREATE TABLE broadcast_messages (
  broadcast_message_id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  notification_template_version_id uuid NOT NULL REFERENCES notification_template_versions(notification_template_version_id),
  audience broadcast_audience NOT NULL,
  status broadcast_status NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  dispatched_at timestamptz,
  created_by_membership_id uuid NOT NULL REFERENCES organization_memberships(membership_id),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_messages_version_check CHECK (version >= 0),
  CONSTRAINT broadcast_messages_schedule_check CHECK (status = 'draft' OR scheduled_at IS NOT NULL),
  CONSTRAINT broadcast_messages_dispatch_check CHECK ((status = 'sent') = (dispatched_at IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX broadcast_messages_queue_idx ON broadcast_messages(organization_id, status, scheduled_at);--> statement-breakpoint

CREATE TABLE broadcast_recipients (
  broadcast_message_id uuid NOT NULL REFERENCES broadcast_messages(broadcast_message_id),
  profile_id uuid NOT NULL REFERENCES profiles(profile_id),
  notification_id uuid REFERENCES notifications(notification_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_message_id, profile_id)
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION stage11_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER notification_template_versions_append_only BEFORE UPDATE OR DELETE ON notification_template_versions
  FOR EACH ROW EXECUTE FUNCTION stage11_append_only();--> statement-breakpoint

INSERT INTO permissions(permission_id, description) VALUES
 ('content:manage:org', 'Manage organization FAQs, notification templates and broadcasts')
ON CONFLICT(permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions(role_id, permission_id) VALUES
 ('admin', 'content:manage:org'), ('super_admin', 'content:manage:org')
ON CONFLICT(role_id, permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO schema_compatibility(component, version) VALUES ('identity', 23)
ON CONFLICT(component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
