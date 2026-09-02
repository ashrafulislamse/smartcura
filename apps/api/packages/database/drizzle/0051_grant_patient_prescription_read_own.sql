-- Grant patients the right to read their own prescriptions.
--
-- Commit 126ef01 changed GET /prescriptions to branch on role: patients use
-- prescriptions.listOwn and require prescription:read:own, while doctors use
-- prescriptions.listIssued and require prescription:read:assigned. Migration 0020
-- only granted prescription:read:assigned to the doctor role, so any patient
-- calling GET /prescriptions was receiving PERMISSION_DENIED.

INSERT INTO permissions (permission_id, description) VALUES
  ('prescription:read:own', 'Read own prescriptions')
ON CONFLICT (permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('patient', 'prescription:read:own')
ON CONFLICT DO NOTHING;
