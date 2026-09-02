-- SmartCura Demo Data Seed Script
-- Part 4 (fixed): Medications, inventory, appointments, consultations,
--   messages, clinical notes, prescriptions
-- Key fix: prescriptions must be draft when items are inserted,
--   then updated to signed afterwards.

BEGIN;

-- Org ID: 018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10
-- Site ID: 018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11

-- ============================================================================
-- 1. MEDICATIONS + VARIANTS
-- ============================================================================

INSERT INTO medications (medication_id, generic_name, atc_code, controlled_schedule, requires_prescription, version)
VALUES (uuidv7(), 'Paracetamol', 'N02BE01', 'none', false, 0);

INSERT INTO medication_variants (variant_id, medication_id, brand_name, strength_value, strength_unit, form_code, pack_size)
SELECT uuidv7(), m.medication_id, 'Panadol', 500, 'mg', 'tablet', 100
FROM medications m WHERE m.generic_name = 'Paracetamol';

INSERT INTO medication_variants (variant_id, medication_id, brand_name, strength_value, strength_unit, form_code, pack_size)
SELECT uuidv7(), m.medication_id, 'Panadol Extra', 500, 'mg', 'tablet', 100
FROM medications m WHERE m.generic_name = 'Paracetamol';

INSERT INTO medications (medication_id, generic_name, atc_code, controlled_schedule, requires_prescription, version)
VALUES (uuidv7(), 'Amoxicillin', 'J01CA04', 'none', true, 0);

INSERT INTO medication_variants (variant_id, medication_id, brand_name, strength_value, strength_unit, form_code, pack_size)
SELECT uuidv7(), m.medication_id, 'Amoxil', 250, 'mg', 'capsule', 30
FROM medications m WHERE m.generic_name = 'Amoxicillin';

INSERT INTO medications (medication_id, generic_name, atc_code, controlled_schedule, requires_prescription, version)
VALUES (uuidv7(), 'Amlodipine', 'C08CA01', 'none', true, 0);

INSERT INTO medication_variants (variant_id, medication_id, brand_name, strength_value, strength_unit, form_code, pack_size)
SELECT uuidv7(), m.medication_id, 'Norvasc', 5, 'mg', 'tablet', 30
FROM medications m WHERE m.generic_name = 'Amlodipine';

INSERT INTO medications (medication_id, generic_name, atc_code, controlled_schedule, requires_prescription, version)
VALUES (uuidv7(), 'Metformin', 'A10BA02', 'none', true, 0);

INSERT INTO medication_variants (variant_id, medication_id, brand_name, strength_value, strength_unit, form_code, pack_size)
SELECT uuidv7(), m.medication_id, 'Glucophage', 500, 'mg', 'tablet', 60
FROM medications m WHERE m.generic_name = 'Metformin';

INSERT INTO medications (medication_id, generic_name, atc_code, controlled_schedule, requires_prescription, version)
VALUES (uuidv7(), 'Salbutamol', 'R03AC02', 'none', true, 0);

INSERT INTO medication_variants (variant_id, medication_id, brand_name, strength_value, strength_unit, form_code, pack_size)
SELECT uuidv7(), m.medication_id, 'Ventolin', 100, 'mcg', 'inhaler', 1
FROM medications m WHERE m.generic_name = 'Salbutamol';

-- ============================================================================
-- 2. INVENTORY BATCHES
-- ============================================================================

