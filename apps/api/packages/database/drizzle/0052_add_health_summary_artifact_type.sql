-- AI-5: Add health_summary artifact type for vitals-focused AI responses.
--
-- SPLIT MIGRATION: this file adds the enum value only. The prompt template
-- seed in 0053 uses the new value and MUST run in a separate transaction.
-- PostgreSQL forbids using an enum label in the same transaction that added
-- it (55P04: unsafe use of new value). The existing 0018/0019 and 0021/0022
-- pairs follow the same pattern for this reason.
ALTER TYPE "public"."ai_artifact_type" ADD VALUE IF NOT EXISTS 'health_summary';
