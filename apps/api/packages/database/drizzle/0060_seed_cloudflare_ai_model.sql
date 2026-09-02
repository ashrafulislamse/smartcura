-- WP-13: seed the Cloudflare Workers AI model row.
--
-- The name field has a CHECK constraint: ^[a-z0-9][a-z0-9._-]{1,127}$
-- The actual Cloudflare model ID (@cf/moonshotai/kimi-k2.6) is passed
-- to the OpenAI-compatible API via SMARTCURA_AI_MODEL env var, not
-- stored in ai_models.name. This row just needs to exist so the
-- AiRepository.submitTurn query (WHERE provider = 'cloudflare') succeeds.
INSERT INTO ai_models (provider, name, version, provides_calibrated_confidence) VALUES
  ('cloudflare', 'cloudflare-moonshot-kimi-k2.6', '2025-08', false)
ON CONFLICT (provider, name, version) DO NOTHING;
