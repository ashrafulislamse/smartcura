-- WP-13: add Cloudflare Workers AI provider enum value.
--
-- PostgreSQL requires an enum value to be committed before it can be used.
-- The ai_models row for cloudflare lives in 0060, which the migration runner
-- applies in a separate transaction.
ALTER TYPE "ai_provider" ADD VALUE IF NOT EXISTS 'cloudflare';
