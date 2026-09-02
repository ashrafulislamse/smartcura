-- SmartCura Demo Data Seed Script
-- Part 3: IoT devices, device assignments, vital readings, health alerts

BEGIN;

-- Org ID: 018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10
-- Existing device: 019ff4b0-4292-7a57-ac13-e2ee56c02272 (ESP32-C-14-15-001)

-- ============================================================================
-- 1. ADD MORE IoT DEVICES
-- ============================================================================

-- Device 2: assigned to Farah Natasya
INSERT INTO devices (device_id, organization_id, device_type, serial_number, hardware_revision, firmware_version, state, provisioned_at, last_seen_at, connectivity, hardware_profile, calibration_state, version)
VALUES (
  uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  'vitals_monitor', 'ESP32-C-14-15-002', 'DOIT DEVKIT V1', '1.0.0',
  'active', now() - interval '5 days', now() - interval '1 hour',
  'online', 'smartcura_esp32_v1', 'not_required', 1
);

-- Device 3: assigned to Mohammad Fahim
INSERT INTO devices (device_id, organization_id, device_type, serial_number, hardware_revision, firmware_version, state, provisioned_at, last_seen_at, connectivity, hardware_profile, calibration_state, version)
VALUES (
  uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  'vitals_monitor', 'ESP32-C-14-15-003', 'DOIT DEVKIT V1', '1.0.0',
  'active', now() - interval '3 days', now() - interval '2 hours',
  'online', 'smartcura_esp32_v1', 'not_required', 1
);

-- ============================================================================
-- 2. DEVICE ASSIGNMENTS
-- ============================================================================

-- Assign device 1 to Arif Hossain
INSERT INTO device_assignments (assignment_id, device_id, organization_id, patient_profile_id, assigned_by_profile_id, assigned_at)
SELECT uuidv7(), d.device_id, d.organization_id,
  p.profile_id,
  (SELECT profile_id FROM profiles WHERE display_name = 'Ahmad Fauzi Ibrahim'),
  now() - interval '5 days'
FROM devices d
JOIN profiles p ON p.display_name = 'Arif Hossain'
WHERE d.serial_number = 'ESP32-C-14-15-001';

-- Update device 1 state to active and last_seen
UPDATE devices SET state = 'active', connectivity = 'online', last_seen_at = now() - interval '30 minutes', version = 1
WHERE serial_number = 'ESP32-C-14-15-001';

-- Assign device 2 to Farah Natasya
INSERT INTO device_assignments (assignment_id, device_id, organization_id, patient_profile_id, assigned_by_profile_id, assigned_at)
SELECT uuidv7(), d.device_id, d.organization_id,
  p.profile_id,
  (SELECT profile_id FROM profiles WHERE display_name = 'Ahmad Fauzi Ibrahim'),
  now() - interval '5 days'
FROM devices d
JOIN profiles p ON p.display_name = 'Farah Natasya Yusof'
WHERE d.serial_number = 'ESP32-C-14-15-002';

-- Assign device 3 to Mohammad Fahim
INSERT INTO device_assignments (assignment_id, device_id, organization_id, patient_profile_id, assigned_by_profile_id, assigned_at)
SELECT uuidv7(), d.device_id, d.organization_id,
  p.profile_id,
  (SELECT profile_id FROM profiles WHERE display_name = 'Ahmad Fauzi Ibrahim'),
  now() - interval '3 days'
FROM devices d
JOIN profiles p ON p.display_name = 'Mohammad Fahim Ahmed'
WHERE d.serial_number = 'ESP32-C-14-15-003';

-- ============================================================================
-- 3. VITAL READINGS BATCH INSERT
-- Generate 3 days of readings for each patient (every 4 hours = 6 readings/day)
-- Heart rate, SpO2, body temperature
-- ============================================================================

-- Arif Hossain - device 1
-- Using generate_series to create readings over 3 days
INSERT INTO vital_readings (reading_id, device_id, patient_profile_id, metric, value, unit, recorded_at, ingested_at, boot_id, sequence_number, quality, source)
SELECT
  uuidv7(),
  d.device_id,
  p.profile_id,
  'heart_rate'::vital_metric,
  CASE
    WHEN random() < 0.05 THEN 95 + random() * 10  -- occasional low
    WHEN random() < 0.1 THEN 85 + random() * 10   -- normal-low
    ELSE 72 + random() * 15                          -- normal range 72-87
  END,
  '/min',
  now() - (interval '3 days' - g * interval '4 hours'),
  now() - (interval '3 days' - g * interval '4 hours') + interval '2 seconds',
  1, g * 3 + 1,
  'valid'::vital_reading_quality,
  'device'::reading_source
