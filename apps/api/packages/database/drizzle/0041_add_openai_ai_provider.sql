-- WP-12: add the OpenAI-compatible provider enum value.
--
-- PostgreSQL requires an enum value to be committed before it can be used.
-- Data that references 'openai' lives in 0042, which the migration runner
-- applies in a separate transaction.
ALTER TYPE "ai_provider" ADD VALUE IF NOT EXISTS 'openai';
