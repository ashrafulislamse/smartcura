'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import { listDoctorPatients } from '@/lib/api/doctor-patients';
import { callDoctorAiAssistant, listDoctorAiArtifacts } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';
import type {
  AiArtifact,
  AiArtifactType,
  AiReviewStatus,
  AiRiskLevel,
  DoctorAiAssistantResponse,
} from '@/types/contracts';

const PROMPT_MAX = 8000;

// Exhaustive over the generated enum so an invented artifact type cannot compile a wrong label.
const ARTIFACT_TYPE_TONE: Record<Exclude<AiArtifactType, 'unknown'>, 'blue' | 'amber' | 'red' | 'green' | 'purple' | 'teal'> = {
  symptom_summary: 'blue',
  care_navigation: 'teal',
  risk_flag: 'red',
  forecast: 'purple',
  anomaly: 'amber',
};

const RISK_TONE: Record<Exclude<AiRiskLevel, 'unknown'>, 'slate' | 'green' | 'amber' | 'red'> = {
  low: 'green',
  moderate: 'amber',
  high: 'red',
  critical: 'red',
};

const REVIEW_TONE: Record<Exclude<AiReviewStatus, 'unknown'>, 'amber' | 'green' | 'red' | 'slate'> = {
  pending_review: 'amber',
  approved: 'green',
  rejected: 'red',
  superseded: 'slate',
};

function artifactTypeTone(type: AiArtifactType): 'blue' | 'amber' | 'red' | 'green' | 'purple' | 'slate' | 'teal' {
  return type === 'unknown' || !ARTIFACT_TYPE_TONE[type] ? 'slate' : ARTIFACT_TYPE_TONE[type];
}

function riskTone(level: AiRiskLevel): 'slate' | 'green' | 'amber' | 'red' {
  return level === 'unknown' || !RISK_TONE[level] ? 'slate' : RISK_TONE[level];
}

function reviewTone(status: AiReviewStatus): 'amber' | 'green' | 'red' | 'slate' {
  return status === 'unknown' || !REVIEW_TONE[status] ? 'slate' : REVIEW_TONE[status];
}

