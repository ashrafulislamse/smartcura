-- Update the 6 seeded profiles with real Firebase UIDs
-- This replaces the fake firebase_uid values with the real ones from Firebase Auth

BEGIN;

UPDATE profiles SET firebase_uid = 'XKgEopAPbebuaWdDNcvZIkkRHZ33' WHERE firebase_uid = 'seed_doc2_firebase_001';
UPDATE profiles SET firebase_uid = '4XELzIMzuPZflDHnEonQFy3JUkA3' WHERE firebase_uid = 'seed_doc3_firebase_001';
UPDATE profiles SET firebase_uid = '2O3onBPRtphPZC9hxKd0zxhIQYg1' WHERE firebase_uid = 'seed_pat2_firebase_001';
UPDATE profiles SET firebase_uid = '7cTuar3aBJe7ZevXKHxJgv7BpJs2' WHERE firebase_uid = 'seed_pat3_firebase_001';
UPDATE profiles SET firebase_uid = 'kmXwCuQM9QOaSBRqcUq75eD5qNq2' WHERE firebase_uid = 'seed_drv2_firebase_001';
UPDATE profiles SET firebase_uid = 'je5Gwa9VEdeKYCUwO1ZwhSKSSxv2' WHERE firebase_uid = 'seed_em2_firebase_001';

-- Verify: show all profiles with their firebase_uids
SELECT display_name, email, firebase_uid FROM profiles ORDER BY display_name;

COMMIT;
