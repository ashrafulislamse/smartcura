import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KeywordKnowledgeRetriever,
  extractKeywordsFromText,
  scoreChunk,
} from '../apps/worker/src/keyword-retriever.js';
import type { KnowledgeCitation } from '@smartcura/database/ai';

// ─── Mock database ───────────────────────────────────────────────────────────
//
// The mock captures every query so tests can assert on SQL structure and
// return different rows depending on which table is queried. The retriever
// makes four kinds of queries:
//   1. ai_messages JOIN ai_conversations (recent patient messages)
//   2. patient_conditions (active condition names)
//   3. prescription_items JOIN prescriptions (medication text)
//   4. knowledge_chunks JOIN knowledge_documents (published chunks for scoring)

interface MockConfig {
  /** Rows to return for the ai_messages query. */
  messages?: { content: string }[];
  /** Rows to return for the patient_conditions query. */
  conditions?: { keyword: string }[];
  /** Rows to return for the prescription_items query. */
  medications?: { keyword: string }[];
  /** Rows to return for the knowledge_chunks query. */
  chunks?: { chunkId: string; content: string; title: string; ordinal: number; publishedAt: string | null }[];
}

function createMockDatabase(config: MockConfig = {}) {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const messages = config.messages ?? [];
  const conditions = config.conditions ?? [];
  const medications = config.medications ?? [];
  const chunks = config.chunks ?? [];

  const mockDb = {
    query: <T extends { [key: string]: unknown } = { [key: string]: unknown }>(
      text: string,
      values: readonly unknown[] = [],
    ) => {
      queries.push({ text, values });

      // Route the response based on the table mentioned in the SQL.
      if (text.includes('ai_messages')) {
        return Promise.resolve({ rows: messages as T[], rowCount: messages.length, command: '', oid: 0, fields: [] });
      }
      if (text.includes('patient_conditions')) {
        return Promise.resolve({ rows: conditions as T[], rowCount: conditions.length, command: '', oid: 0, fields: [] });
      }
      if (text.includes('prescription_items')) {
        return Promise.resolve({ rows: medications as T[], rowCount: medications.length, command: '', oid: 0, fields: [] });
      }
      if (text.includes('knowledge_chunks')) {
        return Promise.resolve({ rows: chunks as T[], rowCount: chunks.length, command: '', oid: 0, fields: [] });
      }
      return Promise.resolve({ rows: [] as T[], rowCount: 0, command: '', oid: 0, fields: [] });
    },
  };
  return { mockDb, queries };
}

const TEST_PATIENT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// ─── Keyword extraction tests ────────────────────────────────────────────────

test('extractKeywordsFromText lowercases and tokenizes', () => {
  const keywords = extractKeywordsFromText('Heart Rate and Blood Pressure');
  assert.ok(keywords.includes('heart'));
  assert.ok(keywords.includes('rate'));
  assert.ok(keywords.includes('blood'));
  assert.ok(keywords.includes('pressure'));
});

test('extractKeywordsFromText removes stop words', () => {
  const keywords = extractKeywordsFromText('I have been feeling dizzy and lightheaded');
  assert.ok(!keywords.includes('have'));
  assert.ok(!keywords.includes('been'));
  assert.ok(!keywords.includes('and'));
  assert.ok(keywords.includes('feeling'));
  assert.ok(keywords.includes('dizzy'));
  assert.ok(keywords.includes('lightheaded'));
});

test('extractKeywordsFromText removes tokens shorter than 3 characters', () => {
  const keywords = extractKeywordsFromText('BP is up at 2 AM');
  assert.ok(!keywords.includes('bp'));
  assert.ok(!keywords.includes('is'));
  assert.ok(!keywords.includes('up'));
  assert.ok(!keywords.includes('at'));
  // 'am' is only 2 chars so it's also filtered
  assert.ok(!keywords.includes('am'));
});

test('extractKeywordsFromText de-duplicates while preserving order', () => {
  const keywords = extractKeywordsFromText('dizzy dizzy dizzy headache headache');
  assert.equal(keywords.length, 2);
  assert.equal(keywords[0], 'dizzy');
  assert.equal(keywords[1], 'headache');
});

test('extractKeywordsFromText handles empty string', () => {
  assert.equal(extractKeywordsFromText('').length, 0);
  assert.equal(extractKeywordsFromText('   ').length, 0);
});

// ─── Scoring tests ───────────────────────────────────────────────────────────

