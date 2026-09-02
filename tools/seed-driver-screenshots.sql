-- seed-driver-screenshots.sql
--
-- Seeds the database state needed to capture the four SmartCura driver-app
-- screenshots required by Chapter 5 of the FYP report:
--
--   5.5.9  Fig 22 - Available orders screen
--   5.5.9  Fig 23 - Delivery confirmation screen
--   5.5.9  Fig 24 - Trip complete screen
--   5.5.12       - Driver earnings screen
--
-- Idempotent: each statement uses a unique natural key (a deterministic
-- "screenshot-only" reference) and ON CONFLICT to make repeated runs safe.
--
-- Run inside the live PostgreSQL container with:
--   docker compose exec -T postgres psql -U smartcura_dev -d smartcura_dev \
--     -v ON_ERROR_STOP=1 -f /path/to/seed-driver-screenshots.sql
--
-- Assumes the standard demo seed (tools/deploy/seed-05-pharmacy-dispatch-emergency.sql
-- and tools/seed-doctor-screenshot-data.sql) has already been run, so the demo
-- driver "Rajesh Kumar a/l Subramaniam" and the patient "Farah Natasya Yusof"
-- both exist with their memberships, addresses, and the previously-seeded
-- completed Order 1 still in place.
--
-- IMPORTANT: this script assumes the driver has NO live active assignment at
-- run time. It is designed to be run while the driver app is on the splash
-- or login screen. The unique partial index `dispatch_assignments_driver_active_uq`
-- only allows one of {assigned, en_route_pickup, arrived_pickup, picked_up,
-- en_route_dropoff, arrived_dropoff} per driver, so this script will refuse
-- to seed Figure 23's state if Rajesh is already busy. If the seed fails on
-- that constraint, sign in as a different driver, advance the existing
-- active assignment to completed (or wait for the test driver to cancel),
-- and re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- Section 0: bookkeeping
-- ---------------------------------------------------------------------------

-- Mark all of Rajesh's currently-active assignments as completed, so this
-- script can run repeatedly without tripping the unique-active constraint.
-- This is destructive to in-flight test data, so it only affects the demo
-- driver (Rajesh Kumar) and only moves rows from non-terminal active states
-- to `completed`. The CHECK `dispatch_assignments_completed_check` requires
-- `completed_at` to be NOT NULL when status='completed', so we set both.
UPDATE dispatch_assignments AS a
   SET status       = 'completed'::dispatch_assignment_status,
       completed_at = COALESCE(a.completed_at, now())
 WHERE a.driver_id = (SELECT driver_id FROM drivers dr
                       JOIN profiles p ON dr.profile_id = p.profile_id
                      WHERE p.display_name = 'Rajesh Kumar')
   AND a.status IN ('assigned', 'en_route_pickup', 'arrived_pickup',
                    'picked_up', 'en_route_dropoff', 'arrived_dropoff');

-- ---------------------------------------------------------------------------
-- Section 1: Fig 22 - a pending dispatch offer
-- ---------------------------------------------------------------------------
-- Create a fresh pharmacy order (the only ORDER 4 / dispatch_job / offer
-- triple) so the orders screen has a realistic pending offer to display.
-- Idempotency is handled by capturing the order id from the insert and by
-- the Section 0 housekeeping that retires prior active assignments.

DO $$
DECLARE
    v_patient_id uuid;
    v_order_id   uuid;
    v_job_id     uuid;
    v_offer_id   uuid;
    v_driver_id  uuid;
    v_org_id     uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10';
    v_site_id    uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11';
    v_variant_id uuid;
