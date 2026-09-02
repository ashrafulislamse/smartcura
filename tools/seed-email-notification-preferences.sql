-- Seed notification_preferences for all profiles that don't already have them.
--
-- Ensures every profile has `channel='email', enabled=true` and
-- `channel='push', enabled=true` rows for every notification category, so the
-- notification pipeline can enqueue email and push deliveries for any
-- notification it creates. The INSERT ... SELECT ... WHERE NOT EXISTS makes
-- the script idempotent: re-running it only fills gaps, never duplicates.
--
-- Run on the live VPS:
--   docker compose exec -T postgres psql -U smartcura_dev -d smartcura_dev \
--     -v ON_ERROR_STOP=1 -f tools/seed-email-notification-preferences.sql

-- Section 1: email preferences for every profile × category that lacks one.

INSERT INTO notification_preferences (profile_id, category, channel, enabled, timezone, updated_at)
SELECT
  p.profile_id,
  cat.category,
  'email'::notification_channel,
  true,
  'Asia/Kuala_Lumpur',
  now()
FROM profiles p
CROSS JOIN (VALUES
  ('account_security'::notification_category),
  ('appointments'::notification_category),
  ('consultations'::notification_category),
  ('messages'::notification_category),
  ('prescriptions'::notification_category),
  ('vitals_alerts'::notification_category),
  ('ai_review'::notification_category),
  ('delivery'::notification_category),
  ('emergency'::notification_category),
  ('system'::notification_category)
) AS cat(category)
WHERE NOT EXISTS (
  SELECT 1
  FROM notification_preferences np
  WHERE np.profile_id = p.profile_id
    AND np.category = cat.category
    AND np.channel = 'email'::notification_channel
);

-- Section 2: push preferences for every profile × category that lacks one.

INSERT INTO notification_preferences (profile_id, category, channel, enabled, timezone, updated_at)
SELECT
  p.profile_id,
  cat.category,
  'push'::notification_channel,
  true,
  'Asia/Kuala_Lumpur',
  now()
FROM profiles p
CROSS JOIN (VALUES
  ('account_security'::notification_category),
  ('appointments'::notification_category),
  ('consultations'::notification_category),
  ('messages'::notification_category),
  ('prescriptions'::notification_category),
  ('vitals_alerts'::notification_category),
  ('ai_review'::notification_category),
  ('delivery'::notification_category),
  ('emergency'::notification_category),
  ('system'::notification_category)
) AS cat(category)
WHERE NOT EXISTS (
  SELECT 1
  FROM notification_preferences np
  WHERE np.profile_id = p.profile_id
    AND np.category = cat.category
    AND np.channel = 'push'::notification_channel
);
