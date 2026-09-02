import {
  MockLlmProvider,
  OpenAiLlmProvider,
  type AiRepository,
  type KnowledgeCitation,
  type LlmProvider,
} from '@smartcura/database/ai';
import { PostgresConnection } from '@smartcura/database';
import { KeywordKnowledgeRetriever } from './keyword-retriever.js';

// Re-export the keyword retriever and its helpers so consumers can import them
// from the same entrypoint as the ordinal retriever.
export { KeywordKnowledgeRetriever } from './keyword-retriever.js';
export { extractKeywordsFromText, scoreChunk } from './keyword-retriever.js';

/**
 * Retrieval port. Exists so the pgvector swap is a query change behind a stable
 * interface: the generation pipeline only ever sees ranked chunk ids.
 */
export interface KnowledgeRetriever {
  retrieve(patientProfileId: string): Promise<readonly KnowledgeCitation[]>;
}

/**
 * Deterministic retrieval over PUBLISHED knowledge only.
 *
 * Ordering is by document/chunk ordinal rather than similarity because the
 * embedding column is a plain `real[]` until the runtime image ships pgvector, and
 * a hand-rolled cosine scan would be both slow and misleading about what the
 * system actually does. `similarity` is therefore reported as null rather than
 * fabricated, so no reviewer can mistake ordinal rank for semantic relevance.
 */
export class PublishedKnowledgeRetriever implements KnowledgeRetriever {
  constructor(
    private readonly database: PostgresConnection,
    private readonly limit = 3,
  ) {}

  async retrieve(): Promise<readonly KnowledgeCitation[]> {
    const result = await this.database.query<{ chunkId: string }>(
      `SELECT chunk.chunk_id AS "chunkId"
       FROM knowledge_chunks chunk
       JOIN knowledge_documents document ON document.document_id = chunk.document_id
       WHERE document.status = 'published'
       ORDER BY document.published_at DESC, chunk.ordinal ASC
       LIMIT $1`,
      [this.limit],
    );
    return result.rows.map((row, index) => ({
      chunkId: row.chunkId, rank: index + 1, similarity: null,
    }));
  }
}

/**
 * Factory for knowledge retrievers.
 *
 * - `'ordinal'` — deterministic document/chunk ordering with `similarity: null`.
 *   Use in tests, offline demos, and any context where reproducibility matters
 *   more than relevance.
 * - `'keyword'` — keyword-based relevance scoring using the patient's recent
 *   messages, conditions, and medications. Use in production deployments
 *   where the AI should cite the most topically relevant published knowledge.
 *   Falls back to ordinal ordering when no keywords match.
 */
export function createKnowledgeRetriever(
  strategy: 'ordinal' | 'keyword',
  database: PostgresConnection,
  limit?: number,
): KnowledgeRetriever {
  if (strategy === 'keyword') {
    return new KeywordKnowledgeRetriever(database, limit ?? 5);
  }
  return new PublishedKnowledgeRetriever(database, limit ?? 3);
}

export class AiGenerationHandler {
  constructor(
    private readonly ai: AiRepository,
    private readonly provider: LlmProvider,
    private readonly retriever: KnowledgeRetriever,
  ) {}

  async handle(generationId: string): Promise<boolean> {
    const outcome = await this.ai.runGeneration({
      generationId,
      provider: this.provider,
      now: new Date(),
      correlationId: generationId,
      retrieve: (patientProfileId) => this.retriever.retrieve(patientProfileId),
    });
    // A blocked generation is a SUCCESSFUL delivery of the safety decision, not a
    // transport failure: retrying would re-run the model and reach the same verdict.
    return outcome !== 'not_found';
  }
}

/**
 * Composes the configured LLM provider. The mock provider is mandatory for tests
 * and offline demos; the OpenAI-compatible provider is selected explicitly for any
 * deployment that uses a real network model. The `cloudflare` adapter uses the
 * same OpenAI-compatible HTTP client but points at Cloudflare Workers AI's
 * OpenAI-compatible endpoint
 * (`https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1`).
 *
 * Cloudflare Workers AI may not support `response_format: json_object` on all
 * models; set `SMARTCURA_AI_JSON_MODE=false` in the environment to skip it.
 */
export function createLlmProvider(
  adapter: 'mock' | 'openai' | 'cloudflare',
  config?: { apiKey: string; baseUrl: string; model: string },
): LlmProvider {
  if (adapter === 'openai' || adapter === 'cloudflare') {
    if (config === undefined) throw new Error('OpenAI/Cloudflare provider requires apiKey, baseUrl and model');
    return new OpenAiLlmProvider(config.apiKey, config.baseUrl, config.model);
  }
  return new MockLlmProvider();
}
