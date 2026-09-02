-- seed-doctor-screenshot-data.sql
-- Seeds availability rules, slots, and confirmed appointments for Dr. Nurul Aisyah
-- so the doctor mobile app dashboard and schedule screens show real data.
-- Idempotent: can be run multiple times safely.
-- Run inside the PostgreSQL container with: psql -U smartcura -d smartcura -f /tmp/seed-doctor-screenshot-data.sql

DO $$
DECLARE
    v_org_id uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10';
    v_site_id uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11';
    v_doctor_profile_id uuid := '019ff368-e298-7806-81d2-7f3b249a58de';
    v_patient_profile_id uuid := '019ff368-e3e5-75aa-be11-7859b5fdf1d3';
    v_doctor_membership_id uuid;
    v_slot_id_1 uuid;
    v_slot_id_2 uuid;
    v_appt_id_1 uuid;
    v_appt_id_2 uuid;
    v_start_1 timestamptz;
    v_end_1 timestamptz;
    v_start_2 timestamptz;
    v_end_2 timestamptz;
    v_correlation_id uuid := uuidv7();
    v_existing_appts integer;
BEGIN
    -- Look up Dr. Nurul's membership
    SELECT membership_id INTO v_doctor_membership_id
    FROM organization_memberships
    WHERE profile_id = v_doctor_profile_id
      AND organization_id = v_org_id;

    IF v_doctor_membership_id IS NULL THEN
        RAISE EXCEPTION 'Doctor membership not found for profile %', v_doctor_profile_id;
    END IF;

    -- Ensure membership is active and verified
    UPDATE organization_memberships
    SET status = 'active',
        verification_status = 'approved',
        updated_at = now()
    WHERE membership_id = v_doctor_membership_id
      AND organization_id = v_org_id;

    -- Ensure doctor is linked to the site (required for site-scoped permissions)
    INSERT INTO membership_sites (membership_id, site_id, organization_id)
    VALUES (v_doctor_membership_id, v_site_id, v_org_id)
    ON CONFLICT (membership_id, site_id) DO NOTHING;

    -- Insert recurring availability rules: Mon-Fri, 09:00-17:00, 30-minute slots
    INSERT INTO availability_rules (rule_id, membership_id, organization_id, weekday, start_time, end_time, slot_duration_minutes, timezone, effective_from, effective_to, is_active, version)
    VALUES
        (uuidv7(), v_doctor_membership_id, v_org_id, 1, '09:00:00', '17:00:00', 30, 'Asia/Kuala_Lumpur', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', true, 0),
        (uuidv7(), v_doctor_membership_id, v_org_id, 2, '09:00:00', '17:00:00', 30, 'Asia/Kuala_Lumpur', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', true, 0),
        (uuidv7(), v_doctor_membership_id, v_org_id, 3, '09:00:00', '17:00:00', 30, 'Asia/Kuala_Lumpur', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', true, 0),
        (uuidv7(), v_doctor_membership_id, v_org_id, 4, '09:00:00', '17:00:00', 30, 'Asia/Kuala_Lumpur', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', true, 0),
        (uuidv7(), v_doctor_membership_id, v_org_id, 5, '09:00:00', '17:00:00', 30, 'Asia/Kuala_Lumpur', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', true, 0)
    ON CONFLICT (membership_id, weekday, start_time, effective_from) WHERE is_active = true DO NOTHING;

    -- Generate open slots for the next 7 days, weekdays only (9:00-17:00, 30 min each)
    INSERT INTO appointment_slots (slot_id, membership_id, organization_id, starts_at, ends_at, state, version)
    SELECT
        uuidv7(),
        v_doctor_membership_id,
        v_org_id,
        ((d::date + '09:00:00'::time) AT TIME ZONE 'Asia/Kuala_Lumpur') + (i * INTERVAL '30 minutes'),
        ((d::date + '09:00:00'::time) AT TIME ZONE 'Asia/Kuala_Lumpur') + ((i + 1) * INTERVAL '30 minutes'),
        'open',
        0
    FROM generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', INTERVAL '1 day') d
    CROSS JOIN generate_series(0, 15) i
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
    ON CONFLICT (membership_id, starts_at) WHERE state <> 'closed' DO NOTHING;

    -- Count confirmed upcoming appointments (appointments table has no starts_at;
    -- the instants live on appointment_slots, so we join to get the real time)
    SELECT COUNT(*) INTO v_existing_appts
    FROM appointments a
    JOIN appointment_slots s ON a.slot_id = s.slot_id
    WHERE a.doctor_membership_id = v_doctor_membership_id
      AND a.status = 'confirmed'
      AND s.starts_at >= CURRENT_DATE;

    -- Book two confirmed appointments if fewer than 2 exist
    IF v_existing_appts < 2 THEN
        v_start_1 := (CURRENT_DATE + '10:00:00'::time) AT TIME ZONE 'Asia/Kuala_Lumpur';
        v_end_1   := v_start_1 + INTERVAL '30 minutes';
        v_start_2 := (CURRENT_DATE + 1 + '14:00:00'::time) AT TIME ZONE 'Asia/Kuala_Lumpur';
        v_end_2   := v_start_2 + INTERVAL '30 minutes';

        SELECT slot_id INTO v_slot_id_1
        FROM appointment_slots
        WHERE membership_id = v_doctor_membership_id AND starts_at = v_start_1
        LIMIT 1;

        SELECT slot_id INTO v_slot_id_2
        FROM appointment_slots
        WHERE membership_id = v_doctor_membership_id AND starts_at = v_start_2
        LIMIT 1;

        IF v_slot_id_1 IS NULL THEN
            v_slot_id_1 := uuidv7();
            INSERT INTO appointment_slots (slot_id, membership_id, organization_id, starts_at, ends_at, state, version)
            VALUES (v_slot_id_1, v_doctor_membership_id, v_org_id, v_start_1, v_end_1, 'booked', 0);
        ELSE
            UPDATE appointment_slots SET state = 'booked', updated_at = now() WHERE slot_id = v_slot_id_1;
        END IF;

        IF v_slot_id_2 IS NULL THEN
            v_slot_id_2 := uuidv7();
            INSERT INTO appointment_slots (slot_id, membership_id, organization_id, starts_at, ends_at, state, version)
            VALUES (v_slot_id_2, v_doctor_membership_id, v_org_id, v_start_2, v_end_2, 'booked', 0);
        ELSE
            UPDATE appointment_slots SET state = 'booked', updated_at = now() WHERE slot_id = v_slot_id_2;
        END IF;

        v_appt_id_1 := uuidv7();
        v_appt_id_2 := uuidv7();

        INSERT INTO appointments (appointment_id, slot_id, patient_profile_id, doctor_membership_id, organization_id, mode, status, fee_sen, currency, version)
        VALUES
            (v_appt_id_1, v_slot_id_1, v_patient_profile_id, v_doctor_membership_id, v_org_id, 'video', 'confirmed', 15000, 'MYR', 0),
            (v_appt_id_2, v_slot_id_2, v_patient_profile_id, v_doctor_membership_id, v_org_id, 'video', 'confirmed', 15000, 'MYR', 0);

        INSERT INTO appointment_status_history (history_id, appointment_id, previous_status, status, actor_profile_id, correlation_id)
        VALUES
            (uuidv7(), v_appt_id_1, NULL, 'confirmed', v_doctor_profile_id, v_correlation_id),
            (uuidv7(), v_appt_id_2, NULL, 'confirmed', v_doctor_profile_id, v_correlation_id);
    END IF;

    RAISE NOTICE 'Seeded doctor screenshot data for membership_id=%', v_doctor_membership_id;
END $$;

-- Seed 3–4 assigned patients for the doctor so the Patients screen shows real data.
DO $$
DECLARE
    v_org_id uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10';
    v_site_id uuid := '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11';
    v_doctor_profile_id uuid := '019ff368-e298-7806-81d2-7f3b249a58de';
    v_doctor_membership_id uuid;
    v_profile_id uuid;
    v_membership_id uuid;
    patient record;
BEGIN
    SELECT membership_id INTO v_doctor_membership_id
    FROM organization_memberships
    WHERE profile_id = v_doctor_profile_id AND organization_id = v_org_id;

    IF v_doctor_membership_id IS NULL THEN
        RAISE EXCEPTION 'Doctor membership not found for profile %', v_doctor_profile_id;
    END IF;

    FOR patient IN SELECT * FROM (VALUES
        ('Siti Aminah Binti Abdullah', 'siti.aminah@smartcura.app', '+60123456701'),
        ('Muhammad Razif Bin Omar', 'muhammad.razif@smartcura.app', '+60123456702'),
        ('Nurul Huda Binti Ismail', 'nurul.huda.patient@smartcura.app', '+60123456703'),
        ('Arif Hossain', 'arif.hossain@smartcura.app', '+60123456704')
    ) AS t(name, email, phone)
    LOOP
        SELECT profile_id INTO v_profile_id
        FROM profiles
        WHERE email = patient.email
        LIMIT 1;

        IF v_profile_id IS NULL THEN
            INSERT INTO profiles (profile_id, firebase_uid, status, display_name, email, phone_e164, preferred_locale, timezone, onboarding_completed_at, created_at, updated_at)
            VALUES (uuidv7(), uuidv7(), 'active', patient.name, patient.email, patient.phone, 'en-MY', 'Asia/Kuala_Lumpur', now(), now(), now())
            RETURNING profile_id INTO v_profile_id;
        ELSE
            UPDATE profiles
            SET display_name = patient.name,
                phone_e164 = patient.phone,
                updated_at = now()
            WHERE profile_id = v_profile_id;
        END IF;

        INSERT INTO organization_memberships (membership_id, profile_id, organization_id, role_id, status, verification_status, version, created_at, updated_at)
        VALUES (uuidv7(), v_profile_id, v_org_id, 'patient', 'active', 'approved', 0, now(), now())
        ON CONFLICT (profile_id, organization_id, role_id) DO UPDATE SET status = 'active', verification_status = 'approved', updated_at = now()
        RETURNING membership_id INTO v_membership_id;

        INSERT INTO membership_sites (membership_id, site_id, organization_id)
        VALUES (v_membership_id, v_site_id, v_org_id)
        ON CONFLICT (membership_id, site_id) DO NOTHING;

        INSERT INTO care_assignments (assignment_id, organization_id, clinician_membership_id, patient_profile_id, status, assigned_at, assigned_by_membership_id, version, created_at, updated_at)
        VALUES (uuidv7(), v_org_id, v_doctor_membership_id, v_profile_id, 'active', now(), v_doctor_membership_id, 0, now(), now())
        ON CONFLICT (clinician_membership_id, patient_profile_id) WHERE status = 'active' DO NOTHING;
    END LOOP;

    RAISE NOTICE 'Seeded assigned patients for doctor membership_id=%', v_doctor_membership_id;
END $$;