test('scoreChunk counts each matching keyword once', () => {
  const content = 'hypertension is a common condition managed with amlodipine';
  const title = 'Blood pressure management';
  const keywords = ['hypertension', 'amlodipine', 'diabetes'];
  // 'hypertension' matches, 'amlodipine' matches, 'diabetes' does not → score 2
  assert.equal(scoreChunk(content, title, keywords), 2);
});

test('scoreChunk matches in title as well as content', () => {
  const content = 'general information about health';
  const title = 'Hypertension guidelines';
  const keywords = ['hypertension'];
  assert.equal(scoreChunk(content, title, keywords), 1);
});

test('scoreChunk is case-insensitive', () => {
  const content = 'HYPERTENSION is a condition';
  const title = 'Blood Pressure';
  const keywords = ['hypertension', 'pressure'];
  assert.equal(scoreChunk(content, title, keywords), 2);
});

test('scoreChunk returns 0 when no keywords match', () => {
  const content = 'general health information';
  const title = 'Wellness tips';
  const keywords = ['hypertension', 'diabetes'];
  assert.equal(scoreChunk(content, title, keywords), 0);
});

test('scoreChunk returns 0 for empty keywords', () => {
  assert.equal(scoreChunk('some content', 'some title', []), 0);
});

// ─── Retriever integration tests ─────────────────────────────────────────────

test('KeywordKnowledgeRetriever returns chunks ranked by keyword relevance', async () => {
  const { mockDb } = createMockDatabase({
    messages: [
      { content: 'I have been feeling dizzy and my blood pressure is high' },
    ],
    conditions: [{ keyword: 'hypertension' }],
    medications: [{ keyword: 'amlodipine' }],
    chunks: [
      {
        chunkId: 'chunk-hypertension',
        content: 'Hypertension management guidelines include amlodipine as a first-line treatment',
        title: 'Blood pressure management',
        ordinal: 1,
        publishedAt: '2026-08-01T00:00:00Z',
      },
      {
        chunkId: 'chunk-diabetes',
        content: 'Type 2 diabetes is managed with metformin and lifestyle changes',
        title: 'Diabetes overview',
        ordinal: 2,
        publishedAt: '2026-08-01T00:00:00Z',
      },
      {
        chunkId: 'chunk-general',
        content: 'General wellness tips for healthy living',
        title: 'Wellness',
        ordinal: 3,
        publishedAt: '2026-08-01T00:00:00Z',
      },
    ],
  });

  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  const results = await retriever.retrieve(TEST_PATIENT);

  assert.ok(results.length > 0, 'must return at least one chunk');
  assert.equal(results[0]!.chunkId, 'chunk-hypertension', 'most relevant chunk must be first');
  assert.ok(results[0]!.similarity !== null, 'top match must have a non-null similarity');
  assert.equal(results[0]!.similarity, 1.0, 'top match similarity must be normalized to 1.0');
  assert.equal(results[0]!.rank, 1);
});

test('KeywordKnowledgeRetriever normalizes similarity scores', async () => {
  const { mockDb } = createMockDatabase({
    messages: [{ content: 'hypertension amlodipine dizzy' }],
    conditions: [],
    medications: [],
    chunks: [
      {
        chunkId: 'chunk-two-matches',
        content: 'hypertension amlodipine treatment',
        title: 'BP',
        ordinal: 1,
        publishedAt: '2026-08-01T00:00:00Z',
      },
      {
        chunkId: 'chunk-one-match',
        content: 'hypertension overview only',
        title: 'BP',
        ordinal: 2,
        publishedAt: '2026-08-01T00:00:00Z',
      },
    ],
  });

  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  const results = await retriever.retrieve(TEST_PATIENT);

  // 'hypertension', 'amlodipine', 'dizzy' are the keywords.
  // chunk-two-matches: matches 'hypertension' + 'amlodipine' → score 2
  // chunk-one-match: matches 'hypertension' → score 1
  assert.equal(results[0]!.chunkId, 'chunk-two-matches');
  assert.equal(results[0]!.similarity, 1.0);
  assert.equal(results[1]!.chunkId, 'chunk-one-match');
  assert.ok(results[1]!.similarity! < 1.0, 'second chunk similarity must be < 1.0');
  assert.ok(results[1]!.similarity! > 0, 'second chunk similarity must be > 0');
});

