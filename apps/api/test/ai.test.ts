import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AI_ARTIFACT_CHANGED_EVENT_TYPE,
  AI_GENERATION_REQUESTED_EVENT_TYPE,
  MockLlmProvider,
  aiReviewTransitionAllowed,
  evaluateSafety,
  safetyBlocks,
  type LlmGenerationRequest,
} from '@smartcura/database/ai';
import {
  reviewAiArtifactSchema,
  submitAiTurnSchema,
} from '../apps/api/src/ai/ai-request.schemas.js';
import { OutboxProcessor } from '../apps/worker/src/outbox.processor.js';

const generationId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d60';
const artifactId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d61';
const patientId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d62';
const chunkId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d63';

const request: LlmGenerationRequest = {
  artifactType: 'symptom_summary',
  turns: [{ role: 'patient', content: 'I have had a headache and mild fever for two days.' }],
  citations: [{ chunkId, rank: 1, similarity: null }],
  promptTemplateKey: 'symptom_summary_v1',
  promptTemplateVersion: 1,
};

test('mock provider is deterministic, labels output non-diagnostic and reports no confidence', async () => {
  const provider = new MockLlmProvider();
  assert.equal(provider.provider, 'mock');
  const left = await provider.generate(request);
  const right = await provider.generate(request);
  // Reproducibility is the property governance depends on: a reviewer must be able
  // to re-derive exactly what they approved.
  assert.deepEqual(left, right);
  assert.equal(left.content['non_diagnostic'], true);
  assert.equal('confidence' in left.content, false);
  assert.deepEqual(left.content['sources'], [{ chunk_id: chunkId, rank: 1 }]);
  assert.deepEqual(left.content['prompt_template'], {
    key: 'symptom_summary_v1', version: 1,
  });
  assert.ok(left.promptTokens > 0 && left.completionTokens > 0);
  // Risk is advisory input for a human, never an automated verdict.
  assert.equal(left.riskLevel, 'low');
  const empty = await provider.generate({ ...request, turns: [] });
  assert.equal(empty.riskLevel, 'unknown');
});

test('mock output never diagnoses, prescribes or suppresses emergency care', async () => {
  const result = await new MockLlmProvider().generate(request);
  const text = JSON.stringify(result.content).toLowerCase();
  for (const forbidden of ['you have', 'diagnosis is', 'prescribe', 'mg ', 'do not call']) {
    assert.equal(text.includes(forbidden), false, `mock output must not contain "${forbidden}"`);
  }
  // Its own output must pass the safety filter it will be graded by.
  assert.deepEqual(evaluateSafety(result.content).filter((finding) => finding.blocked), []);
  assert.equal(safetyBlocks(evaluateSafety(result.content)), false);
});

test('safety filter blocks prohibited clinical actions and unlabelled output', () => {
  const blocked = [
    { non_diagnostic: true, text: 'You have pneumonia and should rest.' },
    { non_diagnostic: true, text: 'The diagnosis is influenza.' },
    { non_diagnostic: true, text: 'Take 500 mg of paracetamol every four hours.' },
    { non_diagnostic: true, text: 'I will prescribe an antibiotic for this.' },
    { non_diagnostic: true, text: 'Please double your dose tonight.' },
    { non_diagnostic: true, text: 'There is no need to call an ambulance.' },
    { non_diagnostic: true, text: 'You can ignore your symptoms for now.' },
  ];
  for (const content of blocked) {
    const findings = evaluateSafety(content);
    assert.equal(safetyBlocks(findings), true, `must block: ${content.text}`);
    // Blocking is always critical, matching ai_safety_events_block_check, so the
    // filter and the database cannot disagree about severity.
    assert.ok(findings.filter((finding) => finding.blocked)
      .every((finding) => finding.severity === 'critical'));
  }
  // A missing non-diagnostic label is itself a blocking failure.
  const unlabelled = evaluateSafety({ text: 'General wellbeing information.' });
  assert.equal(safetyBlocks(unlabelled), true);
  assert.ok(unlabelled.some((finding) => finding.categoryCode === 'missing_non_diagnostic_label'));
  // No citations is unreviewable but not unsafe, so it warns without blocking.
  const unsourced = evaluateSafety({ non_diagnostic: true, sources: [] });
  assert.equal(safetyBlocks(unsourced), false);
  assert.ok(unsourced.some((finding) => finding.categoryCode === 'no_retrieval_support'));
});

test('review transitions are doctor verdicts and approved artifacts are only superseded', () => {
  assert.equal(aiReviewTransitionAllowed('pending_review', 'approved'), true);
  assert.equal(aiReviewTransitionAllowed('pending_review', 'rejected'), true);
  // A generation produces pending_review, so it can never be a review outcome.
  assert.equal(aiReviewTransitionAllowed('pending_review', 'superseded'), false);
  assert.equal(aiReviewTransitionAllowed('approved', 'superseded'), true);
  assert.equal(aiReviewTransitionAllowed('approved', 'rejected'), false);
  assert.equal(aiReviewTransitionAllowed('rejected', 'approved'), false);
  assert.equal(aiReviewTransitionAllowed('superseded', 'approved'), false);
});

