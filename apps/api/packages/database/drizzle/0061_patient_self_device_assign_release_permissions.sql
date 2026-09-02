-- 0061: patient self-service device assign and release permissions.
--
-- WHY. The patient mobile app provisions a SmartCura device via BLE and needs
-- the device to be usable immediately, without waiting for a care provider to
-- approve the assignment in the portal. Likewise, a patient must be able to
-- unassign (remove) a device from their own profile. The existing organization-
-- scoped assign/release actions require device:assign:organization, which is
-- admin-only. These new :own-scope permissions are decidable from the session
-- alone (owner = actor), so PermissionGuard can reject a caller without the
-- grant before the service runs, matching the pattern of device:read:own (0045).

INSERT INTO permissions (permission_id, description)
VALUES
  ('device:assign:own', 'Assign an unassigned IoT device to the requesting profile'),
  ('device:release:own', 'Release an IoT device assigned to the requesting profile')
ON CONFLICT (permission_id) DO UPDATE
SET description = EXCLUDED.description;--> statement-breakpoint

-- Least privilege: patients can assign/release only their own devices.
INSERT INTO role_permissions (role_id, permission_id)
VALUES
  ('patient', 'device:assign:own'),
  ('patient', 'device:release:own')
ON CONFLICT (role_id, permission_id) DO NOTHING;
