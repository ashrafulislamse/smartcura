-- Link the 6 new users' memberships to the site
-- Without this, they have no :site authority and will get 403 on site-scoped routes

BEGIN;

INSERT INTO membership_sites (membership_id, site_id, organization_id)
SELECT m.membership_id, '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11', '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10'
FROM organization_memberships m
JOIN profiles p ON m.profile_id = p.profile_id
WHERE p.firebase_uid IN (
  'XKgEopAPbebuaWdDNcvZIkkRHZ33',  -- imran.hafiz (doctor)
  '4XELzIMzuPZflDHnEonQFy3JUkA3',  -- priya.krishnan (doctor)
  '2O3onBPRtphPZC9hxKd0zxhIQYg1',  -- farah.natasya (patient)
  '7cTuar3aBJe7ZevXKHxJgv7BpJs2',  -- fahim.ahmed (patient)
  'kmXwCuQM9QOaSBRqcUq75eD5qNq2',  -- lee.cheekeong (driver)
  'je5Gwa9VEdeKYCUwO1ZwhSKSSxv2'   -- nurul.huda (emergency)
)
AND NOT EXISTS (
  SELECT 1 FROM membership_sites ms WHERE ms.membership_id = m.membership_id
);

-- Verify all 13 users now have site links
SELECT p.display_name, p.email, m.role_id, ms.site_id
FROM profiles p
JOIN organization_memberships m ON p.profile_id = m.profile_id
LEFT JOIN membership_sites ms ON m.membership_id = ms.membership_id
ORDER BY p.display_name;

COMMIT;