test('AI requests reject client-supplied provenance, review state and confidence', () => {
  assert.equal(submitAiTurnSchema.safeParse({
    content: 'Headache for two days.', artifact_type: 'symptom_summary',
    client_correlation_id: chunkId,
  }).success, true);
  for (const forged of [
    { role: 'assistant' }, { model_id: artifactId }, { confidence: 0.99 },
    { risk_level: 'critical' }, { review_status: 'approved' }, { patient_profile_id: patientId },
  ]) {
    assert.equal(submitAiTurnSchema.safeParse({
      content: 'Headache.', artifact_type: 'symptom_summary',
      client_correlation_id: chunkId, ...forged,
    }).success, false, `must reject ${JSON.stringify(forged)}`);
  }
  // A reviewer may only approve or reject; superseding is a consequence of
  // approving a replacement, not a directly requestable verdict.
  assert.equal(reviewAiArtifactSchema.safeParse({
    decision: 'superseded', rationale_code: 'x_reason', expected_version: 0,
  }).success, false);
  assert.equal(reviewAiArtifactSchema.safeParse({
    decision: 'approved', rationale_code: 'Looks fine to me', expected_version: 0,
  }).success, false);
  assert.equal(reviewAiArtifactSchema.safeParse({
    decision: 'approved', rationale_code: 'clinically_reasonable', expected_version: 0,
  }).success, true);
});

test('worker accepts exact minimum-data AI events and rejects content disclosure', async () => {
  const handled: string[] = [];
  const processor = new OutboxProcessor(undefined, undefined, undefined, undefined, undefined, {
    handle: async (id: string) => { handled.push(id); return true; },
  } as never);
  const event = (eventType: string, payload: Record<string, unknown>) => ({
    eventId: generationId, eventType, eventVersion: 1, attempts: 1, payload,
  });
  assert.equal(await processor.process(
    event(AI_GENERATION_REQUESTED_EVENT_TYPE, { generation_id: generationId }) as never,
  ), true);
  assert.deepEqual(handled, [generationId]);
  assert.equal(await processor.process(event(AI_ARTIFACT_CHANGED_EVENT_TYPE, {
    artifact_id: artifactId, patient_profile_id: patientId, artifact_type: 'symptom_summary',
    previous_review_status: 'pending_review', review_status: 'approved',
  }) as never), true);
  // Artifact content must never travel on the event bus.
  assert.equal(await processor.process(event(AI_ARTIFACT_CHANGED_EVENT_TYPE, {
    artifact_id: artifactId, patient_profile_id: patientId, artifact_type: 'symptom_summary',
    previous_review_status: 'pending_review', review_status: 'approved',
    content: { non_diagnostic: true },
  }) as never), false);
});

test('migration enforces artifact immutability, calibrated confidence and no clinical write path', () => {
  const migration = readFileSync(new URL(
    '../packages/database/drizzle/0023_governed_ai_clinical_support.sql', import.meta.url,
  ), 'utf8');
  assert.match(migration, /ai_artifacts_protect_content/);
  assert.match(migration, /ai_review_events_reject_mutation/);
  assert.match(migration, /ai_messages_reject_mutation/);
  assert.match(migration, /ai_artifact_sources_reject_mutation/);
  assert.match(migration, /smartcura_enforce_ai_confidence/);
  assert.match(migration, /ai_generations_block_evidence/);
  assert.match(migration, /ai_artifacts_disclaimer_check/);
  assert.match(migration, /AI review authority must remain doctor-only/);
  assert.match(migration, /administrators must not inherit AI clinical content access/);
  // The 0023 predicate had a three-valued-logic hole: `content -> 'key'` is NULL
  // when the key is absent, and a CHECK PASSES on NULL, so unlabelled artifacts
  // were accepted. Real execution against PostgreSQL found it. 0026 replaces it
  // with `@>` containment, which returns a proper false for a missing key.
  const correction = readFileSync(new URL(
    '../packages/database/drizzle/0026_fix_ai_disclaimer_check.sql', import.meta.url,
  ), 'utf8');
  assert.match(correction, /@> '\{"non_diagnostic": true\}'::jsonb/);
  assert.match(correction, /DROP CONSTRAINT IF EXISTS "ai_artifacts_disclaimer_check"/);
  assert.match(correction, /jsonb CHECK constraints with a NULL hole remain/);
  assert.match(correction, /'identity', 18/);
  // The structural guarantee: nothing in the AI schema references a clinical
  // aggregate it could write, so a prohibited action has no column to use.
  for (const forbidden of [
    /REFERENCES "prescriptions"/, /REFERENCES "health_alerts"/,
    /REFERENCES "appointments"/, /REFERENCES "clinical_notes"/,
  ]) {
    assert.doesNotMatch(migration, forbidden);
  }
  // The mandatory offline provider is seeded, and neither LLM claims calibration.
  assert.match(migration, /'mock', 'mock-clinical-support'/);
  assert.match(migration, /'identity', 15/);
});

test('AI contracts publish no artifact content and require the non-diagnostic label', () => {
  const openapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url,
  ), 'utf8'));
  const asyncapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/asyncapi/asyncapi.json', import.meta.url,
  ), 'utf8'));
  assert.equal(openapi.components.schemas.AiArtifactContent.properties.non_diagnostic.const, true);
  assert.ok(openapi.components.schemas.AiArtifactContent.required.includes('non_diagnostic'));
  assert.equal(openapi.paths['/ai/artifacts/{artifact_id}/review'].put.operationId, 'reviewAiArtifact');
  assert.equal(openapi.paths['/ai/conversations/{conversation_id}/turns'].post.operationId, 'submitAiTurn');
  // A queued generation, not synchronous model output.
  assert.ok('202' in openapi.paths['/ai/conversations/{conversation_id}/turns'].post.responses);
  const changed = asyncapi.components.schemas.AiArtifactChangedData;
  assert.equal(changed.additionalProperties, false);
  for (const leak of ['content', 'summary', 'confidence', 'risk_level']) {
    assert.equal(leak in changed.properties, false, `event must not carry ${leak}`);
  }
});
