-- 0044: own-scope read permissions for the patient mobile surface.
--
-- WHY. The patient mobile app needs four "me" reads — own prescriptions, own
-- consultations, own health alerts and the next upcoming appointment — plus a
-- doctor's ability to read already-generated bookable slots for their own
-- membership. `prescription:read:own`, `consultation:read:own` and
-- `appointment:read:own` were already granted to `patient` in earlier
-- migrations (0004, 0020, 0013). `reading:read:own` was granted in 0014.
--
-- Two permissions did not exist at all until now:
--   * `alert:read:own` — a patient reading their OWN health alerts. The IoT
--     surface only seeded `alert:read:assigned` (doctor, via care assignment),
--     because the own-scope patient read was not yet wired. It is granted to
--     `patient` only; `admin` deliberately has no clinical read scope, exactly
--     as 0014 left it for readings.
--   * `availability:read:own` — a doctor reading the slots already materialised
--     for their OWN membership over a date range. 0013 seeded only
--     `availability:read:global` (published capacity across organizations) and
--     `availability:write:own` (rule + slot generation). The own-scope READ is
--     narrower than global: it returns the doctor's own schedule, including
--     held/booked/closed slots the global search deliberately hides, and it is
--     granted to `doctor` only.
--
-- These are data-only inserts; no table or enum changes, so no drizzle snapshot
-- is generated and the schema_compatibility identity version is not touched
-- (readiness gates identity-token verification, not permission seeding).
INSERT INTO permissions (permission_id, description)
VALUES
  ('alert:read:own', 'Read the requesting profile''s own health alerts'),
  ('availability:read:own', 'Read already-generated bookable slots for the acting doctor''s own membership')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;--> statement-breakpoint
-- Least privilege per role:
--   * `patient` reads only their own health alerts (the assigned-scope alert
--     read stays doctor-only, as 0014 seeded it);
--   * `doctor` reads only their own already-generated slots (the global
--     published-capacity read is unchanged, and no write scope is implied).
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('patient', 'alert:read:own'),
  ('doctor', 'availability:read:own')
ON CONFLICT (role_id, permission_id) DO NOTHING;
