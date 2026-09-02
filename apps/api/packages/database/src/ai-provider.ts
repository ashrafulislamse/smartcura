import { performance } from 'node:perf_hooks';
import { type HealthContext, serializeHealthContext } from './health-context.js';
import {
  type RichLongitudinalAnalysis,
  serializeRichLongitudinalAnalysis,
} from './longitudinal-analysis.js';
import {
  type PatientRiskProfile,
  type AnomalyReport,
  serializeRiskProfile,
  serializeAnomalyReport,
} from './risk-scoring.js';

/**
 * Provider-neutral LLM boundary and the mandatory mock.
 *
 * The service selection requires a real provider to stay behind `LlmProvider` and
 * requires `MockLlmProvider` to exist for tests and the offline demo, so nothing in
 * the test suite or a demo without internet depends on a paid network call. This
 * module therefore contains the network port only; the real adapter is in this file
 * and no caller can tell the difference.
 *
 * Everything here is pure and deterministic. A random generator cannot be used to
 * prove that a rerun reproduces an artifact, which is the reproducibility property
 * the governance rules exist to guarantee.
 */

export type AiArtifactType =
  'symptom_summary' | 'care_navigation' | 'health_summary' | 'daily_summary' | 'trend_analysis' | 'risk_flag' | 'forecast' | 'anomaly';
export type AiRiskLevel = 'unknown' | 'low' | 'moderate' | 'high' | 'critical';
export type AiSafetySeverity = 'info' | 'warning' | 'critical';

export interface KnowledgeCitation {
  readonly chunkId: string;
  readonly rank: number;
  readonly similarity: number | null;
}

export interface LlmGenerationRequest {
  readonly artifactType: AiArtifactType;
  /**
   * Already-minimised transcript. Identifiers are removed before this boundary,
   * because a provider prompt is the point at which data leaves the platform.
   */
  readonly turns: readonly { readonly role: 'patient' | 'assistant'; readonly content: string }[];
  readonly citations: readonly KnowledgeCitation[];
  readonly promptTemplateKey: string;
  readonly promptTemplateVersion: number;
  /**
   * Authorised patient health context (Phase AI-2). Optional so the pipeline
   * remains backward-compatible during the transition; once AI-2 is fully
   * wired, every real generation will carry this. The mock provider echoes
   * it for deterministic testing, and the network provider includes it in
   * the system prompt so the model can reason about real patient data.
   */
  readonly healthContext?: HealthContext | undefined;
  /**
   * Multi-domain risk scores (Phase AI-9). Optional so the pipeline remains
   * backward-compatible. The mock provider echoes presence for deterministic
   * testing; the network provider includes serialized risk scores in the
   * system prompt so the model can factor risk into its response.
   */
  readonly riskProfile?: PatientRiskProfile | undefined;
  /**
   * Advanced anomaly detection report (Phase AI-9). Condition-aware pattern
   * detection over the recent vital-readings window.
   */
  readonly anomalyReport?: AnomalyReport | undefined;
  /**
   * Rich longitudinal analysis (Phase AI-9). Trends, seasonal patterns,
   * window-over-window comparison, and health trajectory.
   */
  readonly richLongitudinalAnalysis?: RichLongitudinalAnalysis | undefined;
}

export interface LlmGenerationResult {
  readonly content: Record<string, unknown>;
  readonly riskLevel: AiRiskLevel;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly latencyMs: number;
}

export type AiProvider = 'mock' | 'openai' | 'cloudflare';

export interface LlmProvider {
  readonly provider: AiProvider;
  generate(request: LlmGenerationRequest): Promise<LlmGenerationResult>;
}

export interface SafetyFinding {
  readonly severity: AiSafetySeverity;
  readonly categoryCode: string;
  readonly blocked: boolean;
  readonly detailCode: string | null;
}

/**
 * Phrases that would turn advisory output into a clinical instruction. These are
 * the prohibited automated actions from the catalogue: diagnosing, prescribing or
 * changing medication, and directing emergency handling. A candidate containing
 * them is BLOCKED rather than sanitised, because silently editing clinical-sounding
 * text would leave a patient with advice nobody wrote or reviewed.
 */
