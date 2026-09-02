ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_expiry_check" CHECK ("idempotency_keys"."expires_at" > "idempotency_keys"."created_at");--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_response_status_check" CHECK ("idempotency_keys"."response_status" IS NULL OR ("idempotency_keys"."response_status" >= 100 AND "idempotency_keys"."response_status" <= 599));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_event_version_check" CHECK ("outbox_events"."event_version" > 0);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_aggregate_version_check" CHECK ("outbox_events"."aggregate_version" >= 0);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_attempts_check" CHECK ("outbox_events"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_lease_check" CHECK (("outbox_events"."status" = 'processing' AND "outbox_events"."lease_owner" IS NOT NULL AND "outbox_events"."lease_expires_at" IS NOT NULL) OR ("outbox_events"."status" <> 'processing' AND "outbox_events"."lease_owner" IS NULL AND "outbox_events"."lease_expires_at" IS NULL));

--> statement-breakpoint
CREATE OR REPLACE FUNCTION smartcura_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_reject_mutation
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION smartcura_reject_audit_mutation();