test('KeywordKnowledgeRetriever falls back to ordinal when no keywords match', async () => {
  const { mockDb } = createMockDatabase({
    messages: [{ content: 'I feel okay today' }],
    conditions: [],
    medications: [],
    chunks: [
      {
        chunkId: 'chunk-a',
        content: 'general health information',
        title: 'General',
        ordinal: 1,
        publishedAt: '2026-08-02T00:00:00Z',
      },
      {
        chunkId: 'chunk-b',
        content: 'wellness tips',
        title: 'Wellness',
        ordinal: 2,
        publishedAt: '2026-08-01T00:00:00Z',
      },
    ],
  });

  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  const results = await retriever.retrieve(TEST_PATIENT);

  // No keyword matches → ordinal ordering, similarity null.
  assert.equal(results.length, 2);
  assert.equal(results[0]!.chunkId, 'chunk-a', 'ordinal order: chunk-a first');
  assert.equal(results[0]!.similarity, null, 'no match → similarity null');
  assert.equal(results[1]!.chunkId, 'chunk-b');
  assert.equal(results[1]!.similarity, null);
});

test('KeywordKnowledgeRetriever falls back to ordinal when no keywords extracted', async () => {
  // Patient has no messages, conditions, or medications → empty keyword list.
  const { mockDb } = createMockDatabase({
    messages: [],
    conditions: [],
    medications: [],
    chunks: [
      {
        chunkId: 'chunk-1',
        content: 'some content',
        title: 'Some title',
        ordinal: 1,
        publishedAt: '2026-08-01T00:00:00Z',
      },
    ],
  });

  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  const results = await retriever.retrieve(TEST_PATIENT);

  assert.equal(results.length, 1);
  assert.equal(results[0]!.chunkId, 'chunk-1');
  assert.equal(results[0]!.similarity, null);
});

test('KeywordKnowledgeRetriever returns empty array when no chunks exist', async () => {
  const { mockDb } = createMockDatabase({
    messages: [{ content: 'hypertension' }],
    conditions: [],
    medications: [],
    chunks: [],
  });

  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  const results = await retriever.retrieve(TEST_PATIENT);

  assert.equal(results.length, 0);
});

// ─── Cross-patient isolation ─────────────────────────────────────────────────

test('KeywordKnowledgeRetriever uses patientProfileId for keyword extraction only', async () => {
  const { mockDb, queries } = createMockDatabase({
    messages: [{ content: 'hypertension' }],
    conditions: [{ keyword: 'hypertension' }],
    medications: [{ keyword: 'amlodipine' }],
    chunks: [
      {
        chunkId: 'chunk-1',
        content: 'hypertension amlodipine',
        title: 'BP',
        ordinal: 1,
        publishedAt: '2026-08-01T00:00:00Z',
      },
    ],
  });

  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  await retriever.retrieve(TEST_PATIENT);

  // The keyword extraction queries (messages, conditions, medications) must
  // all scope by patientProfileId ($1).
  const messageQuery = queries.find((q) => q.text.includes('ai_messages'));
  assert.ok(messageQuery, 'must have a messages query');
  assert.ok(
    messageQuery!.text.includes('patient_profile_id = $1'),
    'messages query must scope by patient_profile_id = $1',
  );
  assert.equal(messageQuery!.values[0], TEST_PATIENT, 'messages query $1 must be the patient id');

  const conditionQuery = queries.find((q) => q.text.includes('patient_conditions'));
  assert.ok(conditionQuery, 'must have a conditions query');
  assert.ok(
    conditionQuery!.text.includes('profile_id = $1'),
    'conditions query must scope by profile_id = $1',
  );
  assert.equal(conditionQuery!.values[0], TEST_PATIENT, 'conditions query $1 must be the patient id');

  const medicationQuery = queries.find((q) => q.text.includes('prescription_items'));
  assert.ok(medicationQuery, 'must have a medications query');
  assert.ok(
    medicationQuery!.text.includes('patient_profile_id = $1'),
    'medications query must scope by patient_profile_id = $1',
  );
  assert.equal(medicationQuery!.values[0], TEST_PATIENT, 'medications query $1 must be the patient id');

  // The chunk query must NOT be scoped by patientProfileId — knowledge is
  // global published content.
  const chunkQuery = queries.find((q) => q.text.includes('knowledge_chunks'));
  assert.ok(chunkQuery, 'must have a chunk query');
  assert.ok(
    !chunkQuery!.text.includes('$1') || chunkQuery!.values[0] !== TEST_PATIENT,
    'chunk query must not use the patient id as a scope parameter',
  );
  assert.ok(
    chunkQuery!.text.includes("status = 'published'"),
    'chunk query must filter to published documents only',
  );
});