const PROHIBITED_PATTERNS: readonly { readonly pattern: RegExp; readonly category: string }[] = [
  { pattern: /\byou (?:have|are suffering from|are diagnosed with)\b/i, category: 'diagnostic_claim' },
  { pattern: /\b(?:diagnosis is|diagnosed as)\b/i, category: 'diagnostic_claim' },
  { pattern: /\b(?:take|start|stop|increase|decrease)\s+\d+\s*(?:mg|ml|mcg|g)\b/i, category: 'medication_instruction' },
  { pattern: /\b(?:prescribe|prescribing|prescription for)\b/i, category: 'medication_instruction' },
  { pattern: /\b(?:double|halve|adjust)\s+your\s+dose\b/i, category: 'medication_instruction' },
  { pattern: /\b(?:no need to|do not|don't)\s+(?:call|contact|seek)\s+(?:an?\s+)?(?:ambulance|emergency|doctor)\b/i, category: 'emergency_suppression' },
  { pattern: /\bignore\s+(?:your|the)\s+(?:symptoms|alert|warning)\b/i, category: 'emergency_suppression' },
];

/** Wording that must be present, so patient-facing text stays clearly advisory. */
const REQUIRED_DISCLAIMER = 'non_diagnostic';

/**
 * Evaluates a provider candidate. `blocked` findings are `critical` by
 * construction, matching `ai_safety_events_block_check`, so the database and this
 * filter cannot disagree about whether a block was serious.
 */
export function evaluateSafety(content: Record<string, unknown>): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const text = JSON.stringify(content);
  for (const { pattern, category } of PROHIBITED_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({
        severity: 'critical', categoryCode: category, blocked: true, detailCode: 'prohibited_action',
      });
    }
  }
  if (content[REQUIRED_DISCLAIMER] !== true) {
    findings.push({
      severity: 'critical', categoryCode: 'missing_non_diagnostic_label',
      blocked: true, detailCode: 'label_absent',
    });
  }
  // A candidate that cites nothing is not unsafe, but it is unreviewable, so it is
  // surfaced as a warning rather than silently accepted as well-sourced.
  if (Array.isArray(content['sources']) && content['sources'].length === 0) {
    findings.push({
      severity: 'warning', categoryCode: 'no_retrieval_support', blocked: false, detailCode: null,
    });
  }
  return findings;
}

export function safetyBlocks(findings: readonly SafetyFinding[]): boolean {
  return findings.some((finding) => finding.blocked);
}

/**
 * Deterministic offline provider. Produces a structured, explicitly
 * non-diagnostic artifact from the patient's own words plus retrieved citations,
 * and never asserts a condition, a medication change or a confidence score.
 */
