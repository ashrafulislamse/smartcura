-- SmartCura Demo Data Seed Script
-- Part 6 (fixed): AI messages, verification documents, doctor reviews, support tickets

BEGIN;

-- Org ID: 018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10

-- ============================================================================
-- 1. AI MESSAGES
-- ============================================================================

INSERT INTO ai_messages (message_id, conversation_id, role, sequence_no, content, created_at)
SELECT uuidv7(),
  ac.conversation_id,
  'patient'::ai_message_role,
  ac.next_sequence_no,
  'I have been feeling dizzy and lightheaded for the past two days, especially when standing up quickly.',
  now() - interval '12 hours'
FROM ai_conversations ac
WHERE ac.conversation_id = '019ffc4c-4ce9-77e0-a26a-b96b03798b74';

INSERT INTO ai_messages (message_id, conversation_id, role, sequence_no, content, created_at)
SELECT uuidv7(),
  ac.conversation_id,
  'assistant'::ai_message_role,
  ac.next_sequence_no + 1,
  'Based on the symptoms you described, dizziness upon standing could be related to several factors including blood pressure changes, dehydration, or medication effects. This information is general and not a diagnosis. I recommend discussing this with your doctor, especially given your hypertension history. Please seek immediate medical attention if you experience chest pain, severe headache, or fainting.',
  now() - interval '11 hours'
FROM ai_conversations ac
WHERE ac.conversation_id = '019ffc4c-4ce9-77e0-a26a-b96b03798b74';

UPDATE ai_conversations SET next_sequence_no = next_sequence_no + 2, updated_at = now()
WHERE conversation_id = '019ffc4c-4ce9-77e0-a26a-b96b03798b74';

-- ============================================================================
-- 2. STORED OBJECTS + VERIFICATION DOCUMENTS
-- ============================================================================

