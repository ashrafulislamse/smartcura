-- 0046: doctor assigned-scope device permissions.
--
-- WHY. Until now only an admin could assign or release an IoT device to a patient
-- (device:assign:organization, seeded in 0014). A doctor treating a patient should
-- be able to assign a device to that patient and release one, but ONLY for patients
-- under their own active care. The `assigned` scope in the policy engine means
-- exactly that relationship: a care_assignments row links clinician_membership_id
-- to patient_profile_id with status = 'active'. The service checks
-- hasActiveCareAssignment before evaluatePermission, and denies as 404 (concealment)
-- when no assignment exists, matching the ReadingsService.authorizeCareAssignment
-- pattern.
--
-- Two permissions are seeded:
--   * device:assign:assigned — assign or release a device to/from a patient the
--     doctor is actively assigned to. The FOR SHARE lock on care_assignments inside
--     the DeviceRepository.assign/release transaction closes the TOCTOU gap between
--     the HTTP-layer assignment check and the write.
--   * device:read:assigned — read device details for a patient the doctor is
--     actively assigned to. The existing GET /doctor/devices already scopes through
--     care_assignments via profile_detail:read:assigned; this permission lets the
--     assign UI load a specific device for an assigned patient.
--
-- No new permissions are needed for the emergency break-glass vitals path: the
-- active break_glass_grant IS the authority, and emergency already holds
-- break_glass:activate + patient.record:read (seeded in 0028).

INSERT INTO permissions (permission_id, description)
VALUES
  ('device:assign:assigned', 'Assign or release an IoT device to a patient under the acting clinician''s active care'),
  ('device:read:assigned', 'Read IoT devices assigned to a patient under the acting clinician''s active care')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;--> statement-breakpoint

-- Least privilege: a doctor may assign and read devices only for patients they are
-- actively assigned to. The organization-scope device:assign and device:read stay
-- admin-only, as 0014 seeded them.
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('doctor', 'device:assign:assigned'),
  ('doctor', 'device:read:assigned')
ON CONFLICT (role_id, permission_id) DO NOTHING;