export class MockLlmProvider implements LlmProvider {
  readonly provider = 'mock' as const;

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    const patientTurns = request.turns.filter((turn) => turn.role === 'patient');
    const reported = patientTurns.map((turn) => turn.content.trim()).filter((text) => text.length > 0);
    const promptTokens = estimateTokens([
      request.promptTemplateKey,
      ...request.turns.map((turn) => turn.content),
      ...request.citations.map((citation) => citation.chunkId),
      request.healthContext ? serializeHealthContext(request.healthContext) : '',
      request.riskProfile ? serializeRiskProfile(request.riskProfile) : '',
      request.anomalyReport ? serializeAnomalyReport(request.anomalyReport) : '',
      request.richLongitudinalAnalysis ? serializeRichLongitudinalAnalysis(request.richLongitudinalAnalysis) : '',
    ].join(' '));
    const content: Record<string, unknown> = {
      // The label the database CHECK also requires, so an artifact cannot be
      // stored without it even if a provider forgot.
      non_diagnostic: true,
      artifact_type: request.artifactType,
      summary_of_reported_symptoms: reported,
      // Echo the health context so the test suite can verify the pipeline
      // delivered it to the provider. This is the deterministic equivalent of
      // the network provider embedding it in the system prompt.
      health_context_present: request.healthContext !== undefined,
      health_context_summary: request.healthContext !== undefined
        ? {
            conditions_count: request.healthContext.conditions.length,
            allergies_count: request.healthContext.allergies.length,
            medications_count: request.healthContext.medications.length,
            vitals_count: request.healthContext.recentVitals.length,
            patient_name: request.healthContext.profile.displayName,
          }
        : null,
      // Echo the AI-9 context fields for deterministic testing.
      risk_profile_present: request.riskProfile !== undefined,
      risk_profile_summary: request.riskProfile !== undefined
        ? {
            overall_score: request.riskProfile.overallRiskScore,
            overall_level: request.riskProfile.overallRiskLevel,
            domain_count: request.riskProfile.riskScores.length,
            domains: request.riskProfile.riskScores.map((s) => s.riskType),
          }
        : null,
      anomaly_report_present: request.anomalyReport !== undefined,
      anomaly_report_summary: request.anomalyReport !== undefined
        ? {
            anomaly_count: request.anomalyReport.anomalies.length,
            window_days: request.anomalyReport.windowDays,
            total_readings: request.anomalyReport.totalReadingsAnalyzed,
          }
        : null,
      longitudinal_analysis_present: request.richLongitudinalAnalysis !== undefined,
      longitudinal_analysis_summary: request.richLongitudinalAnalysis !== undefined
        ? {
            trajectory: request.richLongitudinalAnalysis.healthTrajectory,
            trend_count: request.richLongitudinalAnalysis.trends.length,
            seasonal_pattern_count: request.richLongitudinalAnalysis.seasonalPatterns.length,
            window_comparison_count: request.richLongitudinalAnalysis.windowComparison.length,
          }
        : null,
      suggested_next_step: nextStep(request.artifactType),
      information_only_notice:
        'This is general information generated from your own words and reference material. ' +
        'It is not a diagnosis and does not change any medication or care plan. ' +
        'A doctor reviews it before it is treated as clinical advice.',
      sources: request.citations.map((citation) => ({
        chunk_id: citation.chunkId, rank: citation.rank,
      })),
      prompt_template: {
        key: request.promptTemplateKey, version: request.promptTemplateVersion,
      },
    };
    return {
      content,
      // Deliberately conservative and never derived from model self-certainty:
      // risk is an input for a human reviewer, not an automated verdict.
      riskLevel: reported.length === 0 ? 'unknown' : 'low',
      promptTokens,
      completionTokens: estimateTokens(JSON.stringify(content)),
      latencyMs: 0,
    };
  }
}

/**
 * Care-navigation wording only. Every string here routes the patient to a human;
 * none of them names a condition or a drug, which is what keeps the mock output
 * inside the prohibited-action rules by construction.
 */
function nextStep(artifactType: AiArtifactType): string {
  switch (artifactType) {
    case 'symptom_summary':
      return 'Share this summary with a doctor during your next consultation.';
    case 'health_summary':
      return 'Review your device readings regularly and discuss any persistent changes with your care team.';
    case 'care_navigation':
      return 'Consider booking a consultation so a doctor can review your symptoms.';
    case 'risk_flag':
      return 'A doctor should review the flagged readings before any action is taken.';
    case 'daily_summary':
      return 'Review your morning health summary and consider the suggested proactive action.';
    case 'trend_analysis':
      return 'Discuss the observed trends with your assigned doctor at your next consultation.';
    case 'forecast':
    case 'anomaly':
      return 'Discuss this trend with your assigned doctor.';
  }
}