-- Dr. Nurul Aisyah - approved medical license
INSERT INTO stored_objects (object_id, organization_id, storage_provider, bucket, object_key, media_type, byte_size, declared_sha256, upload_status, scan_state, downloadable, uploaded_by_profile_id, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  'r2', 'verification', 'medical_license_dr_nurul.pdf',
  'application/pdf', 245760,
  encode(digest('medical_license_dr_nurul_placeholder', 'sha256'), 'hex'),
  'pending'::stored_object_status, 'not_scanned'::malware_scan_state, false,
  (SELECT profile_id FROM profiles WHERE display_name = 'Ahmad Fauzi Ibrahim'), 0;

INSERT INTO verification_documents (document_id, membership_id, organization_id, object_id, document_kind, status, issuing_authority, issued_at, expires_at, submitted_at, reviewed_by_membership_id, reviewed_at, review_decision_reason, version)
SELECT uuidv7(), om.membership_id, om.organization_id, so.object_id,
  'medical_license'::verification_document_kind,
  'approved'::verification_status,
  'Malaysian Medical Council',
  '2019-05-15', '2027-05-14',
  now() - interval '30 days',
  (SELECT om2.membership_id FROM organization_memberships om2 JOIN profiles p2 ON om2.profile_id = p2.profile_id WHERE p2.display_name = 'Lim Pei Shan' AND om2.role_id = 'admin'),
  now() - interval '25 days',
  'approved_verified', 0
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
CROSS JOIN stored_objects so
WHERE p.display_name = 'Dr. Nurul Aisyah Rahman' AND om.role_id = 'doctor'
  AND so.object_key = 'medical_license_dr_nurul.pdf';

-- Dr. Imran Hafiz - pending_review
INSERT INTO stored_objects (object_id, organization_id, storage_provider, bucket, object_key, media_type, byte_size, declared_sha256, upload_status, scan_state, downloadable, uploaded_by_profile_id, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  'r2', 'verification', 'medical_license_dr_imran.pdf',
  'application/pdf', 189440,
  encode(digest('medical_license_dr_imran_placeholder', 'sha256'), 'hex'),
  'pending'::stored_object_status, 'not_scanned'::malware_scan_state, false,
  (SELECT profile_id FROM profiles WHERE display_name = 'Ahmad Fauzi Ibrahim'), 0;

INSERT INTO verification_documents (document_id, membership_id, organization_id, object_id, document_kind, status, issuing_authority, issued_at, expires_at, submitted_at, version)
SELECT uuidv7(), om.membership_id, om.organization_id, so.object_id,
  'medical_license'::verification_document_kind,
  'pending_review'::verification_status,
  'Malaysian Medical Council',
  '2021-08-10', '2027-08-09',
  now() - interval '2 days', 0
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
CROSS JOIN stored_objects so
WHERE p.display_name = 'Dr. Imran Hafiz Salleh' AND om.role_id = 'doctor'
  AND so.object_key = 'medical_license_dr_imran.pdf';

-- Dr. Priya Krishnan - changes_requested
INSERT INTO stored_objects (object_id, organization_id, storage_provider, bucket, object_key, media_type, byte_size, declared_sha256, upload_status, scan_state, downloadable, uploaded_by_profile_id, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  'r2', 'verification', 'qualification_dr_priya.pdf',
  'application/pdf', 312320,
  encode(digest('qualification_dr_priya_placeholder', 'sha256'), 'hex'),
  'pending'::stored_object_status, 'not_scanned'::malware_scan_state, false,
  (SELECT profile_id FROM profiles WHERE display_name = 'Ahmad Fauzi Ibrahim'), 0;

INSERT INTO verification_documents (document_id, membership_id, organization_id, object_id, document_kind, status, issuing_authority, issued_at, expires_at, submitted_at, reviewed_by_membership_id, reviewed_at, review_decision_reason, version)
SELECT uuidv7(), om.membership_id, om.organization_id, so.object_id,
  'qualification_certificate'::verification_document_kind,
  'changes_requested'::verification_status,
  'Royal College of Paediatrics and Child Health',
  '2018-06-20', NULL,
  now() - interval '10 days',
  (SELECT om2.membership_id FROM organization_memberships om2 JOIN profiles p2 ON om2.profile_id = p2.profile_id WHERE p2.display_name = 'Lim Pei Shan' AND om2.role_id = 'admin'),
  now() - interval '8 days',
  'document_illegible', 0
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
CROSS JOIN stored_objects so
WHERE p.display_name = 'Dr. Priya Krishnan' AND om.role_id = 'doctor'
  AND so.object_key = 'qualification_dr_priya.pdf';

-- Rajesh Kumar (driver) - approved driving licence
INSERT INTO stored_objects (object_id, organization_id, storage_provider, bucket, object_key, media_type, byte_size, declared_sha256, upload_status, scan_state, downloadable, uploaded_by_profile_id, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  'r2', 'verification', 'driving_licence_rajesh.pdf',
  'application/pdf', 156672,
  encode(digest('driving_licence_rajesh_placeholder', 'sha256'), 'hex'),
  'pending'::stored_object_status, 'not_scanned'::malware_scan_state, false,
  (SELECT profile_id FROM profiles WHERE display_name = 'Ahmad Fauzi Ibrahim'), 0;

INSERT INTO verification_documents (document_id, membership_id, organization_id, object_id, document_kind, status, issuing_authority, issued_at, expires_at, submitted_at, reviewed_by_membership_id, reviewed_at, review_decision_reason, version)
SELECT uuidv7(), om.membership_id, om.organization_id, so.object_id,
  'driving_licence'::verification_document_kind,
  'approved'::verification_status,
  'Jabatan Pengangkutan Jalan',
  '2022-03-10', '2028-03-09',
  now() - interval '30 days',
  (SELECT om2.membership_id FROM organization_memberships om2 JOIN profiles p2 ON om2.profile_id = p2.profile_id WHERE p2.display_name = 'Lim Pei Shan' AND om2.role_id = 'admin'),
  now() - interval '28 days',
  'approved_verified', 0
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
CROSS JOIN stored_objects so
WHERE p.display_name = 'Rajesh Kumar' AND om.role_id = 'driver'
  AND so.object_key = 'driving_licence_rajesh.pdf';

-- ============================================================================
-- 3. DOCTOR REVIEWS
-- ============================================================================

INSERT INTO doctor_reviews (review_id, appointment_id, doctor_membership_id, patient_profile_id, organization_id, rating, comment, version)
SELECT uuidv7(),
  a.appointment_id, a.doctor_membership_id, a.patient_profile_id, a.organization_id,
  5,
  'Very thorough and attentive. The doctor explained everything clearly and the prescription helped with my headaches.',
  0
FROM appointments a
WHERE a.appointment_id = '019ffdc8-4d3d-70fe-9980-0a86c7186523';

INSERT INTO doctor_reviews (review_id, appointment_id, doctor_membership_id, patient_profile_id, organization_id, rating, comment, version)
SELECT uuidv7(),
  a.appointment_id, a.doctor_membership_id, a.patient_profile_id, a.organization_id,
  4,
  'Good consultation, happy with the medication review. Would have liked more time for questions.',
  0
FROM appointments a
WHERE a.appointment_id = '019ffdc9-b91b-74b2-8a0c-f938d8ef363a';

-- ============================================================================
-- 4. SUPPORT TICKETS
-- ============================================================================

INSERT INTO support_tickets (support_ticket_id, organization_id, requester_profile_id, category_code, subject_code, status, priority, version, first_response_due_at, resolution_due_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  p.profile_id,
  'technical', 'device_connection',
  'open'::support_ticket_status, 'medium'::support_ticket_priority, 0,
  now() + interval '24 hours', now() + interval '72 hours'
FROM profiles p WHERE p.display_name = 'Arif Hossain';

INSERT INTO support_tickets (support_ticket_id, organization_id, requester_profile_id, category_code, subject_code, status, priority, resolution_code, resolved_at, closed_at, version, first_response_due_at, resolution_due_at, first_responded_at, created_at, updated_at)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10',
  p.profile_id,
  'pharmacy', 'prescription_download',
  'closed'::support_ticket_status, 'low'::support_ticket_priority,
  'resolved_user_guided',
  now() - interval '2 days', now() - interval '2 days', 1,
  now() - interval '3 days', now() + interval '2 days',
  now() - interval '5 days' + interval '4 hours',
  now() - interval '5 days', now() - interval '2 days'
FROM profiles p WHERE p.display_name = 'Farah Natasya Yusof';

COMMIT;
