-- Support SLA timestamps are facts; breach flags are projected against now().
ALTER TABLE support_tickets ADD COLUMN first_response_due_at timestamptz;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN resolution_due_at timestamptz;--> statement-breakpoint
ALTER TABLE support_tickets ADD COLUMN first_responded_at timestamptz;--> statement-breakpoint
UPDATE support_tickets SET
 first_response_due_at = created_at + CASE priority
   WHEN 'urgent' THEN interval '15 minutes' WHEN 'high' THEN interval '1 hour'
   WHEN 'medium' THEN interval '4 hours' ELSE interval '1 day' END,
 resolution_due_at = created_at + CASE priority
   WHEN 'urgent' THEN interval '4 hours' WHEN 'high' THEN interval '12 hours'
   WHEN 'medium' THEN interval '2 days' ELSE interval '5 days' END;--> statement-breakpoint
ALTER TABLE support_tickets ALTER COLUMN first_response_due_at SET NOT NULL;--> statement-breakpoint
ALTER TABLE support_tickets ALTER COLUMN resolution_due_at SET NOT NULL;--> statement-breakpoint
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_sla_order_check CHECK (
 first_response_due_at > created_at AND resolution_due_at >= first_response_due_at
 AND (first_responded_at IS NULL OR first_responded_at >= created_at)
);--> statement-breakpoint
CREATE INDEX support_tickets_sla_queue_idx ON support_tickets(organization_id, status, first_response_due_at, resolution_due_at)
 WHERE status NOT IN ('resolved','closed');--> statement-breakpoint
INSERT INTO schema_compatibility(component, version) VALUES ('identity', 26)
ON CONFLICT(component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
