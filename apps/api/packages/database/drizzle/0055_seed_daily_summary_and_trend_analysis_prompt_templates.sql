-- AI-6: Seed the prompt templates for daily_summary and trend_analysis artifacts.
--
-- This runs in a separate transaction from 0054 (which adds the enum values)
-- because PostgreSQL forbids using an enum label in the same transaction
-- that added it (55P04: unsafe use of new value).
--
-- The template body is the guardrail text the repository stores alongside
-- the model output; the runtime system prompt (built in OpenAiLlmProvider)
-- adds the artifact-type-specific instructions and the serialized health context.
INSERT INTO prompt_templates (template_key, version, artifact_type, body, body_sha256)
SELECT
  seed.template_key,
  1,
  seed.artifact_type,
  seed.body,
  encode(sha256(seed.body::bytea), 'hex')
FROM (VALUES
  (
    'daily_summary_v1',
    'daily_summary'::ai_artifact_type,
    'Provide a morning health summary for the patient based on their recent vital readings, conditions, and medications. Highlight any notable changes from the previous day. Suggest one proactive care action the patient could take. Do not diagnose. State clearly that this is general information derived from device data and not a clinical assessment.'
  ),
  (
    'trend_analysis_v1',
    'trend_analysis'::ai_artifact_type,
    'Analyse the patient''s vital readings over the past 7 days. Identify any sustained upward or downward trends in heart rate, oxygen saturation, or other available metrics. Compare current readings to the 7-day baseline. Note any correlations between metrics (e.g., sleep quality and heart rate). Do not diagnose. State clearly that this is general information derived from device data and not a clinical assessment.'
  )
) AS seed(template_key, artifact_type, body)
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_templates pt
  WHERE pt.template_key = seed.template_key AND pt.version = 1
);

-- Assert both templates are actually usable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM prompt_templates
    WHERE artifact_type = 'daily_summary'::ai_artifact_type
      AND retired_at IS NULL
  ) THEN
    RAISE EXCEPTION 'no live prompt template for daily_summary artifact type';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM prompt_templates
    WHERE artifact_type = 'trend_analysis'::ai_artifact_type
      AND retired_at IS NULL
  ) THEN
    RAISE EXCEPTION 'no live prompt template for trend_analysis artifact type';
  END IF;
END $$;
