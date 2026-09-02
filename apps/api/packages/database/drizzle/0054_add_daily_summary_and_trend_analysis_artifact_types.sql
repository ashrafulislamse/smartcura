-- AI-6: Add daily_summary and trend_analysis artifact types for patient health
-- intelligence.
--
-- SPLIT MIGRATION: this file adds the enum values only. The prompt template
-- seeds in 0055 use the new values and MUST run in a separate transaction.
-- PostgreSQL forbids using an enum label in the same transaction that added
-- it (55P04: unsafe use of new value). The existing 0018/0019, 0021/0022,
-- and 0052/0053 pairs follow the same pattern for this reason.
ALTER TYPE "public"."ai_artifact_type" ADD VALUE IF NOT EXISTS 'daily_summary';
ALTER TYPE "public"."ai_artifact_type" ADD VALUE IF NOT EXISTS 'trend_analysis';