FROM generate_series(0, 17) AS g
CROSS JOIN devices d
CROSS JOIN profiles p
WHERE d.serial_number = 'ESP32-C-14-15-001' AND p.display_name = 'Arif Hossain';

INSERT INTO vital_readings (reading_id, device_id, patient_profile_id, metric, value, unit, recorded_at, ingested_at, boot_id, sequence_number, quality, source)
SELECT
  uuidv7(),
  d.device_id,
  p.profile_id,
  'oxygen_saturation'::vital_metric,
  CASE
    WHEN random() < 0.03 THEN 93 + random() * 2   -- occasional dip
    ELSE 97 + random() * 2                          -- normal 97-99
  END,
  '%',
  now() - (interval '3 days' - g * interval '4 hours'),
  now() - (interval '3 days' - g * interval '4 hours') + interval '2 seconds',
  1, g * 3 + 2,
  'valid'::vital_reading_quality,
  'device'::reading_source
FROM generate_series(0, 17) AS g
CROSS JOIN devices d
CROSS JOIN profiles p
WHERE d.serial_number = 'ESP32-C-14-15-001' AND p.display_name = 'Arif Hossain';

INSERT INTO vital_readings (reading_id, device_id, patient_profile_id, metric, value, unit, recorded_at, ingested_at, boot_id, sequence_number, quality, source)
SELECT
  uuidv7(),
  d.device_id,
  p.profile_id,
  'body_temperature'::vital_metric,
  36.4 + random() * 0.7,  -- 36.4-37.1 normal range
  'Cel',
  now() - (interval '3 days' - g * interval '4 hours'),
  now() - (interval '3 days' - g * interval '4 hours') + interval '2 seconds',
  1, g * 3 + 3,
  'valid'::vital_reading_quality,
  'device'::reading_source
FROM generate_series(0, 17) AS g
CROSS JOIN devices d
CROSS JOIN profiles p
WHERE d.serial_number = 'ESP32-C-14-15-001' AND p.display_name = 'Arif Hossain';

-- Farah Natasya - device 2
INSERT INTO vital_readings (reading_id, device_id, patient_profile_id, metric, value, unit, recorded_at, ingested_at, boot_id, sequence_number, quality, source)
SELECT
  uuidv7(), d.device_id, p.profile_id,
  'heart_rate'::vital_metric,
  68 + random() * 12,  -- 68-80 normal
  '/min',
  now() - (interval '3 days' - g * interval '4 hours'),
  now() - (interval '3 days' - g * interval '4 hours') + interval '2 seconds',
  1, g * 3 + 1,
  'valid'::vital_reading_quality, 'device'::reading_source
FROM generate_series(0, 17) AS g
CROSS JOIN devices d CROSS JOIN profiles p
WHERE d.serial_number = 'ESP32-C-14-15-002' AND p.display_name = 'Farah Natasya Yusof';

INSERT INTO vital_readings (reading_id, device_id, patient_profile_id, metric, value, unit, recorded_at, ingested_at, boot_id, sequence_number, quality, source)
SELECT
  uuidv7(), d.device_id, p.profile_id,
  'oxygen_saturation'::vital_metric,
  98 + random() * 1.5,  -- 98-99.5
  '%',
  now() - (interval '3 days' - g * interval '4 hours'),
  now() - (interval '3 days' - g * interval '4 hours') + interval '2 seconds',
  1, g * 3 + 2,
  'valid'::vital_reading_quality, 'device'::reading_source
FROM generate_series(0, 17) AS g
CROSS JOIN devices d CROSS JOIN profiles p
WHERE d.serial_number = 'ESP32-C-14-15-002' AND p.display_name = 'Farah Natasya Yusof';

INSERT INTO vital_readings (reading_id, device_id, patient_profile_id, metric, value, unit, recorded_at, ingested_at, boot_id, sequence_number, quality, source)
SELECT
  uuidv7(), d.device_id, p.profile_id,
  'body_temperature'::vital_metric,
  36.3 + random() * 0.6,
  'Cel',
  now() - (interval '3 days' - g * interval '4 hours'),
  now() - (interval '3 days' - g * interval '4 hours') + interval '2 seconds',
  1, g * 3 + 3,
  'valid'::vital_reading_quality, 'device'::reading_source
FROM generate_series(0, 17) AS g
CROSS JOIN devices d CROSS JOIN profiles p
WHERE d.serial_number = 'ESP32-C-14-15-002' AND p.display_name = 'Farah Natasya Yusof';

