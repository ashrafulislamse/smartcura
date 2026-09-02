-- SmartCura Demo Data Seed Script
-- Part 2: Doctor details, patient health records

BEGIN;

-- Org ID: 018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10
-- Site ID: 018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11

-- ============================================================================
-- 1. DOCTOR PROFESSIONAL DETAILS for new doctors
-- ============================================================================

-- Dr. Imran Hafiz Salleh - Cardiology
INSERT INTO doctor_professional_details (membership_id, organization_id, biography, years_experience, consultation_fee_sen, currency, accepts_new_patients, version)
SELECT om.membership_id, om.organization_id,
  'Cardiologist with 8 years of experience in interventional cardiology. Trained at Hospital Kuala Lumpur with special interest in preventive heart health and cardiac rehabilitation.',
  8, 20000, 'MYR', true, 0
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
WHERE p.firebase_uid = 'seed_doc2_firebase_001' AND om.role_id = 'doctor';

-- Dr. Priya Krishnan - Paediatrics
INSERT INTO doctor_professional_details (membership_id, organization_id, biography, years_experience, consultation_fee_sen, currency, accepts_new_patients, version)
SELECT om.membership_id, om.organization_id,
  'Paediatrician with 6 years of experience in child health and developmental disorders. Passionate about early intervention and family-centred care.',
  6, 12000, 'MYR', true, 0
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
WHERE p.firebase_uid = 'seed_doc3_firebase_001' AND om.role_id = 'doctor';

-- ============================================================================
-- 2. DOCTOR SPECIALTIES
-- ============================================================================

-- Dr. Nurul Aisyah (existing) - General Practice
INSERT INTO doctor_professional_specialties (membership_id, organization_id, specialty_code, is_primary)
SELECT om.membership_id, om.organization_id, 'general_practice', true
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
WHERE p.display_name = 'Dr. Nurul Aisyah Rahman' AND om.role_id = 'doctor'
ON CONFLICT DO NOTHING;

-- Dr. Imran Hafiz - Cardiology
INSERT INTO doctor_professional_specialties (membership_id, organization_id, specialty_code, is_primary)
SELECT om.membership_id, om.organization_id, 'cardiology', true
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
WHERE p.firebase_uid = 'seed_doc2_firebase_001' AND om.role_id = 'doctor';

-- Dr. Priya Krishnan - Paediatrics
INSERT INTO doctor_professional_specialties (membership_id, organization_id, specialty_code, is_primary)
SELECT om.membership_id, om.organization_id, 'paediatrics', true
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
WHERE p.firebase_uid = 'seed_doc3_firebase_001' AND om.role_id = 'doctor';

-- ============================================================================
-- 3. DOCTOR LANGUAGES
-- ============================================================================

-- Dr. Nurul Aisyah - English, Malay, Arabic
INSERT INTO doctor_professional_languages (membership_id, organization_id, language_code)
SELECT om.membership_id, om.organization_id, lang
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
CROSS JOIN (VALUES ('eng'), ('msa'), ('ara')) AS langs(lang)
WHERE p.display_name = 'Dr. Nurul Aisyah Rahman' AND om.role_id = 'doctor'
ON CONFLICT DO NOTHING;

-- Dr. Imran Hafiz - English, Malay, Tamil
INSERT INTO doctor_professional_languages (membership_id, organization_id, language_code)
SELECT om.membership_id, om.organization_id, lang
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
CROSS JOIN (VALUES ('eng'), ('msa'), ('tam')) AS langs(lang)
WHERE p.firebase_uid = 'seed_doc2_firebase_001' AND om.role_id = 'doctor';

-- Dr. Priya Krishnan - English, Malay, Mandarin, Tamil
INSERT INTO doctor_professional_languages (membership_id, organization_id, language_code)
SELECT om.membership_id, om.organization_id, lang
FROM organization_memberships om
JOIN profiles p ON om.profile_id = p.profile_id
CROSS JOIN (VALUES ('eng'), ('msa'), ('zho'), ('tam')) AS langs(lang)
WHERE p.firebase_uid = 'seed_doc3_firebase_001' AND om.role_id = 'doctor';

-- ============================================================================
-- 4. PATIENT ADDRESSES
-- ============================================================================

-- Arif Hossain - Kuala Lumpur
INSERT INTO patient_addresses (address_id, profile_id, label, line1, line2, city, state, postcode, country_code, is_primary, latitude, longitude, version)
SELECT uuidv7(), p.profile_id, 'Home', 'Unit 12-3A, Residensi Sinar', 'Jalan Ampang', 'Kuala Lumpur', 'Wilayah Persekutuan', '55000', 'MY', true, 3.1585, 101.7230, 0
FROM profiles p WHERE p.display_name = 'Arif Hossain';

