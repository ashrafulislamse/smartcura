-- 0045: phone device type and own-scope device read permission.
--
-- WHY. The patient mobile app reads vitals from a smartwatch via Google Health
-- Connect. Health Connect does not identify which physical watch produced a
-- reading, so all readings flow through one "phone" device per patient. The
-- existing ingestion endpoint POST /organizations/{org}/devices/{id}/vital-readings
-- already accepts patient self-submission (actor { kind: 'self' }), and the
-- reading:ingest:device permission is already granted to patient (0014).
--
-- Two changes are needed:
--   * Add 'phone' to the device_type enum so a phone can be registered as a
--     device. The existing enum has vitals_monitor, ecg, thermometer,
--     pulse_oximeter, simulator — all dedicated hardware. A phone running
--     Health Connect is a legitimate ingestion source distinct from those.
--   * Seed device:read:own so a patient can list devices assigned to THEM,
--     without holding the admin-only device:read:organization. The own scope
--     is decidable from the session (owner = actor), so the PermissionGuard
--     can reject a caller without the grant before any query runs, exactly
--     as the other :own permissions added in 0044 work.
--
-- ALTER TYPE ... ADD VALUE is not transactional in the same way as data
-- inserts: the new value is usable immediately after the statement commits.
-- PostgreSQL 12+ allows ADD VALUE IF NOT EXISTS inside a transaction block,
-- and the migration runner wraps each file in one, so the IF NOT EXISTS
-- guard is included for idempotency.
ALTER TYPE device_type ADD VALUE IF NOT EXISTS 'phone';--> statement-breakpoint
INSERT INTO permissions (permission_id, description)
VALUES
  ('device:read:own', 'Read IoT devices assigned to the requesting profile')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;--> statement-breakpoint
-- Least privilege: patient reads only their own assigned devices. The
-- organization-scope device:read stays admin-only, as 0014 seeded it.
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('patient', 'device:read:own')
ON CONFLICT (role_id, permission_id) DO NOTHING;
