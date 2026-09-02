-- Add activity/wellness metrics so Health Connect can sync steps, distance,
-- energy expenditure, and sleep duration alongside clinical vitals. The unit
-- and bound CHECK constraints are applied in a separate migration because
-- PostgreSQL forbids using a newly-added enum label in the same transaction.

ALTER TYPE "public"."vital_metric" ADD VALUE 'steps';
ALTER TYPE "public"."vital_metric" ADD VALUE 'distance';
ALTER TYPE "public"."vital_metric" ADD VALUE 'active_energy';
ALTER TYPE "public"."vital_metric" ADD VALUE 'basal_energy';
ALTER TYPE "public"."vital_metric" ADD VALUE 'sleep_duration';
