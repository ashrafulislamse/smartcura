-- SmartCura Seed: Phone-type device for Health Connect sync
--
-- WHY. The patient app reads vitals from Google Health Connect and POSTs them
-- to the device ingestion endpoint. The sync flow prefers a `phone`-type
-- device (migration 0045 added the enum value), but no phone device was ever
-- seeded on the live DB. Without it, Health Connect readings fall back to the
-- ESP32 `vitals_monitor` device, and `HealthContextBuilder.inferSource()`
-- labels them as `esp32` instead of `health_connect`.
--
-- This script creates one `phone`-type device in the test organization and
-- assigns it to Arif Hossain (the live test patient). It is idempotent: the
-- `ON CONFLICT DO NOTHING` on the device insert and the `WHERE NOT EXISTS`
-- guard on the assignment make it safe to re-run.
--
-- Run on the live VPS:
--   docker compose exec -T postgres psql -U smartcura_dev -d smartcura_dev \
--     -v ON_ERROR_STOP=1 -f tools/deploy/seed-phone-device.sql

BEGIN;

-- ===========================================================================
-- 1. Create the phone device
-- ===========================================================================

INSERT INTO devices (
  device_id, organization_id, device_type, serial_number,
  hardware_revision, firmware_version, state, provisioned_at,
  connectivity, hardware_profile, calibration_state, version
)
VALUES (
  uuidv7(),
  '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  'phone'::device_type,
  'PHONE-HC-ARIF-01',
  'Android Phone',
  NULL,
  'active'::device_state,
  now(),
  'unknown'::device_connectivity_status,
  'smartcura_esp32_v1'::device_hardware_profile,
  'not_required'::calibration_status,
  0
)
ON CONFLICT (organization_id, serial_number) DO NOTHING;

-- ===========================================================================
-- 2. Assign the phone device to Arif Hossain
-- ===========================================================================
-- A device can have only one active assignment at a time
-- (device_assignments_active_uq). The ESP32 (ESP32-C-14-15-001) already has
-- an active assignment to Arif, but that is a different device_id, so the
-- partial unique index on device_id does not conflict.

INSERT INTO device_assignments (
  assignment_id, device_id, organization_id,
  patient_profile_id, assigned_by_profile_id, assigned_at
)
SELECT
  uuidv7(),
  d.device_id,
  d.organization_id,
  p.profile_id,
  (SELECT profile_id FROM profiles WHERE display_name = 'Ahmad Fauzi Ibrahim'),
  now()
FROM devices d
JOIN profiles p ON p.display_name = 'Arif Hossain'
WHERE d.serial_number = 'PHONE-HC-ARIF-01'
  AND d.organization_id = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10'
  AND NOT EXISTS (
    SELECT 1 FROM device_assignments da
    WHERE da.device_id = d.device_id AND da.released_at IS NULL
  );

COMMIT;