-- Mohammad Fahim - device 3
-- Include one elevated heart rate reading to trigger an alert
INSERT INTO vital_readings (reading_id, device_id, patient_profile_id, metric, value, unit, recorded_at, ingested_at, boot_id, sequence_number, quality, source)
SELECT
  uuidv7(), d.device_id, p.profile_id,
  'heart_rate'::vital_metric,
  CASE
    WHEN g = 10 THEN 108  -- one elevated reading
    ELSE 74 + random() * 14
  END,
  '/min',
  now() - (interval '3 days' - g * interval '4 hours'),
  now() - (interval '3 days' - g * interval '4 hours') + interval '2 seconds',
  1, g * 3 + 1,
  'valid'::vital_reading_quality, 'device'::reading_source
FROM generate_series(0, 17) AS g
CROSS JOIN devices d CROSS JOIN profiles p
WHERE d.serial_number = 'ESP32-C-14-15-003' AND p.display_name = 'Mohammad Fahim Ahmed';

INSERT INTO vital_readings (reading_id, device_id, patient_profile_id, metric, value, unit, recorded_at, ingested_at, boot_id, sequence_number, quality, source)
SELECT
  uuidv7(), d.device_id, p.profile_id,
  'oxygen_saturation'::vital_metric,
  97 + random() * 2,
  '%',
  now() - (interval '3 days' - g * interval '4 hours'),
  now() - (interval '3 days' - g * interval '4 hours') + interval '2 seconds',
  1, g * 3 + 2,
  'valid'::vital_reading_quality, 'device'::reading_source
FROM generate_series(0, 17) AS g
CROSS JOIN devices d CROSS JOIN profiles p
WHERE d.serial_number = 'ESP32-C-14-15-003' AND p.display_name = 'Mohammad Fahim Ahmed';

INSERT INTO vital_readings (reading_id, device_id, patient_profile_id, metric, value, unit, recorded_at, ingested_at, boot_id, sequence_number, quality, source)
SELECT
  uuidv7(), d.device_id, p.profile_id,
  'body_temperature'::vital_metric,
  36.5 + random() * 0.6,
  'Cel',
  now() - (interval '3 days' - g * interval '4 hours'),
  now() - (interval '3 days' - g * interval '4 hours') + interval '2 seconds',
  1, g * 3 + 3,
  'valid'::vital_reading_quality, 'device'::reading_source
FROM generate_series(0, 17) AS g
CROSS JOIN devices d CROSS JOIN profiles p
WHERE d.serial_number = 'ESP32-C-14-15-003' AND p.display_name = 'Mohammad Fahim Ahmed';

-- ============================================================================
-- 4. HEALTH ALERT THRESHOLDS
-- ============================================================================

-- Heart rate > 100 for all patients (org-level default)
INSERT INTO health_alert_thresholds (threshold_id, organization_id, patient_profile_id, metric, comparator, threshold_value, severity, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', p.profile_id, 'heart_rate'::vital_metric, 'gt'::health_threshold_comparator, 100, 'warning'::health_alert_severity, 0
FROM profiles p
WHERE p.display_name IN ('Arif Hossain', 'Farah Natasya Yusof', 'Mohammad Fahim Ahmed');

-- SpO2 < 95 for all patients
INSERT INTO health_alert_thresholds (threshold_id, organization_id, patient_profile_id, metric, comparator, threshold_value, severity, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', p.profile_id, 'oxygen_saturation'::vital_metric, 'lt'::health_threshold_comparator, 95, 'critical'::health_alert_severity, 0
FROM profiles p
WHERE p.display_name IN ('Arif Hossain', 'Farah Natasya Yusof', 'Mohammad Fahim Ahmed');

-- ============================================================================
-- 5. HEALTH ALERT (triggered by Mohammad Fahim's elevated heart rate)
-- ============================================================================

INSERT INTO health_alerts (alert_id, organization_id, patient_profile_id, device_id, metric, observed_value, threshold_id, severity, state, observed_at, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  p.profile_id, d.device_id,
  'heart_rate'::vital_metric, 108,
  (SELECT threshold_id FROM health_alert_thresholds WHERE patient_profile_id = p.profile_id AND metric = 'heart_rate' LIMIT 1),
  'warning'::health_alert_severity,
  'acknowledged'::health_alert_state,
  now() - interval '1 day',
  1
FROM profiles p CROSS JOIN devices d
WHERE p.display_name = 'Mohammad Fahim Ahmed' AND d.serial_number = 'ESP32-C-14-15-003';

-- Update the alert to acknowledged state with a timestamp
UPDATE health_alerts SET
  acknowledged_by_profile_id = (SELECT profile_id FROM profiles WHERE display_name = 'Dr. Nurul Aisyah Rahman'),
  acknowledged_at = now() - interval '23 hours',
  state = 'acknowledged'::health_alert_state,
  version = 1
WHERE metric = 'heart_rate'::vital_metric
  AND observed_value = 108;

COMMIT;
