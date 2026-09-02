/**
 * KeywordKnowledgeRetriever — keyword-based relevance retrieval over
 * PUBLISHED knowledge chunks.
 *
 * Phase AI-9.4 of the SmartCura AI Master Plan. The existing
 * `PublishedKnowledgeRetriever` returns chunks in document/chunk ordinal
 * order with `similarity: null`. This retriever improves on that by:
 *
 *   1. Extracting keywords from the patient's recent conversation turns
 *      (last 3 patient messages), active conditions, and current medication
 *      names.
 *   2. Scoring each published knowledge chunk by counting keyword matches in
 *      the chunk `content` and document `title`.
 *   3. Returning chunks sorted by relevance score (descending), with
 *      `similarity` set to a normalized score in [0, 1].
 *   4. Falling back to ordinal ordering (published_at DESC, ordinal ASC) when
 *      no keywords match any chunk.
 *
 * Authorization model:
 *   The `patientProfileId` is used ONLY for keyword extraction (recent
 *   messages, conditions, medications). The chunk query itself is not scoped
 *   to a patient — knowledge documents are global published content, not
 *   patient-specific records. This is the same isolation boundary as the
 *   ordinal retriever: the patient identity influences *what to search for*,
 *   not *what may be searched*.
 *
 * Schema notes:
 *   - `knowledge_chunks.content` (text, 1–8000 chars) holds the chunk text.
 *   - `knowledge_documents.title` (varchar 320) holds the document title.
 *   - `knowledge_documents.status` must be `'published'` (with `published_at`
 *     NOT NULL, enforced by a CHECK constraint).
 *   - `ai_messages.role = 'patient'` identifies patient-authored turns.
 *   - `ai_messages` joins to `ai_conversations` on `conversation_id`, and
 *     `ai_conversations.patient_profile_id` scopes to the patient.
 *   - `patient_conditions` has `deleted_at` (soft-delete) and `status`; only
 *     `status = 'active'` and `deleted_at IS NULL` rows are current.
 *   - `prescription_items.medication_text` holds the medication name; active
 *     prescriptions have `prescriptions.status = 'signed'`.
 */

import type { PostgresConnection } from '@smartcura/database';
import type { QueryResultRow } from 'pg';
import type { KnowledgeCitation } from '@smartcura/database/ai';
import type { KnowledgeRetriever } from './ai-generation.handler.js';

// ─── Query row types ─────────────────────────────────────────────────────────

interface MessageRow extends QueryResultRow {
  readonly content: string;
}

interface KeywordRow extends QueryResultRow {
  readonly keyword: string;
}

interface ChunkRow extends QueryResultRow {
  readonly chunkId: string;
  readonly content: string;
  readonly title: string;
  readonly ordinal: number;
  readonly publishedAt: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Number of recent patient messages to extract keywords from. */
const RECENT_MESSAGE_COUNT = 3;

/** Minimum keyword length — shorter tokens are too common to be discriminative. */
const MIN_KEYWORD_LENGTH = 3;

/** English stop words that carry no clinical signal. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
  'how', 'its', 'may', 'now', 'old', 'see', 'two', 'way', 'who', 'boy',
  'did', 'let', 'put', 'say', 'she', 'too', 'use', 'very', 'also', 'just',
  'like', 'have', 'this', 'that', 'with', 'from', 'they', 'will', 'what',
  'about', 'been', 'more', 'some', 'them', 'than', 'then', 'when', 'where',
  'would', 'could', 'should', 'into', 'your', 'were', 'does', 'here',
  'there', 'their', 'which', 'while', 'these', 'those', 'such', 'any',
  'because', 'between', 'through', 'during', 'before', 'after', 'above',
  'below', 'over', 'under', 'again', 'once', 'very', 'much', 'many',
  'feel', 'been', 'have', 'having', 'want', 'need', 'know',
  'think', 'tell', 'said', 'make', 'made', 'come', 'came', 'give', 'gave',
  'take', 'took', 'keep', 'kept', 'let', 'going', 'still', 'ever', 'since',
  'being', 'both', 'either', 'neither', 'other', 'another', 'same',
  'different', 'new', 'old', 'good', 'bad', 'better', 'best', 'most',
  'least', 'last', 'first', 'next', 'only', 'own', 'my', 'me', 'we', 'us',
  'am', 'is', 'it', 'at', 'on', 'in', 'of', 'to', 'so', 'if', 'or', 'as',
  'be', 'do', 'go', 'he', 'we', 'no', 'up', 'by', 'an',
]);

// ─── Retriever ───────────────────────────────────────────────────────────────

/**
 * Keyword-based knowledge retriever. Extracts keywords from the patient's
 * recent conversation history and clinical profile, then scores published
 * knowledge chunks by keyword match count.
 *
 * Use this retriever when keyword relevance is preferred over deterministic
 * ordinal ordering. Use `PublishedKnowledgeRetriever` as a deterministic
 * fallback (e.g. in tests or when no patient context is available).
 */
export class KeywordKnowledgeRetriever implements KnowledgeRetriever {
  constructor(
    private readonly database: PostgresConnection,
    private readonly limit = 5,
  ) {}

