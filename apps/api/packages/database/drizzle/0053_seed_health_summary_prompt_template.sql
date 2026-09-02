-- AI-5: Seed the prompt template for health_summary artifacts.
--
-- This runs in a separate transaction from 0052 (which adds the enum value)
-- because PostgreSQL forbids using an enum label in the same transaction
-- that added it (55P04: unsafe use of new value).
--
-- The template body is the guardrail text the repository stores alongside
-- the model output; the runtime system prompt (built in OpenAiLlmProvider)
-- adds the vitals-focused instructions and the serialized health context.
INSERT INTO prompt_templates (template_key, version, artifact_type, body, body_sha256)
SELECT
  seed.template_key,
  1,
  seed.artifact_type,
  seed.body,
  encode(sha256(seed.body::bytea), 'hex')
FROM (VALUES
  (
    'health_summary_v1',
    'health_summary'::ai_artifact_type,
    'Summarise the patient''s recent vital readings from the SmartCura platform. Cite each reading with its source (ESP32 or Health Connect), timestamp, and quality. Compare current readings against the patient''s known conditions and medications where relevant. Do not diagnose. State clearly that this is general information derived from device data and not a clinical assessment.'
  )
) AS seed(template_key, artifact_type, body)
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_templates
  WHERE template_key = 'health_summary_v1' AND version = 1
);

-- Assert the feature is actually usable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM prompt_templates
    WHERE artifact_type = 'health_summary'::ai_artifact_type
      AND retired_at IS NULL
  ) THEN
    RAISE EXCEPTION 'no live prompt template for health_summary artifact type';
  END IF;
END $$;
