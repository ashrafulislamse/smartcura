-- WP-12: seed OpenAI provider data after the enum transaction committed.
INSERT INTO ai_models (provider, name, version, provides_calibrated_confidence) VALUES
  ('openai', 'gpt-4o-mini', '2024-07-18', false)
ON CONFLICT (provider, name, version) DO NOTHING;

INSERT INTO schema_compatibility (component, version) VALUES ('ai', 2)
ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