INSERT INTO inventory_batches (batch_id, organization_id, site_id, variant_id, lot_number, expires_on, status, unit_cost_sen, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  mv.variant_id, 'PNL-2025-001', '2027-06-30', 'available', 200, 0
FROM medication_variants mv JOIN medications m ON mv.medication_id = m.medication_id
WHERE m.generic_name = 'Paracetamol' AND mv.brand_name = 'Panadol';

INSERT INTO inventory_batches (batch_id, organization_id, site_id, variant_id, lot_number, expires_on, status, unit_cost_sen, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  mv.variant_id, 'AMX-2025-001', '2026-12-31', 'available', 1500, 0
FROM medication_variants mv JOIN medications m ON mv.medication_id = m.medication_id
WHERE m.generic_name = 'Amoxicillin' AND mv.brand_name = 'Amoxil';

INSERT INTO inventory_batches (batch_id, organization_id, site_id, variant_id, lot_number, expires_on, status, unit_cost_sen, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  mv.variant_id, 'NVC-2025-001', '2027-03-31', 'available', 3000, 0
FROM medication_variants mv JOIN medications m ON mv.medication_id = m.medication_id
WHERE m.generic_name = 'Amlodipine' AND mv.brand_name = 'Norvasc';

INSERT INTO inventory_batches (batch_id, organization_id, site_id, variant_id, lot_number, expires_on, status, unit_cost_sen, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  mv.variant_id, 'GLP-2025-001', '2027-01-31', 'available', 800, 0
FROM medication_variants mv JOIN medications m ON mv.medication_id = m.medication_id
WHERE m.generic_name = 'Metformin' AND mv.brand_name = 'Glucophage';

INSERT INTO inventory_batches (batch_id, organization_id, site_id, variant_id, lot_number, expires_on, status, unit_cost_sen, version)
SELECT uuidv7(), '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11',
  mv.variant_id, 'VTL-2025-001', '2026-10-31', 'available', 2500, 0
FROM medication_variants mv JOIN medications m ON mv.medication_id = m.medication_id
WHERE m.generic_name = 'Salbutamol' AND mv.brand_name = 'Ventolin';

-- ============================================================================
-- 3. UPDATE EXISTING APPOINTMENTS to varied statuses
-- ============================================================================

UPDATE appointments SET status = 'completed', version = 1
WHERE appointment_id = '019ffdc8-4d3d-70fe-9980-0a86c7186523';

UPDATE appointments SET status = 'completed', version = 1
WHERE appointment_id = '019ffdc9-b91b-74b2-8a0c-f938d8ef363a';

UPDATE appointments SET status = 'cancelled', cancellation_reason_code = 'patient_request', version = 1
WHERE appointment_id = '019ffdce-bc3e-7644-b72b-1486af0f9188';

UPDATE appointments SET status = 'completed', version = 1
WHERE appointment_id = '019ffde6-f708-75d0-ad19-f42a4be3b888';

-- ============================================================================
-- 4. UPDATE CONSULTATIONS to match
-- ============================================================================

UPDATE consultations SET
  status = 'completed',
  started_at = now() - interval '2 days',
  completed_at = now() - interval '2 days' + interval '30 minutes',
  outcome_code = 'advice_and_prescription',
  version = 1
WHERE consultation_id = '019ffdcb-9284-7a25-8c9e-3b6153b15b51';

UPDATE consultations SET
  status = 'completed',
  started_at = now() - interval '2 days' + interval '1 hour',
  completed_at = now() - interval '2 days' + interval '1 hour 30 minutes',
  outcome_code = 'advice_and_prescription',
  version = 1
WHERE consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209';

UPDATE consultations SET
  status = 'cancelled',
  version = 1
WHERE consultation_id = '019ffdd6-1bf8-70d6-ade6-0a8be8ee2161';

UPDATE consultations SET
  status = 'completed',
  started_at = now() - interval '1 day',
  completed_at = now() - interval '1 day' + interval '45 minutes',
  outcome_code = 'follow_up_scheduled',
  version = 1
WHERE consultation_id = '019ffde7-5cb3-7cc9-b338-51e83fcca876';

-- ============================================================================
-- 5. MESSAGES TO EXISTING CONVERSATION 1
-- ============================================================================

INSERT INTO messages (message_id, conversation_id, sender_profile_id, sequence_no, client_correlation_id, message_type, text_content, created_at)
SELECT uuidv7(), c.conversation_id,
  (SELECT profile_id FROM profiles WHERE display_name = 'Arif Hossain'),
  1, uuidv7(), 'text'::message_type,
  'Good morning doctor, I have been experiencing headaches for the past three days.',
  now() - interval '2 days' + interval '2 minutes'
FROM conversations c WHERE c.conversation_id = '019ffdcb-9289-7615-b3d1-e04980f19a1d';

INSERT INTO messages (message_id, conversation_id, sender_profile_id, sequence_no, client_correlation_id, message_type, text_content, created_at)
SELECT uuidv7(), c.conversation_id,
  (SELECT profile_id FROM profiles WHERE display_name = 'Dr. Nurul Aisyah Rahman'),
  2, uuidv7(), 'text'::message_type,
  'Good morning Arif. Can you describe the pain? Is it on one side or both sides of your head?',
  now() - interval '2 days' + interval '3 minutes'
FROM conversations c WHERE c.conversation_id = '019ffdcb-9289-7615-b3d1-e04980f19a1d';

INSERT INTO messages (message_id, conversation_id, sender_profile_id, sequence_no, client_correlation_id, message_type, text_content, created_at)
SELECT uuidv7(), c.conversation_id,
  (SELECT profile_id FROM profiles WHERE display_name = 'Arif Hossain'),
  3, uuidv7(), 'text'::message_type,
  'Mostly on the forehead and behind the eyes. It gets worse in the afternoon.',
  now() - interval '2 days' + interval '4 minutes'
FROM conversations c WHERE c.conversation_id = '019ffdcb-9289-7615-b3d1-e04980f19a1d';

INSERT INTO messages (message_id, conversation_id, sender_profile_id, sequence_no, client_correlation_id, message_type, text_content, created_at)
SELECT uuidv7(), c.conversation_id,
  (SELECT profile_id FROM profiles WHERE display_name = 'Dr. Nurul Aisyah Rahman'),
  4, uuidv7(), 'text'::message_type,
  'Given your history of hypertension, this could be tension-related. Let me check your blood pressure readings from the device.',
  now() - interval '2 days' + interval '5 minutes'
FROM conversations c WHERE c.conversation_id = '019ffdcb-9289-7615-b3d1-e04980f19a1d';

UPDATE conversations SET next_sequence_no = 5
WHERE conversation_id = '019ffdcb-9289-7615-b3d1-e04980f19a1d';

-- ============================================================================
-- 6. CLINICAL NOTES for completed consultations
-- ============================================================================

INSERT INTO clinical_notes (note_id, consultation_id, author_membership_id, organization_id, version_no, status, content, signed_at, version)
SELECT uuidv7(),
  c.consultation_id, c.doctor_membership_id, c.organization_id,
  1, 'draft'::clinical_note_status,
  '{"chief_complaint": "Headache for 3 days, frontal and behind eyes", "examination": "Blood pressure 138/86 mmHg, pulse 76 bpm, afebrile", "assessment": "Tension headache likely secondary to suboptimal BP control", "plan": "Continue amlodipine 5mg daily, add paracetamol 500mg PRN for headache, review BP log in 1 week", "follow_up": "Review in 7 days"}'::jsonb,
  NULL, 0
FROM consultations c WHERE c.consultation_id = '019ffdcb-9284-7a25-8c9e-3b6153b15b51';

-- Sign the note
UPDATE clinical_notes SET
  status = 'signed'::clinical_note_status,
  signed_at = now() - interval '2 days' + interval '30 minutes'
WHERE consultation_id = '019ffdcb-9284-7a25-8c9e-3b6153b15b51';

INSERT INTO clinical_notes (note_id, consultation_id, author_membership_id, organization_id, version_no, status, content, signed_at, version)
SELECT uuidv7(),
  c.consultation_id, c.doctor_membership_id, c.organization_id,
  1, 'draft'::clinical_note_status,
  '{"chief_complaint": "Routine diabetes follow-up", "examination": "BP 132/84, weight 72kg, fasting glucose readings stable", "assessment": "Type 2 DM well controlled on metformin, HbA1c target met", "plan": "Continue metformin 500mg BD, reinforce dietary advice, quarterly HbA1c", "follow_up": "3 months"}'::jsonb,
  NULL, 0
FROM consultations c WHERE c.consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209';

UPDATE clinical_notes SET
  status = 'signed'::clinical_note_status,
  signed_at = now() - interval '2 days' + interval '1 hour 30 minutes'
WHERE consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209';

INSERT INTO clinical_notes (note_id, consultation_id, author_membership_id, organization_id, version_no, status, content, signed_at, version)
SELECT uuidv7(),
  c.consultation_id, c.doctor_membership_id, c.organization_id,
  1, 'draft'::clinical_note_status,
  '{"chief_complaint": "Follow-up consultation for medication review", "examination": "Vitals stable, HR 74 bpm, SpO2 98%, temp 36.7C", "assessment": "Patient responding well to current regimen", "plan": "Continue current medications, monitor vitals via IoT device", "follow_up": "4 weeks"}'::jsonb,
  NULL, 0
FROM consultations c WHERE c.consultation_id = '019ffde7-5cb3-7cc9-b338-51e83fcca876';

UPDATE clinical_notes SET
  status = 'signed'::clinical_note_status,
  signed_at = now() - interval '1 day' + interval '45 minutes'
WHERE consultation_id = '019ffde7-5cb3-7cc9-b338-51e83fcca876';

-- ============================================================================
-- 7. PRESCRIPTIONS (draft first, add items, then sign)
-- ============================================================================

-- Prescription 1: for consultation 1 (Arif Hossain - headache)
INSERT INTO prescriptions (prescription_id, consultation_id, patient_profile_id, doctor_membership_id, organization_id, status, version)
SELECT uuidv7(),
  c.consultation_id, c.patient_profile_id, c.doctor_membership_id, c.organization_id,
  'draft'::prescription_status, 0
FROM consultations c WHERE c.consultation_id = '019ffdcb-9284-7a25-8c9e-3b6153b15b51';

-- Add items while still draft
INSERT INTO prescription_items (prescription_item_id, prescription_id, position, medication_text, dose_value, dose_unit, route_code, frequency_code, frequency_text, duration_days, patient_instructions)
SELECT uuidv7(), p.prescription_id, 1,
  'Paracetamol 500mg', 500, 'mg', 'oral', 'qid_prn', 'Every 6 hours as needed', 7,
  'Take 1-2 tablets every 6 hours as needed for headache. Do not exceed 8 tablets in 24 hours.'
FROM prescriptions p
JOIN consultations c ON p.consultation_id = c.consultation_id
WHERE c.consultation_id = '019ffdcb-9284-7a25-8c9e-3b6153b15b51';

-- Sign the prescription
UPDATE prescriptions SET
  status = 'signed'::prescription_status,
  signed_at = now() - interval '2 days' + interval '30 minutes',
  expires_at = now() + interval '6 months'
WHERE consultation_id = '019ffdcb-9284-7a25-8c9e-3b6153b15b51';

-- Prescription 2: for consultation 2 (Arif Hossain - diabetes)
INSERT INTO prescriptions (prescription_id, consultation_id, patient_profile_id, doctor_membership_id, organization_id, status, version)
SELECT uuidv7(),
  c.consultation_id, c.patient_profile_id, c.doctor_membership_id, c.organization_id,
  'draft'::prescription_status, 0
FROM consultations c WHERE c.consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209';

INSERT INTO prescription_items (prescription_item_id, prescription_id, position, medication_text, dose_value, dose_unit, route_code, frequency_code, frequency_text, duration_days, patient_instructions)
SELECT uuidv7(), p.prescription_id, 1,
  'Metformin 500mg', 500, 'mg', 'oral', 'bid', 'Twice daily with meals', 90,
  'Take one tablet twice daily with breakfast and dinner. Continue current regimen.'
FROM prescriptions p
JOIN consultations c ON p.consultation_id = c.consultation_id
WHERE c.consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209';

INSERT INTO prescription_items (prescription_item_id, prescription_id, position, medication_text, dose_value, dose_unit, route_code, frequency_code, frequency_text, duration_days, patient_instructions)
SELECT uuidv7(), p.prescription_id, 2,
  'Amlodipine 5mg', 5, 'mg', 'oral', 'od', 'Once daily in the morning', 90,
  'Take one tablet every morning. Continue for blood pressure control.'
FROM prescriptions p
JOIN consultations c ON p.consultation_id = c.consultation_id
WHERE c.consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209';

UPDATE prescriptions SET
  status = 'signed'::prescription_status,
  signed_at = now() - interval '2 days' + interval '1 hour 30 minutes',
  expires_at = now() + interval '6 months'
WHERE consultation_id = '019ffdd6-1bd3-7fda-ba4c-27cf43921209';

COMMIT;
