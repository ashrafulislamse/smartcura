-- Stage 8/9 API surface completion.
--
-- Catalogue and vehicle updates need optimistic versions. Ratings are immutable
-- patient verdicts, and one prescription may not create multiple pharmacy orders.

ALTER TABLE "medications" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_version_check" CHECK ("version" >= 0);--> statement-breakpoint

ALTER TABLE "vehicles" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_version_check" CHECK ("version" >= 0);--> statement-breakpoint

-- A signed prescription is a single dispensing authority. Replays are handled by
-- idempotency, and a second non-replay order must not fill it twice.
CREATE UNIQUE INDEX "pharmacy_orders_prescription_uq"
  ON "pharmacy_orders" ("prescription_id") WHERE "prescription_id" IS NOT NULL;--> statement-breakpoint

-- A delivery rating is evidence, not editable profile content. A correction is an
-- administrative audit workflow, not an UPDATE that rewrites the patient's verdict.
CREATE OR REPLACE FUNCTION smartcura_reject_delivery_rating_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'delivery ratings are append-only' USING ERRCODE = '55000';
END; $$;--> statement-breakpoint
CREATE TRIGGER delivery_ratings_reject_mutation
  BEFORE UPDATE OR DELETE ON "delivery_ratings"
  FOR EACH ROW EXECUTE FUNCTION smartcura_reject_delivery_rating_mutation();--> statement-breakpoint

INSERT INTO permissions (permission_id, description) VALUES
 ('pharmacy.catalogue:manage:site', 'Manage the medication catalogue from an assigned pharmacy site'),
 ('pharmacy.order:create:own', 'Create an own pharmacy order from a signed prescription'),
 ('delivery.rating:create:own', 'Rate an own completed delivery'),
 ('delivery.rating:read:own', 'Read ratings received as the acting driver')
ON CONFLICT (permission_id) DO NOTHING;--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id) VALUES
 ('pharmacy', 'pharmacy.catalogue:manage:site'),
 ('patient', 'pharmacy.order:create:own'),
 ('patient', 'delivery.rating:create:own'),
 ('driver', 'delivery.rating:read:own')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Keep write authority disjoint: patients may create only their own order/rating,
-- and drivers may read only ratings attached to their own driver record.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'pharmacy.catalogue:manage:site' AND role_id <> 'pharmacy'
  ) THEN
    RAISE EXCEPTION 'medication catalogue write authority must remain pharmacy-only';
  END IF;
  IF EXISTS (
    SELECT 1 FROM role_permissions
    WHERE permission_id = 'delivery.rating:create:own' AND role_id <> 'patient'
  ) THEN
    RAISE EXCEPTION 'delivery rating creation must remain patient-only';
  END IF;
END $$;