export default function AIAssistantPage() {
  const { user, isLoading } = useAuth();
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<DoctorAiAssistantResponse | null>(null);
  const [isLoadingResponse, setIsLoadingResponse] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // A 501 is a distinct, non-retriable state: the deployment has no AI provider configured.
  const [notConfigured, setNotConfigured] = useState(false);
  // A 503 means the provider is configured but currently unreachable.
  const [providerUnavailable, setProviderUnavailable] = useState(false);

  // Patient selector source: the doctor's actively-assigned patients.
  const patients = useApiResource((signal) => listDoctorPatients({ pageSize: 100, signal }), []);
  // Artifacts for the doctor's assigned patients, shown below the assistant form.
  const artifacts = useApiResource((signal) => listDoctorAiArtifacts({ pageSize: 100, signal }), []);
  const artifactRows = artifacts.data?.data ?? [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || isLoadingResponse) return;
    setIsLoadingResponse(true);
    setResponse(null);
    setError(null);
    setNotConfigured(false);
    setProviderUnavailable(false);
    try {
      // A fresh idempotency key per "Ask" click means each question is a billable inference.
      // Reusing the key on a network retry returns the stored response verbatim instead.
      const result = await callDoctorAiAssistant(
        { prompt: prompt.trim(), patient_profile_id: selectedPatientId || undefined },
        crypto.randomUUID(),
      );
      setResponse(result);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 501) {
          setNotConfigured(true);
        } else if (caught.status === 503) {
          setProviderUnavailable(true);
        } else {
          setError(caught);
        }
      } else {
        setError(new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'Unexpected client error',
          detail: caught instanceof Error ? caught.message : String(caught),
        }));
      }
    } finally {
      setIsLoadingResponse(false);
    }
  }

  if (isLoading || !user || user.activeRole !== 'doctor') {
    return <PageLoader label="Loading AI assistant..." />;
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'AI Assistant' }]} />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          <PageHeader
            title="AI Clinical Assistant"
            subtitle="AI-generated clinical decision support from governed backend workflows."
          />

          {/* Main interaction card */}
          <SectionCard>
            <div className="flex items-center gap-3 mb-6">
              <span className="material-symbols-outlined text-[#1e3fae] text-3xl p-2 rounded-lg bg-[#1e3fae]/10">psychology</span>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Ask the assistant</h2>
                <p className="text-sm text-slate-500 mt-0.5">Synchronous clinical decision support from the governed backend AI provider.</p>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Patient (optional)</label>
                <select
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm bg-white shadow-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                >
                  <option value="">No specific patient</option>
                  {(patients.data?.data ?? []).map((p) => (
                    <option key={p.profile_id} value={p.profile_id}>
                      {p.display_name} · {shortId(p.profile_id)}
                    </option>
                  ))}
                </select>
                {patients.error && <p className="text-xs text-slate-400 mt-1">Could not load patient list.</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Clinical question</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  required
                  maxLength={PROMPT_MAX}
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm shadow-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-y"
                  placeholder="Ask a clinical question about this patient..."
                />
                <p className="text-xs text-slate-400 mt-1">
                  {prompt.length} / {PROMPT_MAX} characters. AI output is decision support, not a diagnosis.
                </p>
              </div>

              <button
                type="submit"
                disabled={isLoadingResponse || !prompt.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#1a3695] transition-colors shadow-sm"
              >
                {isLoadingResponse ? (
                  <>
                    <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
                    Consulting AI...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-base">send</span>
                    Ask
                  </>
                )}
              </button>
            </form>

            {/* 501 — not configured */}
            {notConfigured && (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5" role="status">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-amber-600">warning</span>
                  <div>
                    <h3 className="font-bold text-amber-900">AI assistant not configured</h3>
                    <p className="text-sm text-amber-800 mt-1">
                      The deployment has no AI provider configured. Contact your administrator to enable the AI integration.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 503 — provider unavailable */}
            {providerUnavailable && (
              <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-5" role="alert">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-red-600">cloud_off</span>
                  <div>
                    <h3 className="font-bold text-red-900">AI provider unavailable</h3>
                    <p className="text-sm text-red-700 mt-1">
                      The configured provider is currently unreachable. Try again later.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Other errors */}
            {error && (
              <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-5" role="alert">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-red-600">error</span>
                  <div className="flex-1">
                    <h3 className="font-bold text-red-900">Could not get a response</h3>
                    <p className="text-sm text-red-700 mt-1">{error.message}</p>
                    {error.correlationId && (
                      <p className="text-xs text-red-400 mt-2">Reference: <code>{error.correlationId}</code></p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Response panel */}
            {response && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5" role="status">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <h3 className="font-bold text-slate-900">Response</h3>
                  <span className="text-xs text-slate-500">{response.provider} · {response.model}</span>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap break-words leading-relaxed">{response.response}</p>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
                  <span>Tokens in: {response.prompt_tokens}</span>
                  <span>Tokens out: {response.completion_tokens}</span>
                  <span>Latency: {response.latency_ms} ms</span>
                  {response.patient_profile_id && <span>Patient: {shortId(response.patient_profile_id)}</span>}
                  <span>Ref: <code>{shortId(response.correlation_id)}</code></span>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Artifacts section */}
          <SectionCard
            title="AI Artifacts"
            action={<span className="text-xs text-slate-400">{artifactRows.length} governed</span>}
          >
            <p className="text-sm text-slate-500 mb-4">
              Governed AI-generated artifacts across your actively-assigned patients.
            </p>
            <ResourceState
              isLoading={artifacts.isLoading}
              error={artifacts.error}
              isEmpty={!artifacts.isLoading && !artifacts.error && artifactRows.length === 0}
              onRetry={artifacts.reload}
              loadingLabel="Loading AI artifacts..."
              errorTitle="Could not load AI artifacts"
              forbiddenTitle="You cannot view AI artifacts"
              emptyTitle="No AI artifacts"
              emptyBody="No governed AI artifacts exist for your assigned patients yet."
              emptyIcon="auto_awesome"
            />
            {!artifacts.isLoading && !artifacts.error && artifactRows.length > 0 && (
              <div className="overflow-x-auto -mx-6">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-xs font-bold text-slate-500 uppercase">
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Patient</th>
                      <th className="px-6 py-3">Risk</th>
                      <th className="px-6 py-3">Review</th>
                      <th className="px-6 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {artifactRows.map((artifact: AiArtifact) => (
                      <tr key={artifact.artifact_id} className="hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <Badge tone={artifactTypeTone(artifact.artifact_type)}>
                            {humaniseCode(artifact.artifact_type)}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-slate-600"><code>{shortId(artifact.patient_profile_id)}</code></td>
                        <td className="px-6 py-4">
                          <Badge tone={riskTone(artifact.risk_level)}>{humaniseCode(artifact.risk_level)}</Badge>
                        </td>
                        <td className="px-6 py-4">
                          <Badge tone={reviewTone(artifact.review_status)}>{humaniseCode(artifact.review_status)}</Badge>
                        </td>
                        <td className="px-6 py-4 text-slate-500">{formatInstant(artifact.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </main>
  );
}
