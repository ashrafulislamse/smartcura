-- SmartCura Demo Data Seed Script
-- Part 1: Profiles + Memberships
-- Uses Malaysian/Bengali names, realistic phone numbers, Malaysian addresses

BEGIN;

-- ============================================================================
-- 1. UPDATE EXISTING PROFILES with realistic Malaysian/Bengali names
-- ============================================================================

-- Doctor: Dr. Sarah Chen -> Dr. Nurul Aisyah binti Rahman
UPDATE profiles SET
  display_name = 'Dr. Nurul Aisyah Rahman',
  email = 'nurul.aisyah@smartcura.app',
  phone_e164 = '+60123456701'
WHERE profile_id = '019ff368-e298-7806-81d2-7f3b249a58de';

-- Patient: John Anderson -> Arif Hossain
UPDATE profiles SET
  display_name = 'Arif Hossain',
  email = 'arif.hossain@smartcura.app',
  phone_e164 = '+60123456710'
WHERE profile_id = '019ff368-e3e5-75aa-be11-7859b5fdf1d3';

-- Pharmacy staff -> Tan Wei Jie
UPDATE profiles SET
  display_name = 'Tan Wei Jie',
  email = 'tan.weijie@smartcura.app',
  phone_e164 = '+60123456720'
WHERE profile_id = '019ff368-e511-7cad-83cc-a664e3fdb499';

-- Driver -> Rajesh Kumar a/l Subramaniam
UPDATE profiles SET
  display_name = 'Rajesh Kumar',
  email = 'rajesh.kumar@smartcura.app',
  phone_e164 = '+60123456730'
WHERE profile_id = '019ff368-e64b-74ba-b394-500a0b5118b5';

-- Emergency staff -> Siti Aishah binti Abdullah
UPDATE profiles SET
  display_name = 'Siti Aishah Abdullah',
  email = 'siti.aishah@smartcura.app',
  phone_e164 = '+60123456740'
WHERE profile_id = '019ff368-e778-793a-9498-eada40627634';

-- Super admin -> Ahmad Fauzi bin Ibrahim
UPDATE profiles SET
  display_name = 'Ahmad Fauzi Ibrahim',
  email = 'ahmad.fauzi@smartcura.app',
  phone_e164 = '+60123456750'
WHERE profile_id = '019ff368-e8ac-7979-b7b5-230e384748ff';

-- Admin -> Lim Pei Shan
UPDATE profiles SET
  display_name = 'Lim Pei Shan',
  email = 'lim.peishan@smartcura.app',
  phone_e164 = '+60123456760'
WHERE profile_id = '019ff369-67af-7c75-b53b-d39ab95b68b3';

-- ============================================================================
-- 2. CREATE NEW PROFILES
-- ============================================================================

-- Doctor 2: Dr. Imran Hafiz bin Salleh
INSERT INTO profiles (profile_id, firebase_uid, status, display_name, email, phone_e164, preferred_locale, timezone, onboarding_completed_at)
VALUES (
  uuidv7(), 'seed_doc2_firebase_001', 'active',
  'Dr. Imran Hafiz Salleh',
  'imran.hafiz@smartcura.app',
  '+60123456702',
  'en-MY', 'Asia/Kuala_Lumpur', now()
);

-- Doctor 3: Dr. Priya a/p Krishnan
INSERT INTO profiles (profile_id, firebase_uid, status, display_name, email, phone_e164, preferred_locale, timezone, onboarding_completed_at)
VALUES (
  uuidv7(), 'seed_doc3_firebase_001', 'active',
  'Dr. Priya Krishnan',
  'priya.krishnan@smartcura.app',
  '+60123456703',
  'en-MY', 'Asia/Kuala_Lumpur', now()
);

-- Patient 2: Farah Natasya binti Mohd Yusof
INSERT INTO profiles (profile_id, firebase_uid, status, display_name, email, phone_e164, preferred_locale, timezone, onboarding_completed_at)
VALUES (
  uuidv7(), 'seed_pat2_firebase_001', 'active',
  'Farah Natasya Yusof',
  'farah.natasya@smartcura.app',
  '+60123456711',
  'en-MY', 'Asia/Kuala_Lumpur', now()
);