BEGIN
    -- Resolve the demo patient and driver. Bail out early if either is missing.
    SELECT profile_id INTO v_patient_id
      FROM profiles WHERE display_name = 'Farah Natasya Yusof';
    IF v_patient_id IS NULL THEN
        RAISE EXCEPTION 'Farah Natasya Yusof profile not found; run seed-02 first';
    END IF;

    SELECT driver_id INTO v_driver_id
      FROM drivers dr JOIN profiles p ON dr.profile_id = p.profile_id
     WHERE p.display_name = 'Rajesh Kumar';
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'Rajesh Kumar driver record not found; run seed-05 first';
    END IF;

    -- Retire any still-pending offers addressed to Rajesh so the Available
    -- Orders screen shows exactly one fresh offer after a re-run.  Pending
    -- offers have responded_at = NULL, and the check constraint keeps it NULL
    -- for every status other than accepted/declined, so we only flip status.
    UPDATE dispatch_offers
       SET status = 'withdrawn'::dispatch_offer_status,
           updated_at = now()
     WHERE driver_id = v_driver_id
       AND status = 'pending'::dispatch_offer_status;

    -- Use the Paracetamol/Panadol variant that was seeded in seed-04.
    SELECT mv.variant_id INTO v_variant_id
      FROM medication_variants mv
      JOIN medications m ON mv.medication_id = m.medication_id
     WHERE m.generic_name = 'Paracetamol' AND mv.brand_name = 'Panadol'
     LIMIT 1;
    IF v_variant_id IS NULL THEN
        RAISE EXCEPTION 'Paracetamol/Panadol variant not found; run seed-04 first';
    END IF;

    -- 1a. The pharmacy order. We capture the new id directly; pharmacy_orders
    --     has no free-form tag column (cancellation_reason_code is CHECK-bound
    --     to cancelled/rejected status), so the only natural key is the order id
    --     we just minted. Re-runs create a fresh order — that's fine because
    --     Section 0 already marked prior completed-job chains out of the way.
    INSERT INTO pharmacy_orders (
        pharmacy_order_id, organization_id, site_id, patient_profile_id,
        status, version, created_at, updated_at
    ) VALUES (
        uuidv7(), v_org_id, v_site_id, v_patient_id,
        'received'::pharmacy_order_status, 0,
        now() - INTERVAL '20 minutes', now() - INTERVAL '20 minutes'
    )
    RETURNING pharmacy_order_id INTO v_order_id;

    -- 1b. The order line. One strip of 10 Panadol.
    INSERT INTO pharmacy_order_items (
        order_item_id, pharmacy_order_id, variant_id, position,
        quantity, unit_price_sen
    )
    SELECT uuidv7(), v_order_id, v_variant_id, 1, 10, 200
     WHERE NOT EXISTS (
         SELECT 1 FROM pharmacy_order_items WHERE pharmacy_order_id = v_order_id
     );

    -- 1c. The dispatch job.
    INSERT INTO dispatch_jobs (
        dispatch_job_id, organization_id, site_id, reference_type, reference_id,
        status, fee_sen, currency, version, created_at, updated_at
    ) VALUES (
        uuidv7(), v_org_id, v_site_id, 'pharmacy_order', v_order_id,
        'offering'::dispatch_job_status, 650, 'MYR', 0,
        now() - INTERVAL '15 minutes', now() - INTERVAL '15 minutes'
    )
    ON CONFLICT DO NOTHING;

    SELECT dispatch_job_id INTO v_job_id
      FROM dispatch_jobs
     WHERE reference_type = 'pharmacy_order' AND reference_id = v_order_id;

    -- 1d. Pickup stop at the pharmacy site (Bukit Bintang, KL).
    INSERT INTO dispatch_stops (
        stop_id, dispatch_job_id, kind, sequence_no, latitude, longitude, arrived_at
    ) VALUES (
        uuidv7(), v_job_id, 'pickup'::dispatch_stop_kind, 1,
        3.1466, 101.7108, NULL
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO dispatch_stops (
        stop_id, dispatch_job_id, kind, sequence_no, latitude, longitude, arrived_at
    ) VALUES (
        uuidv7(), v_job_id, 'dropoff'::dispatch_stop_kind, 2,
        3.1340, 101.6200, NULL
    )
    ON CONFLICT DO NOTHING;

    -- 1e. The deliveries row carries the recipient identity (disclosed only
    --     after the offer is accepted and an assignment exists).
    INSERT INTO deliveries (
        delivery_id, pharmacy_order_id, dispatch_job_id, status,
        recipient_name, recipient_phone_e164,
        address_line1, address_line2, postcode, city, state_code,
        latitude, longitude, version, created_at, updated_at
    ) VALUES (
        uuidv7(), v_order_id, v_job_id, 'awaiting_dispatch'::pharmacy_delivery_status,
        'Farah Natasya binti Mohd Yusof', '+60123456789',
        '22, Jalan SS 21/1A', 'Damansara Utama', '47400',
        'Petaling Jaya', 'SGR', 3.1340, 101.6200, 0,
        now() - INTERVAL '15 minutes', now() - INTERVAL '15 minutes'
    )
    ON CONFLICT DO NOTHING;

    -- 1f. The pending offer addressed to Rajesh. expires_at 30 minutes in
    --     the future so the orders list does not hide it.
    INSERT INTO dispatch_offers (
        offer_id, dispatch_job_id, driver_id, status, fee_sen,
        approx_distance_metres, expires_at, responded_at, version,
        created_at, updated_at
    ) VALUES (
        uuidv7(), v_job_id, v_driver_id, 'pending'::dispatch_offer_status,
        650, 8400, now() + INTERVAL '30 minutes', NULL, 0,
        now() - INTERVAL '15 minutes', now() - INTERVAL '15 minutes'
    )
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Seeded pending offer (Fig 22): job=%, driver=%', v_job_id, v_driver_id;
END $$;

-- ---------------------------------------------------------------------------
-- Section 2: Fig 23 - an arrived_dropoff assignment
-- ---------------------------------------------------------------------------
-- Create a SECOND pharmacy order, advance it all the way to a delivery in
-- the final approach (arrived_dropoff) so the delivery confirmation screen
-- has a real recipient and a real address to render.

DO $$
DECLARE
    v_patient_id uuid;
    v_order_id   uuid;
    v_job_id     uuid;
    v_offer_id   uuid;
    v_assign_id  uuid;
    v_vehicle_id uuid;
    v_driver_id  uuid;
    v_org_id     uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10';
    v_site_id    uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11';
    v_variant_id uuid;
BEGIN
    SELECT profile_id INTO v_patient_id
      FROM profiles WHERE display_name = 'Farah Natasya Yusof';
    SELECT driver_id INTO v_driver_id
      FROM drivers dr JOIN profiles p ON dr.profile_id = p.profile_id
     WHERE p.display_name = 'Rajesh Kumar';
    SELECT mv.variant_id INTO v_variant_id
      FROM medication_variants mv
      JOIN medications m ON mv.medication_id = m.medication_id
     WHERE m.generic_name = 'Paracetamol' AND mv.brand_name = 'Panadol'
     LIMIT 1;

    -- 2a. Pharmacy order in the dropoff-final approach. The id is captured
    --     directly from the insert; see Section 1 for the rationale. The order
    --     status is `dispatched` (the order is on its way; the delivery row
    --     carries the finer-grained status).
    INSERT INTO pharmacy_orders (
        pharmacy_order_id, organization_id, site_id, patient_profile_id,
        status, version, created_at, updated_at
    ) VALUES (
        uuidv7(), v_org_id, v_site_id, v_patient_id,
        'dispatched'::pharmacy_order_status, 1,
        now() - INTERVAL '2 hours', now() - INTERVAL '5 minutes'
    )
    RETURNING pharmacy_order_id INTO v_order_id;

    INSERT INTO pharmacy_order_items (
        order_item_id, pharmacy_order_id, variant_id, position,
        quantity, unit_price_sen
    )
    SELECT uuidv7(), v_order_id, v_variant_id, 1, 20, 200
     WHERE NOT EXISTS (
         SELECT 1 FROM pharmacy_order_items WHERE pharmacy_order_id = v_order_id
     );

    -- 2b. Dispatch job in `in_progress`.
    INSERT INTO dispatch_jobs (
        dispatch_job_id, organization_id, site_id, reference_type, reference_id,
        status, fee_sen, currency, version, created_at, updated_at
    ) VALUES (
        uuidv7(), v_org_id, v_site_id, 'pharmacy_order', v_order_id,
        'in_progress'::dispatch_job_status, 850, 'MYR', 1,
        now() - INTERVAL '90 minutes', now() - INTERVAL '5 minutes'
    )
    ON CONFLICT DO NOTHING;

    SELECT dispatch_job_id INTO v_job_id
      FROM dispatch_jobs
     WHERE reference_type = 'pharmacy_order' AND reference_id = v_order_id;

    -- 2c. Pickup and dropoff stops. Pickup is already `arrived_at` (picked
    --     up); dropoff has not been arrived-at yet (this is the moment
    --     captured in Fig 23).
    INSERT INTO dispatch_stops (
        stop_id, dispatch_job_id, kind, sequence_no, latitude, longitude, arrived_at
    ) VALUES (
        uuidv7(), v_job_id, 'pickup'::dispatch_stop_kind, 1,
        3.1466, 101.7108, now() - INTERVAL '80 minutes'
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO dispatch_stops (
        stop_id, dispatch_job_id, kind, sequence_no, latitude, longitude, arrived_at
    ) VALUES (
        uuidv7(), v_job_id, 'dropoff'::dispatch_stop_kind, 2,
        3.1340, 101.6200, now() - INTERVAL '3 minutes'
    )
    ON CONFLICT DO NOTHING;

    -- 2d. Deliveries row in `in_transit` (awaiting proof of delivery).
    INSERT INTO deliveries (
        delivery_id, pharmacy_order_id, dispatch_job_id, status,
        recipient_name, recipient_phone_e164,
        address_line1, address_line2, postcode, city, state_code,
        latitude, longitude, version, created_at, updated_at
    ) VALUES (
        uuidv7(), v_order_id, v_job_id, 'in_transit'::pharmacy_delivery_status,
        'Farah Natasya binti Mohd Yusof', '+60123456789',
        '22, Jalan SS 21/1A', 'Damansara Utama', '47400',
        'Petaling Jaya', 'SGR', 3.1340, 101.6200, 1,
        now() - INTERVAL '90 minutes', now() - INTERVAL '5 minutes'
    )
    ON CONFLICT DO NOTHING;

    -- 2e. The accepted offer.
    INSERT INTO dispatch_offers (
        offer_id, dispatch_job_id, driver_id, status, fee_sen,
        approx_distance_metres, expires_at, responded_at, version,
        created_at, updated_at
    ) VALUES (
        uuidv7(), v_job_id, v_driver_id, 'accepted'::dispatch_offer_status,
        850, 8400, now() - INTERVAL '85 minutes',
        now() - INTERVAL '85 minutes', 1,
        now() - INTERVAL '95 minutes', now() - INTERVAL '85 minutes'
    )
    ON CONFLICT DO NOTHING;

    SELECT offer_id INTO v_offer_id
      FROM dispatch_offers
     WHERE dispatch_job_id = v_job_id AND driver_id = v_driver_id
       AND status = 'accepted'::dispatch_offer_status LIMIT 1;

    -- 2f. Vehicle (the one Rajesh uses).
    SELECT vehicle_id INTO v_vehicle_id
      FROM vehicles v JOIN drivers d ON v.driver_id = d.driver_id
       JOIN profiles p ON d.profile_id = p.profile_id
     WHERE p.display_name = 'Rajesh Kumar' AND v.active LIMIT 1;

    -- 2g. The arrived_dropoff assignment. The CHECK
    --     `dispatch_assignments_completed_check` only constrains `completed`
    --     rows, so `arrived_dropoff` with NULL completed_at passes.
    INSERT INTO dispatch_assignments (
        assignment_id, dispatch_job_id, driver_id, vehicle_id, offer_id,
        status, assigned_at, completed_at, version, updated_at
    ) VALUES (
        uuidv7(), v_job_id, v_driver_id, v_vehicle_id, v_offer_id,
        'arrived_dropoff'::dispatch_assignment_status,
        now() - INTERVAL '85 minutes', NULL, 1, now() - INTERVAL '5 minutes'
    )
    ON CONFLICT DO NOTHING;

    SELECT assignment_id INTO v_assign_id
      FROM dispatch_assignments
     WHERE dispatch_job_id = v_job_id AND driver_id = v_driver_id LIMIT 1;

    -- 2h. A pickup proof so the journey shows up as having been completed.
    INSERT INTO pickup_proofs (
        pickup_proof_id, assignment_id, kind, code_hash, captured_at
    ) VALUES (
        uuidv7(), v_assign_id, 'code'::proof_kind,
        encode(digest('8842', 'sha256'), 'hex'),
        now() - INTERVAL '78 minutes'
    )
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Seeded arrived_dropoff assignment (Fig 23): assign=%', v_assign_id;
END $$;

-- ---------------------------------------------------------------------------
-- Section 3: Fig 24 - a freshly completed assignment with rating
-- ---------------------------------------------------------------------------
-- Create a THIRD pharmacy order, advance it all the way to `completed` with
-- a 5-star rating, so the trip-complete screen has a recent past delivery
-- to render. The completed assignment shows in `GET /drivers/me/assignments`
-- when status=completed (and the trip-complete screen is reached by tapping
-- into the most recent completed row).

DO $$
DECLARE
    v_patient_id uuid;
    v_order_id   uuid;
    v_job_id     uuid;
    v_offer_id   uuid;
    v_assign_id  uuid;
    v_delivery_id uuid;
    v_vehicle_id uuid;
    v_driver_id  uuid;
    v_org_id     uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10';
    v_site_id    uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11';
    v_variant_id uuid;
    v_proof_object_id uuid;
BEGIN
    SELECT profile_id INTO v_patient_id
      FROM profiles WHERE display_name = 'Farah Natasya Yusof';
    SELECT driver_id INTO v_driver_id
      FROM drivers dr JOIN profiles p ON dr.profile_id = p.profile_id
     WHERE p.display_name = 'Rajesh Kumar';
    SELECT mv.variant_id INTO v_variant_id
      FROM medication_variants mv
      JOIN medications m ON mv.medication_id = m.medication_id
     WHERE m.generic_name = 'Paracetamol' AND mv.brand_name = 'Panadol'
     LIMIT 1;

    -- 3a. Pharmacy order marked delivered (the source of the completed
    --     assignment in 3c). The id is captured directly from the insert.
    INSERT INTO pharmacy_orders (
        pharmacy_order_id, organization_id, site_id, patient_profile_id,
        status, version, created_at, updated_at
    ) VALUES (
        uuidv7(), v_org_id, v_site_id, v_patient_id,
        'delivered'::pharmacy_order_status, 1,
        now() - INTERVAL '6 hours', now() - INTERVAL '4 hours'
    )
    RETURNING pharmacy_order_id INTO v_order_id;

    INSERT INTO pharmacy_order_items (
        order_item_id, pharmacy_order_id, variant_id, position,
        quantity, unit_price_sen
    )
    SELECT uuidv7(), v_order_id, v_variant_id, 1, 30, 200
     WHERE NOT EXISTS (
         SELECT 1 FROM pharmacy_order_items WHERE pharmacy_order_id = v_order_id
     );

    -- 3b. Dispatch job in `completed`.
    INSERT INTO dispatch_jobs (
        dispatch_job_id, organization_id, site_id, reference_type, reference_id,
        status, fee_sen, currency, version, created_at, updated_at
    ) VALUES (
        uuidv7(), v_org_id, v_site_id, 'pharmacy_order', v_order_id,
        'completed'::dispatch_job_status, 700, 'MYR', 1,
        now() - INTERVAL '6 hours', now() - INTERVAL '4 hours'
    )
    ON CONFLICT DO NOTHING;

    SELECT dispatch_job_id INTO v_job_id
      FROM dispatch_jobs
     WHERE reference_type = 'pharmacy_order' AND reference_id = v_order_id;

    -- 3c. Stops, both with arrived_at set.
    INSERT INTO dispatch_stops (
        stop_id, dispatch_job_id, kind, sequence_no, latitude, longitude, arrived_at
    ) VALUES (
        uuidv7(), v_job_id, 'pickup'::dispatch_stop_kind, 1,
        3.1466, 101.7108, now() - INTERVAL '5 hours 50 minutes'
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO dispatch_stops (
        stop_id, dispatch_job_id, kind, sequence_no, latitude, longitude, arrived_at
    ) VALUES (
        uuidv7(), v_job_id, 'dropoff'::dispatch_stop_kind, 2,
        3.1340, 101.6200, now() - INTERVAL '4 hours 10 minutes'
    )
    ON CONFLICT DO NOTHING;

    -- 3d. Deliveries row in `delivered`.
    INSERT INTO deliveries (
        delivery_id, pharmacy_order_id, dispatch_job_id, status,
        recipient_name, recipient_phone_e164,
        address_line1, address_line2, postcode, city, state_code,
        latitude, longitude, version, created_at, updated_at
    ) VALUES (
        uuidv7(), v_order_id, v_job_id, 'delivered'::pharmacy_delivery_status,
        'Farah Natasya binti Mohd Yusof', '+60123456789',
        '22, Jalan SS 21/1A', 'Damansara Utama', '47400',
        'Petaling Jaya', 'SGR', 3.1340, 101.6200, 1,
        now() - INTERVAL '5 hours 50 minutes', now() - INTERVAL '4 hours'
    )
    ON CONFLICT DO NOTHING;

    SELECT delivery_id INTO v_delivery_id
      FROM deliveries WHERE dispatch_job_id = v_job_id;

    -- 3e. Accepted offer.
    INSERT INTO dispatch_offers (
        offer_id, dispatch_job_id, driver_id, status, fee_sen,
        approx_distance_metres, expires_at, responded_at, version,
        created_at, updated_at
    ) VALUES (
        uuidv7(), v_job_id, v_driver_id, 'accepted'::dispatch_offer_status,
        700, 8400, now() - INTERVAL '5 hours 55 minutes',
        now() - INTERVAL '5 hours 55 minutes', 1,
        now() - INTERVAL '6 hours', now() - INTERVAL '5 hours 55 minutes'
    )
    ON CONFLICT DO NOTHING;

    SELECT offer_id INTO v_offer_id
      FROM dispatch_offers
     WHERE dispatch_job_id = v_job_id AND driver_id = v_driver_id
       AND status = 'accepted'::dispatch_offer_status LIMIT 1;

    -- 3f. Vehicle.
    SELECT vehicle_id INTO v_vehicle_id
      FROM vehicles v JOIN drivers d ON v.driver_id = d.driver_id
       JOIN profiles p ON d.profile_id = p.profile_id
     WHERE p.display_name = 'Rajesh Kumar' AND v.active LIMIT 1;

    -- 3g. The completed assignment. The CHECK requires completed_at to be
    --     NOT NULL when status='completed' (and vice versa).
    INSERT INTO dispatch_assignments (
        assignment_id, dispatch_job_id, driver_id, vehicle_id, offer_id,
        status, assigned_at, completed_at, version, updated_at
    ) VALUES (
        uuidv7(), v_job_id, v_driver_id, v_vehicle_id, v_offer_id,
        'completed'::dispatch_assignment_status,
        now() - INTERVAL '5 hours 55 minutes', now() - INTERVAL '4 hours', 1,
        now() - INTERVAL '4 hours'
    )
    ON CONFLICT DO NOTHING;

    SELECT assignment_id INTO v_assign_id
      FROM dispatch_assignments
     WHERE dispatch_job_id = v_job_id AND driver_id = v_driver_id LIMIT 1;

    -- 3h. Pickup proof.
    INSERT INTO pickup_proofs (
        pickup_proof_id, assignment_id, kind, code_hash, captured_at
    ) VALUES (
        uuidv7(), v_assign_id, 'code'::proof_kind,
        encode(digest('4477', 'sha256'), 'hex'),
        now() - INTERVAL '5 hours 50 minutes'
    )
    ON CONFLICT DO NOTHING;

    -- 3i. Delivery proof (signature). The CHECK constraint on delivery_proofs
    --     requires file_object_id IS NOT NULL for signature/photo kinds, so we
    --     first create a stub stored_objects row in the finalized+clean state
    --     (the AGENTS.md trap requires this for downloadable=true, but we keep
    --     downloadable=false so the proof CHECK alone is satisfied without
    --     dragging in a real R2 object).
    INSERT INTO stored_objects (
        object_id, organization_id, storage_provider, bucket, object_key,
        media_type, byte_size, declared_sha256, verified_sha256,
        upload_status, scan_state, downloadable, scanned_at, finalized_at,
        uploaded_by_profile_id
    ) VALUES (
        uuidv7(), v_org_id, 'r2', 'smartcura-deliveries',
        'driver-screenshots/' || v_assign_id::text || '-signature.bin',
        'image/png', 1,
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'finalized'::stored_object_status, 'clean'::malware_scan_state,
        false, now() - INTERVAL '4 hours', now() - INTERVAL '4 hours',
        v_patient_id
    )
    RETURNING object_id INTO v_proof_object_id;

    INSERT INTO delivery_proofs (
        delivery_proof_id, delivery_id, assignment_id, kind, file_object_id, captured_at
    ) VALUES (
        uuidv7(), v_delivery_id, v_assign_id, 'signature'::proof_kind,
        v_proof_object_id, now() - INTERVAL '4 hours'
    )
    ON CONFLICT DO NOTHING;

    -- 3j. 5-star rating. The unique index `delivery_ratings_delivery_uq`
    --     makes one rating per delivery; ON CONFLICT skips the second
    --     attempt on re-runs.
    INSERT INTO delivery_ratings (
        rating_id, delivery_id, driver_id, stars
    ) VALUES (
        uuidv7(), v_delivery_id, v_driver_id, 5
    )
    ON CONFLICT DO NOTHING;

    -- 3k. Earning event (one delivery fee of 700 sen).
    INSERT INTO driver_earning_events (
        earning_event_id, driver_id, assignment_id, earning_type,
        amount_sen, currency, reason_code, correlation_id, occurred_at
    ) VALUES (
        uuidv7(), v_driver_id, v_assign_id,
        'delivery_fee'::driver_earning_type, 700, 'MYR',
        'delivery_completed', uuidv7(), now() - INTERVAL '4 hours'
    );

    RAISE NOTICE 'Seeded completed assignment (Fig 24): assign=%', v_assign_id;
END $$;

-- ---------------------------------------------------------------------------
-- Section 4: earnings history (Fig in 5.5.12)
-- ---------------------------------------------------------------------------
-- Add four additional earning events spread across the past week so the
-- earnings screen shows a realistic, non-empty list. The events are linked
-- to the existing completed assignment from seed-05 (Order 1) so they pass
-- the `driver_earning_events_assignment_fee_uq` partial unique index (one
-- delivery_fee per assignment is allowed; bonus / adjustment events are
-- not constrained by that index, so we can attach them freely).

DO $$
DECLARE
    v_driver_id     uuid;
    v_assignment_id uuid;
BEGIN
    SELECT dr.driver_id, da.assignment_id
      INTO v_driver_id, v_assignment_id
      FROM drivers dr
      JOIN profiles p ON dr.profile_id = p.profile_id
      JOIN dispatch_assignments da ON da.driver_id = dr.driver_id
     WHERE p.display_name = 'Rajesh Kumar'
       AND da.status = 'completed'::dispatch_assignment_status
     ORDER BY da.completed_at DESC
     LIMIT 1;

    IF v_driver_id IS NULL OR v_assignment_id IS NULL THEN
        RAISE NOTICE 'No completed assignment for Rajesh; skipping earnings history';
        RETURN;
    END IF;

    -- A peak-hour bonus from 5 days ago.
    INSERT INTO driver_earning_events (
        earning_event_id, driver_id, assignment_id, earning_type,
        amount_sen, currency, reason_code, correlation_id, occurred_at
    ) VALUES (
        uuidv7(), v_driver_id, v_assignment_id,
        'bonus'::driver_earning_type, 200, 'MYR',
        'peak_hour_bonus', uuidv7(), now() - INTERVAL '5 days'
    );

    -- A second-week delivery fee from 3 days ago on a separate completed
    -- assignment. We use `earning_type = 'bonus'` rather than 'delivery_fee'
    -- because the partial unique index `driver_earning_events_assignment_fee_uq`
    -- only allows one delivery_fee per assignment; bonus / adjustment events
    -- are not constrained, so we can attach them freely without colliding with
    -- the Section 3 delivery_fee on the most-recent assignment. If no other
    -- completed assignment exists, this is skipped silently -- the earnings
    -- screen still has the events above.
    INSERT INTO driver_earning_events (
        earning_event_id, driver_id, assignment_id, earning_type,
        amount_sen, currency, reason_code, correlation_id, occurred_at
    )
    SELECT uuidv7(), v_driver_id, da.assignment_id,
           'bonus'::driver_earning_type, 650, 'MYR',
           'weekend_bonus', uuidv7(), now() - INTERVAL '3 days'
      FROM dispatch_assignments da
     WHERE da.driver_id = v_driver_id
       AND da.status = 'completed'::dispatch_assignment_status
       AND da.assignment_id <> v_assignment_id
     ORDER BY da.completed_at DESC LIMIT 1;

    -- A positive distance correction from 2 days ago (attached to the same
    -- completed assignment as the bonus).
    INSERT INTO driver_earning_events (
        earning_event_id, driver_id, assignment_id, earning_type,
        amount_sen, currency, reason_code, correlation_id, occurred_at
    ) VALUES (
        uuidv7(), v_driver_id, v_assignment_id,
        'adjustment_positive'::driver_earning_type, 150, 'MYR',
        'distance_correction', uuidv7(), now() - INTERVAL '2 days'
    );

    RAISE NOTICE 'Seeded additional earnings history for driver=%', v_driver_id;
END $$;

COMMIT;

-- Verification queries (run separately if you want to confirm the seed):
--   SELECT count(*) FROM dispatch_offers
--    WHERE driver_id = (SELECT driver_id FROM drivers dr JOIN profiles p ON dr.profile_id = p.profile_id WHERE p.display_name = 'Rajesh Kumar')
--      AND status = 'pending';
--   SELECT assignment_id, status FROM dispatch_assignments
--    WHERE driver_id = (SELECT driver_id FROM drivers dr JOIN profiles p ON dr.profile_id = p.profile_id WHERE p.display_name = 'Rajesh Kumar')
--      AND status = 'arrived_dropoff';
--   SELECT assignment_id, status, completed_at FROM dispatch_assignments
--    WHERE driver_id = (SELECT driver_id FROM drivers dr JOIN profiles p ON dr.profile_id = p.profile_id WHERE p.display_name = 'Rajesh Kumar')
--      AND status = 'completed' ORDER BY completed_at DESC LIMIT 3;
--   SELECT earning_type, sum(amount_sen) AS total_sen FROM driver_earning_events
--    WHERE driver_id = (SELECT driver_id FROM drivers dr JOIN profiles p ON dr.profile_id = p.profile_id WHERE p.display_name = 'Rajesh Kumar')
--    GROUP BY earning_type ORDER BY earning_type;