test('KeywordKnowledgeRetriever never queries for a different patientProfileId', async () => {
  const seenProfileIds: string[] = [];
  const mockDb = {
    query: (text: string, values: readonly unknown[] = []) => {
      // Capture the first parameter ($1) from keyword-extraction queries.
      if (typeof values[0] === 'string' && (
        text.includes('ai_messages') ||
        text.includes('patient_conditions') ||
        text.includes('prescription_items')
      )) {
        seenProfileIds.push(values[0]);
      }
      if (text.includes('ai_messages')) {
        return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      }
      if (text.includes('patient_conditions')) {
        return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      }
      if (text.includes('prescription_items')) {
        return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      }
      if (text.includes('knowledge_chunks')) {
        return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      }
      return Promise.resolve({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
    },
  };

  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  const patientA = 'aaaaaaaa-1111-2222-3333-444444444444';
  const patientB = 'bbbbbbbb-1111-2222-3333-444444444444';

  await retriever.retrieve(patientA);

  assert.ok(seenProfileIds.length >= 1, 'must execute at least one keyword-extraction query');
  for (const id of seenProfileIds) {
    assert.equal(id, patientA, `retriever queried with ${id}, expected only patientA`);
    assert.notEqual(id, patientB, 'retriever must never query for patientB');
  }
});

// ─── Query structure tests ───────────────────────────────────────────────────

test('KeywordKnowledgeRetriever messages query filters to patient role', async () => {
  const { mockDb, queries } = createMockDatabase();
  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  await retriever.retrieve(TEST_PATIENT);

  const messageQuery = queries.find((q) => q.text.includes('ai_messages'));
  assert.ok(messageQuery, 'must have a messages query');
  assert.ok(
    messageQuery!.text.includes("role = 'patient'"),
    "messages query must filter role = 'patient'",
  );
});

test('KeywordKnowledgeRetriever conditions query filters soft-deleted and active', async () => {
  const { mockDb, queries } = createMockDatabase();
  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  await retriever.retrieve(TEST_PATIENT);

  const conditionQuery = queries.find((q) => q.text.includes('patient_conditions'));
  assert.ok(conditionQuery, 'must have a conditions query');
  assert.ok(
    conditionQuery!.text.includes('deleted_at IS NULL'),
    'conditions query must filter deleted_at IS NULL',
  );
  assert.ok(
    conditionQuery!.text.includes("status = 'active'"),
    "conditions query must filter status = 'active'",
  );
});

test('KeywordKnowledgeRetriever medications query filters to signed prescriptions', async () => {
  const { mockDb, queries } = createMockDatabase();
  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  await retriever.retrieve(TEST_PATIENT);

  const medicationQuery = queries.find((q) => q.text.includes('prescription_items'));
  assert.ok(medicationQuery, 'must have a medications query');
  assert.ok(
    medicationQuery!.text.includes("status = 'signed'"),
    "medications query must filter prescriptions status = 'signed'",
  );
});

test('KeywordKnowledgeRetriever chunk query joins knowledge_documents', async () => {
  const { mockDb, queries } = createMockDatabase();
  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 5);
  await retriever.retrieve(TEST_PATIENT);

  const chunkQuery = queries.find((q) => q.text.includes('knowledge_chunks'));
  assert.ok(chunkQuery, 'must have a chunk query');
  assert.ok(
    chunkQuery!.text.includes('JOIN knowledge_documents'),
    'chunk query must join knowledge_documents',
  );
  assert.ok(
    chunkQuery!.text.includes('content'),
    'chunk query must select chunk content for scoring',
  );
  assert.ok(
    chunkQuery!.text.includes('title'),
    'chunk query must select document title for scoring',
  );
});

test('KeywordKnowledgeRetriever respects the limit parameter', async () => {
  const manyChunks = Array.from({ length: 30 }, (_, i) => ({
    chunkId: `chunk-${i}`,
    content: 'general health information',
    title: 'General',
    ordinal: i + 1,
    publishedAt: '2026-08-01T00:00:00Z',
  }));

  const { mockDb } = createMockDatabase({
    chunks: manyChunks,
  });

  const retriever = new KeywordKnowledgeRetriever(mockDb as never, 3);
  const results = await retriever.retrieve(TEST_PATIENT);

  assert.equal(results.length, 3, 'must respect the limit of 3');
  assert.equal(results[0]!.rank, 1);
  assert.equal(results[1]!.rank, 2);
  assert.equal(results[2]!.rank, 3);
});
