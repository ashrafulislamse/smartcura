'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import { listDoctorAiArtifacts } from '@/lib/api/ai';
import { humaniseCode, shortId } from '@/lib/api/directory';
import type {
  AiArtifact,
  AiArtifactType,
  AiReviewStatus,
  AiRiskLevel,
} from '@/types/contracts';

// Exhaustive over the generated enum so an invented artifact type cannot compile
// a wrong tone — the trap that let `not_required` and `pending` slip in elsewhere.
const ARTIFACT_TYPE_TONE: Record<
  Exclude<AiArtifactType, 'unknown'>,
  'blue' | 'amber' | 'red' | 'green' | 'purple' | 'teal' | 'slate'
> = {
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

/**
 * Doctor AI Artifacts — lists governed AI-generated artifacts for the doctor's
 * actively-assigned patients.
 *
 * Backend: `GET /doctor/ai/artifacts` — assignment-scoped, paginated by an
 * opaque server cursor. The first page is loaded eagerly; the table footer
 * shows a "More available" hint when the page indicates more rows exist.
 * Tapping a row reveals a detail card below the table with the artifact's
 * metadata and the non-diagnostic disclaimer.
 */
export default function DoctorAiArtifactsPage() {
  const { user, isLoading } = useAuth();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const artifacts = useApiResource(
    (signal) => listDoctorAiArtifacts({ pageSize: 50, signal }),
    [],
  );
  const rows = artifacts.data?.data ?? [];
  const hasMore = artifacts.data?.page.has_more ?? false;
  const expanded = expandedId
    ? rows.find((a) => a.artifact_id === expandedId) ?? null
    : null;

  if (isLoading || !user || user.activeRole !== 'doctor') {
    return <PageLoader label="Loading AI artifacts..." />;
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Doctor' },
          { label: 'AI', href: '/doctor/ai' },
          { label: 'Artifacts' },
        ]}
      />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          <PageHeader
            title="AI Artifacts"
            subtitle="Governed AI-generated artifacts across your actively-assigned patients."
            actions={
              <Link
                href="/doctor/ai/assistant"
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2 text-sm font-bold text-white hover:bg-[#1a3695] transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-base">psychology</span>
                Open AI Assistant
              </Link>
            }
          />

          <SectionCard
            title="Artifact history"
            action={
              <span className="text-xs text-slate-400">
                {rows.length} {rows.length === 1 ? 'artifact' : 'artifacts'}
              </span>
            }
          >
            <p className="text-sm text-slate-500 mb-4">
              Tap a row to view the artifact's details and non-diagnostic disclaimer.
            </p>
            <ResourceState
              isLoading={artifacts.isLoading}
              error={artifacts.error}
              isEmpty={!artifacts.isLoading && !artifacts.error && rows.length === 0}
              onRetry={artifacts.reload}
              loadingLabel="Loading AI artifacts..."
              errorTitle="Could not load AI artifacts"
              forbiddenTitle="You cannot view AI artifacts"
              emptyTitle="No AI artifacts"
              emptyBody="No governed AI artifacts exist for your assigned patients yet. Artifacts are generated when patients use the AI assistant."
              emptyIcon="auto_awesome"
            />
            {!artifacts.isLoading && !artifacts.error && rows.length > 0 && (
              <div className="overflow-x-auto -mx-6">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-xs font-bold text-slate-500 uppercase">
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Patient</th>
                      <th className="px-6 py-3">Risk</th>
                      <th className="px-6 py-3">Review</th>
                      <th className="px-6 py-3">Created</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((artifact: AiArtifact) => {
                      const isOpen = expandedId === artifact.artifact_id;
                      return (
                        <tr
                          key={artifact.artifact_id}
                          className={`hover:bg-slate-50 cursor-pointer ${isOpen ? 'bg-slate-50' : ''}`}
                          onClick={() =>
                            setExpandedId(isOpen ? null : artifact.artifact_id)
                          }
                        >
                          <td className="px-6 py-4">
                            <Badge tone={artifactTypeTone(artifact.artifact_type)}>
                              {humaniseCode(artifact.artifact_type)}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-slate-600">
                            <code>{shortId(artifact.patient_profile_id)}</code>
                          </td>
                          <td className="px-6 py-4">
                            <Badge tone={riskTone(artifact.risk_level)}>
                              {humaniseCode(artifact.risk_level)}
                            </Badge>
                          </td>
                          <td className="px-6 py-4">
                            <Badge tone={reviewTone(artifact.review_status)}>
                              {humaniseCode(artifact.review_status)}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-slate-500">
                            {new Date(artifact.created_at).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-slate-400">
                            <span className="material-symbols-outlined text-base">
                              {isOpen ? 'expand_less' : 'expand_more'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {hasMore && (
                  <p className="px-6 py-3 text-xs text-slate-400 border-t border-slate-100">
                    More artifacts are available. Pagination controls land in a
                    follow-up — for now the first page is shown.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          {expanded && (
            <SectionCard
              title={`Artifact ${shortId(expanded.artifact_id)}`}
              action={
                <Link
                  href={`/doctor/ai/artifacts/${expanded.artifact_id}`}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1e3fae] hover:underline"
                >
                  View full details
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </Link>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Type
                  </p>
                  <p className="mt-1 text-slate-700">
                    {humaniseCode(expanded.artifact_type)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Patient
                  </p>
                  <p className="mt-1 text-slate-700">
                    <code>{shortId(expanded.patient_profile_id)}</code>
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Risk
                  </p>
                  <p className="mt-1 text-slate-700">
                    {humaniseCode(expanded.risk_level)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Review status
                  </p>
                  <p className="mt-1 text-slate-700">
                    {humaniseCode(expanded.review_status)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Created
                  </p>
                  <p className="mt-1 text-slate-700">
                    {new Date(expanded.created_at).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Confidence
                  </p>
                  <p className="mt-1 text-slate-700">
                    {expanded.confidence !== null
                      ? `${Math.round(expanded.confidence * 100)}%`
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                  Non-diagnostic
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  AI output is for clinical decision support only. Always apply
                  your own clinical judgment and confirm with the patient.
                </p>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </main>
  );
}