/**
 * OpenAI-compatible network provider. Calls any provider that implements the
 * `/chat/completions` endpoint (OpenAI, OpenRouter, Groq, etc.). The response is
 * parsed as JSON and the safety filter downstream enforces the non-diagnostic
 * constraint, so the adapter does not silently edit clinical-sounding output.
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly provider = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    const startedAt = performance.now();
    const messages = this.buildMessages(request);
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.2,
      // The Cline gateway defaults stream=true (unlike OpenAI which defaults to
      // false). Always set stream:false so we get a single JSON response, not SSE.
      stream: false,
    };
    // Not all OpenAI-compatible providers support response_format. Gate it on an
    // env flag so providers like the Cline gateway (minimax-m3) that reject it
    // with a 400 can still be used. Defaults to true for backward compatibility.
    if (process.env.SMARTCURA_AI_JSON_MODE !== 'false') {
      body.response_format = { type: 'json_object' };
    }
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const respBody = await response.text().catch(() => '');
      throw new Error(`OpenAI-compatible provider error ${response.status}: ${respBody}`);
    }
    // The response may be a standard OpenAI shape ({choices:[...]}) or may be
    // wrapped by an OpenAI-compatible gateway (e.g. the Cline gateway) in a
    // top-level `data` field ({data:{choices:[...]}}). Intersect with an
    // optional `data` so a single type covers both shapes and the unwrap is a
    // simple nullish-coalesce instead of a ternary that fails to narrow.
    const json = await response.json() as OpenAiChatCompletionResponse & {
      readonly data?: OpenAiChatCompletionResponse | null;
    };
    const data: OpenAiChatCompletionResponse = json.data ?? json;
    const rawContent = data.choices[0]?.message?.content ?? '{}';
    // Some models wrap JSON output in markdown code fences (```json ... ```).
    // Strip them before parsing so the structured artifact pipeline gets clean JSON.
    const stripped = rawContent.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripped) as Record<string, unknown>;
    } catch {
      // A non-JSON response is unusable for the structured artifact pipeline; wrap it
      // so the safety filter can still record the failure rather than crashing the worker.
      parsed = {
        raw_response: rawContent,
        non_diagnostic: true,
        parse_error: true,
      };
    }
    // The safety filter requires the label; ensure it is present even if the model
    // forgets it, so the downstream block is explicit and auditable.
    if (parsed.non_diagnostic !== true) {
      parsed.non_diagnostic = true;
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      content: parsed,
      riskLevel: 'low',
      promptTokens: data.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages)),
      completionTokens: data.usage?.completion_tokens ?? estimateTokens(rawContent),
      latencyMs,
    };
  }

  private buildMessages(request: LlmGenerationRequest): readonly { role: string; content: string }[] {
    const systemParts = [
      'You are a non-diagnostic clinical support assistant.',
      'You must NEVER diagnose a condition, prescribe or change medication, or direct emergency handling.',
      'You only summarize what the patient reported and suggest what kind of care they might consider seeking.',
      'Return ONLY a JSON object. The object MUST include `"non_diagnostic": true`.',
      'Include a short summary_of_reported_symptoms array, a suggested_next_step string, an information_only_notice string, and a sources array with chunk_id and rank from the citations provided.',
      `Artifact type: ${request.artifactType}. Template: ${request.promptTemplateKey} v${request.promptTemplateVersion}.`,
    ];

    // For health_summary artifacts, add instructions that specifically ask the
    // LLM to interpret and cite vital readings with source provenance.
    if (request.artifactType === 'health_summary') {
      systemParts.push(
        'This is a HEALTH SUMMARY request. Focus primarily on the patient\'s recent vital readings from the health context below. ' +
        'For each vital metric (heart rate, oxygen saturation, body temperature, blood pressure, etc.), ' +
        'state the latest value, its source (ESP32 or Health Connect), the timestamp, and the data quality. ' +
        'Note whether readings are within a typical range or show notable variation. ' +
        'If the patient has known conditions or medications that relate to a vital metric, mention the connection. ' +
        'The summary_of_reported_symptoms array should describe what the vital data shows, not just what the patient said. ' +
        'Do NOT diagnose or interpret readings as indicating a specific condition.',
      );
    }

    if (request.artifactType === 'daily_summary') {
      systemParts.push(
        'This is a DAILY HEALTH SUMMARY request. Provide a concise morning overview of the patient\'s health based on their recent vital readings. ' +
        'Highlight the latest values for each available metric (heart rate, SpO₂, temperature, etc.) with their source and timestamp. ' +
        'Note any readings that are stale (older than 5 minutes) or suspect quality. ' +
        'If the patient has conditions or medications relevant to the vital metrics, mention the connection. ' +
        'Suggest one proactive care action the patient could consider (e.g., booking a routine check-up, taking medication, resting). ' +
        'The summary_of_reported_symptoms array should describe what the vital data shows today. ' +
        'Do NOT diagnose or interpret readings as indicating a specific condition.',
      );
    }

    if (request.artifactType === 'trend_analysis') {
      systemParts.push(
        'This is a TREND ANALYSIS request. Analyse the patient\'s vital readings over the past 7 days. ' +
        'Identify any sustained upward or downward trends in heart rate, oxygen saturation, body temperature, or other available metrics. ' +
        'Compare current readings to the 7-day baseline. Note any correlations between metrics. ' +
        'The summary_of_reported_symptoms array should describe the trends observed, not just individual readings. ' +
        'Do NOT diagnose or interpret trends as indicating a specific condition.',
      );
    }

    if (request.healthContext !== undefined) {
      systemParts.push(
        'The following is the patient\'s authorised health context from the SmartCura platform. ' +
        'Use it to ground your response in the patient\'s real data. ' +
        'Cite specific readings when relevant, including the source and timestamp. ' +
        'Treat suspect-quality readings with appropriate caution. ' +
        'Do NOT use this data to diagnose — it is context for non-diagnostic support only.',
      );
      systemParts.push('--- HEALTH CONTEXT ---');
      systemParts.push(serializeHealthContext(request.healthContext));
      systemParts.push('--- END HEALTH CONTEXT ---');
    }

    // Phase AI-9: risk scores, anomaly detection, and rich longitudinal analysis.
    // Each is included only when present, and framed as non-diagnostic context.
    if (request.riskProfile !== undefined) {
      systemParts.push(
        'The following risk scores are derived from the patient\'s vitals and conditions. ' +
        'They are care-navigation signals, NOT diagnoses. Reference the risk level and ' +
        'contributing factors when relevant, and route the patient to appropriate care. ' +
        'Do NOT equate a risk score with a confirmed condition.',
      );
      systemParts.push('--- RISK PROFILE ---');
      systemParts.push(serializeRiskProfile(request.riskProfile));
      systemParts.push('--- END RISK PROFILE ---');
    }

    if (request.anomalyReport !== undefined) {
      systemParts.push(
        'The following anomaly report identifies unusual patterns in the patient\'s recent ' +
        'vital readings. Each anomaly includes its type, severity, and related conditions. ' +
        'Mention notable anomalies when they help the patient understand what the data shows. ' +
        'Do NOT interpret anomalies as confirming a specific diagnosis.',
      );
      systemParts.push('--- ANOMALY REPORT ---');
      systemParts.push(serializeAnomalyReport(request.anomalyReport));
      systemParts.push('--- END ANOMALY REPORT ---');
    }

    if (request.richLongitudinalAnalysis !== undefined) {
      systemParts.push(
        'The following longitudinal analysis covers trends, seasonal patterns, and ' +
        'window-over-window comparison of the patient\'s vitals. Use the health trajectory ' +
        'and specific trends to give the patient a richer picture of how their readings ' +
        'have changed over time. Do NOT interpret trends as indicating a specific condition.',
      );
      systemParts.push('--- LONGITUDINAL ANALYSIS ---');
      systemParts.push(serializeRichLongitudinalAnalysis(request.richLongitudinalAnalysis));
      systemParts.push('--- END LONGITUDINAL ANALYSIS ---');
    }
    const system = systemParts.join(' ');
    return [
      { role: 'system', content: system },
      ...request.turns.map((turn) => ({
        role: turn.role === 'patient' ? 'user' : 'assistant',
        content: turn.content,
      })),
      {
        role: 'user',
        content: `Citations (use only these): ${request.citations
          .map((citation) => `${citation.chunkId} (rank ${citation.rank})`)
          .join('; ')}`,
      },
    ];
  }
}

interface OpenAiChatCompletionResponse {
  readonly choices: readonly {
    readonly message: { readonly content: string | null };
  }[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  };
}/**
 * Deterministic token estimate. Real usage accounting comes from the provider
 * response; this exists so the mock still records a usage row and the accounting
 * path is exercised offline.
 */
function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}