-- Patient 3: Mohammad Fahim Ahmed
INSERT INTO profiles (profile_id, firebase_uid, status, display_name, email, phone_e164, preferred_locale, timezone, onboarding_completed_at)
VALUES (
  uuidv7(), 'seed_pat3_firebase_001', 'active',
  'Mohammad Fahim Ahmed',
  'fahim.ahmed@smartcura.app',
  '+60123456712',
  'en-MY', 'Asia/Kuala_Lumpur', now()
);

-- Driver 2: Lee Chee Keong
INSERT INTO profiles (profile_id, firebase_uid, status, display_name, email, phone_e164, preferred_locale, timezone, onboarding_completed_at)
VALUES (
  uuidv7(), 'seed_drv2_firebase_001', 'active',
  'Lee Chee Keong',
  'lee.cheekeong@smartcura.app',
  '+60123456731',
  'en-MY', 'Asia/Kuala_Lumpur', now()
);

-- Emergency 2: Nurul Huda binti Ismail
INSERT INTO profiles (profile_id, firebase_uid, status, display_name, email, phone_e164, preferred_locale, timezone, onboarding_completed_at)
VALUES (
  uuidv7(), 'seed_em2_firebase_001', 'active',
  'Nurul Huda Ismail',
  'nurul.huda@smartcura.app',
  '+60123456741',
  'en-MY', 'Asia/Kuala_Lumpur', now()
);

-- ============================================================================
-- 3. CREATE MEMBERSHIPS for new profiles
-- Note: professional roles start as 'applied' but we set 'active' for demo
-- since the seeded system already bypasses verification for the FYP demo.
-- ============================================================================

-- Get the org ID
-- 018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10

-- Doctor 2 membership
INSERT INTO organization_memberships (membership_id, profile_id, organization_id, role_id, status, verification_status, version)
SELECT uuidv7(), p.profile_id, '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', 'doctor', 'active', 'approved', 0
FROM profiles p WHERE p.firebase_uid = 'seed_doc2_firebase_001';

-- Doctor 3 membership
INSERT INTO organization_memberships (membership_id, profile_id, organization_id, role_id, status, verification_status, version)
SELECT uuidv7(), p.profile_id, '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', 'doctor', 'active', 'approved', 0
FROM profiles p WHERE p.firebase_uid = 'seed_doc3_firebase_001';

-- Patient 2 membership
INSERT INTO organization_memberships (membership_id, profile_id, organization_id, role_id, status, version)
SELECT uuidv7(), p.profile_id, '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', 'patient', 'active', 0
FROM profiles p WHERE p.firebase_uid = 'seed_pat2_firebase_001';

-- Patient 3 membership
INSERT INTO organization_memberships (membership_id, profile_id, organization_id, role_id, status, version)
SELECT uuidv7(), p.profile_id, '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', 'patient', 'active', 0
FROM profiles p WHERE p.firebase_uid = 'seed_pat3_firebase_001';

-- Driver 2 membership
INSERT INTO organization_memberships (membership_id, profile_id, organization_id, role_id, status, verification_status, version)
SELECT uuidv7(), p.profile_id, '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', 'driver', 'active', 'approved', 0
FROM profiles p WHERE p.firebase_uid = 'seed_drv2_firebase_001';

-- Emergency 2 membership
INSERT INTO organization_memberships (membership_id, profile_id, organization_id, role_id, status, verification_status, version)
SELECT uuidv7(), p.profile_id, '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10', 'emergency', 'active', 'approved', 0
FROM profiles p WHERE p.firebase_uid = 'seed_em2_firebase_001';

-- ============================================================================
-- 4. UPDATE EXISTING MEMBERSHIP verification_status for professional roles
-- ============================================================================

UPDATE organization_memberships SET verification_status = 'approved'
WHERE role_id IN ('doctor', 'driver', 'pharmacy', 'emergency')
  AND verification_status IS NULL;

COMMIT;
