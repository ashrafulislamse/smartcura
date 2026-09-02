-- WP-08 correction: no prompt template was ever seeded, so AI was unusable.
--
-- FOUND BY REAL EXECUTION. Migration `0023` seeds `ai_models` but no
-- `prompt_templates` row. `submitTurn` resolves the newest non-retired template for
-- the requested artifact type and returns `model_unavailable` when there is none,
-- so every AI turn on a fresh database answered `503 AI_MODEL_UNAVAILABLE`. The
-- feature could not work at all, and no local test caught it because the unit
-- suites exercise the provider and safety filter directly rather than the template
-- lookup.
--
-- The bodies are deliberately minimal and non-clinical. They instruct summarisation
-- and care navigation only, and they restate the prohibitions the safety filter
-- enforces, so a provider that ignores them is still blocked downstream rather than
-- trusted to behave.

INSERT INTO prompt_templates (template_key, version, artifact_type, body, body_sha256)
SELECT
  seed.template_key,
  1,
  seed.artifact_type,
  seed.body,
  encode(sha256(seed.body::bytea), 'hex')
FROM (VALUES
  (
    'symptom_summary_v1',
    'symptom_summary'::ai_artifact_type,
    'Summarise ONLY the symptoms the patient reported, in their own terms. Do not name, suggest or rule out any condition. Do not mention any medication, dose or treatment. Do not discourage seeking urgent care. State clearly that this is general information and not a diagnosis.'
  ),
  (
    'care_navigation_v1',
    'care_navigation'::ai_artifact_type,
    'Suggest ONLY which kind of care the patient might consider seeking and when. Do not name, suggest or rule out any condition. Do not mention any medication, dose or treatment. Never advise against contacting emergency services. State clearly that a doctor reviews this before it is clinical advice.'
  )
) AS seed(template_key, artifact_type, body)
ON CONFLICT (template_key, version) DO NOTHING;--> statement-breakpoint

-- Assert the feature is actually usable. Every artifact type a patient may request
-- must have a live template, or the route answers 503 as it did before this fix.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(required.artifact_type::text, ', ') INTO missing
  FROM (VALUES
    ('symptom_summary'::ai_artifact_type),
    ('care_navigation'::ai_artifact_type)
  ) AS required(artifact_type)
  WHERE NOT EXISTS (
    SELECT 1 FROM prompt_templates
    WHERE prompt_templates.artifact_type = required.artifact_type
      AND prompt_templates.retired_at IS NULL
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'no live prompt template for requestable artifact types: %', missing;
  END IF;
END $$;--> statement-breakpoint

INSERT INTO schema_compatibility (component, version) VALUES ('identity', 19)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