  async retrieve(patientProfileId: string): Promise<readonly KnowledgeCitation[]> {
    const keywords = await this.extractKeywords(patientProfileId);

    // Fetch published chunks with their text for scoring. We fetch a larger
    // pool than the limit so the keyword ranking has room to work; chunks with
    // zero matches are still eligible for the ordinal fallback.
    const poolSize = Math.max(this.limit * 4, 20);
    const chunks = await this.fetchChunks(poolSize);

    if (chunks.length === 0) return [];

    if (keywords.length === 0) {
      // No keywords extracted — fall back to ordinal ordering.
      return chunks.slice(0, this.limit).map((row, index) => ({
        chunkId: row.chunkId,
        rank: index + 1,
        similarity: null,
      }));
    }

    // Score each chunk by counting keyword matches in content + title.
    const scored = chunks.map((row) => ({
      chunkId: row.chunkId,
      score: scoreChunk(row.content, row.title, keywords),
    }));

    // Separate matched from unmatched.
    const matched = scored.filter((s) => s.score > 0);
    const unmatched = scored.filter((s) => s.score === 0);

    let ranked: { chunkId: string; score: number }[];

    if (matched.length > 0) {
      // Sort matched by score descending, then fill with ordinal fallback.
      matched.sort((a, b) => b.score - a.score);
      ranked = matched;
      if (ranked.length < this.limit) {
        // Fill remaining slots with unmatched chunks in ordinal order.
        ranked = ranked.concat(unmatched);
      }
    } else {
      // No keyword matched any chunk — fall back to ordinal.
      ranked = unmatched;
    }

    ranked = ranked.slice(0, this.limit);

    // Normalize scores to [0, 1]. The highest score maps to 1.0; chunks with
    // no matches get similarity: null (same contract as the ordinal retriever).
    const maxScore = ranked.length > 0 ? Math.max(...ranked.map((r) => r.score)) : 0;

    return ranked.map((row, index) => ({
      chunkId: row.chunkId,
      rank: index + 1,
      similarity: row.score > 0 && maxScore > 0
        ? Math.round((row.score / maxScore) * 100) / 100
        : null,
    }));
  }

  /**
   * Extracts keywords from the patient's recent messages, active conditions,
   * and current medication names.
   *
   * Keywords are lowercased, filtered to remove stop words and tokens shorter
   * than `MIN_KEYWORD_LENGTH`, and de-duplicated.
   */
  private async extractKeywords(patientProfileId: string): Promise<readonly string[]> {
    const [messages, conditions, medications] = await Promise.all([
      this.fetchRecentMessages(patientProfileId),
      this.fetchActiveConditions(patientProfileId),
      this.fetchActiveMedications(patientProfileId),
    ]);

    const rawText = [...messages, ...conditions, ...medications].join(' ');
    return extractKeywordsFromText(rawText);
  }