-- Farah Natasya - Petaling Jaya
INSERT INTO patient_addresses (address_id, profile_id, label, line1, line2, city, state, postcode, country_code, is_primary, latitude, longitude, version)
SELECT uuidv7(), p.profile_id, 'Home', '22, Jalan SS 21/1A', 'Damansara Utama', 'Petaling Jaya', 'Selangor', '47400', 'MY', true, 3.1340, 101.6200, 0
FROM profiles p WHERE p.display_name = 'Farah Natasya Yusof';

-- Mohammad Fahim Ahmed - Shah Alam
INSERT INTO patient_addresses (address_id, profile_id, label, line1, line2, city, state, postcode, country_code, is_primary, latitude, longitude, version)
SELECT uuidv7(), p.profile_id, 'Home', 'Block B-08-02, Apartment Sentral', 'Persiaran Klang', 'Shah Alam', 'Selangor', '40000', 'MY', true, 3.0730, 101.4660, 0
FROM profiles p WHERE p.display_name = 'Mohammad Fahim Ahmed';

-- ============================================================================
-- 5. PATIENT ALLERGIES
-- ============================================================================

-- Arif Hossain - Penicillin (severe)
INSERT INTO patient_allergies (allergy_id, profile_id, substance, reaction, severity, recorded_at, noted_by_profile_id, version)
SELECT uuidv7(), p.profile_id, 'Penicillin', 'Skin rash and difficulty breathing', 'severe', now() - interval '30 days', NULL, 0
FROM profiles p WHERE p.display_name = 'Arif Hossain';

-- Farah Natasya - Shellfish (moderate)
INSERT INTO patient_allergies (allergy_id, profile_id, substance, reaction, severity, recorded_at, noted_by_profile_id, version)
SELECT uuidv7(), p.profile_id, 'Shellfish', 'Hives and mild swelling', 'moderate', now() - interval '60 days', NULL, 0
FROM profiles p WHERE p.display_name = 'Farah Natasya Yusof';

-- Mohammad Fahim - No known allergies - skip

-- ============================================================================
-- 6. PATIENT CONDITIONS
-- ============================================================================

-- Arif Hossain - Hypertension (active)
INSERT INTO patient_conditions (condition_id, profile_id, condition_name, status, onset_date, notes, version)
SELECT uuidv7(), p.profile_id, 'Hypertension', 'active', '2024-03-15', 'Managed with amlodipine 5mg daily', 0
FROM profiles p WHERE p.display_name = 'Arif Hossain';

-- Arif Hossain - Type 2 Diabetes (active)
INSERT INTO patient_conditions (condition_id, profile_id, condition_name, status, onset_date, notes, version)
SELECT uuidv7(), p.profile_id, 'Type 2 Diabetes Mellitus', 'active', '2023-08-01', 'HbA1c monitored quarterly, metformin 500mg twice daily', 0
FROM profiles p WHERE p.display_name = 'Arif Hossain';

-- Farah Natasya - Asthma (active)
INSERT INTO patient_conditions (condition_id, profile_id, condition_name, status, onset_date, notes, version)
SELECT uuidv7(), p.profile_id, 'Asthma', 'active', '2020-01-01', 'Mild persistent, uses salbutamol inhaler as needed', 0
FROM profiles p WHERE p.display_name = 'Farah Natasya Yusof';

-- Mohammad Fahim - Migraine (active)
INSERT INTO patient_conditions (condition_id, profile_id, condition_name, status, onset_date, notes, version)
SELECT uuidv7(), p.profile_id, 'Chronic Migraine', 'active', '2022-06-01', 'Approximately 4-6 episodes per month, triggers include stress and screen time', 0
FROM profiles p WHERE p.display_name = 'Mohammad Fahim Ahmed';

-- ============================================================================
-- 7. PATIENT EMERGENCY CONTACTS
-- ============================================================================

-- Arif Hossain - Wife
INSERT INTO patient_emergency_contacts (contact_id, profile_id, name, relationship, phone_e164, is_primary, version)
SELECT uuidv7(), p.profile_id, 'Nurul Jahan Hossain', 'Spouse', '+60123456799', true, 0
FROM profiles p WHERE p.display_name = 'Arif Hossain';

-- Farah Natasya - Father
INSERT INTO patient_emergency_contacts (contact_id, profile_id, name, relationship, phone_e164, is_primary, version)
SELECT uuidv7(), p.profile_id, 'Mohd Yusof bin Abdullah', 'Father', '+60123456798', true, 0
FROM profiles p WHERE p.display_name = 'Farah Natasya Yusof';

-- Mohammad Fahim - Brother
INSERT INTO patient_emergency_contacts (contact_id, profile_id, name, relationship, phone_e164, is_primary, version)
SELECT uuidv7(), p.profile_id, 'Tariq Ahmed', 'Brother', '+60123456797', true, 0
FROM profiles p WHERE p.display_name = 'Mohammad Fahim Ahmed';

COMMIT;