  /**
   * Fetches the last `RECENT_MESSAGE_COUNT` patient messages, most-recent first.
   * Joins `ai_messages` to `ai_conversations` to scope by `patient_profile_id`.
   */
  private async fetchRecentMessages(patientProfileId: string): Promise<readonly string[]> {
    const result = await this.database.query<MessageRow>(
      `SELECT msg.content
       FROM ai_messages msg
       JOIN ai_conversations conv ON conv.conversation_id = msg.conversation_id
       WHERE conv.patient_profile_id = $1
         AND msg.role = 'patient'
       ORDER BY msg.created_at DESC
       LIMIT $2`,
      [patientProfileId, RECENT_MESSAGE_COUNT],
    );
    return result.rows.map((row) => row.content);
  }

  /**
   * Fetches the names of the patient's active conditions.
   * Filters soft-deleted rows (`deleted_at IS NULL`) and only `status = 'active'`.
   */
  private async fetchActiveConditions(patientProfileId: string): Promise<readonly string[]> {
    const result = await this.database.query<KeywordRow>(
      `SELECT condition_name AS keyword
       FROM patient_conditions
       WHERE profile_id = $1
         AND status = 'active'
         AND deleted_at IS NULL`,
      [patientProfileId],
    );
    return result.rows.map((row) => row.keyword);
  }

  /**
   * Fetches the medication text from active (signed) prescriptions.
   * Joins `prescription_items` to `prescriptions` to scope by patient and
   * filter to `status = 'signed'`.
   */
  private async fetchActiveMedications(patientProfileId: string): Promise<readonly string[]> {
    const result = await this.database.query<KeywordRow>(
      `SELECT item.medication_text AS keyword
       FROM prescription_items item
       JOIN prescriptions rx ON rx.prescription_id = item.prescription_id
       WHERE rx.patient_profile_id = $1
         AND rx.status = 'signed'
         AND item.medication_text IS NOT NULL`,
      [patientProfileId],
    );
    return result.rows.map((row) => row.keyword);
  }

  /**
   * Fetches published knowledge chunks with their content and document title
   * for keyword scoring. Orders by `published_at DESC, ordinal ASC` so the
   * ordinal fallback is deterministic.
   */
  private async fetchChunks(poolSize: number): Promise<readonly ChunkRow[]> {
    const result = await this.database.query<ChunkRow>(
      `SELECT chunk.chunk_id AS "chunkId",
              chunk.content,
              doc.title,
              chunk.ordinal,
              doc.published_at::text AS "publishedAt"
       FROM knowledge_chunks chunk
       JOIN knowledge_documents doc ON doc.document_id = chunk.document_id
       WHERE doc.status = 'published'
       ORDER BY doc.published_at DESC, chunk.ordinal ASC
       LIMIT $1`,
      [poolSize],
    );
    return result.rows;
  }
}

// ─── Keyword extraction and scoring ──────────────────────────────────────────

/**
 * Extracts clinically meaningful keywords from a free-text string.
 *
 * Tokenizes on non-alphanumeric characters, lowercases, removes stop words
 * and tokens shorter than `MIN_KEYWORD_LENGTH`, and de-duplicates while
 * preserving first-occurrence order.
 */
export function extractKeywordsFromText(text: string): readonly string[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/);
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const token of tokens) {
    if (token.length < MIN_KEYWORD_LENGTH) continue;
    if (STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
  }

  return keywords;
}

/**
 * Scores a chunk by counting how many distinct keywords appear in its content
 * or title. Each keyword contributes at most 1 to the score (not per
 * occurrence), so a chunk that mentions a keyword ten times does not crowd
 * out a chunk that mentions five different keywords once each.
 */
export function scoreChunk(
  content: string,
  title: string,
  keywords: readonly string[],
): number {
  const haystack = `${content} ${title}`.toLowerCase();
  let score = 0;

  for (const kw of keywords) {
    if (haystack.includes(kw)) {
      score += 1;
    }
  }

  return score;
}
