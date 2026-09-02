'use client';

/**
 * AI Artifact detail, wired to GET /ai/artifacts/{id} and PUT /ai/artifacts/{id}/review.
 *
 * This is the doctor's governed review surface for a single AI-generated artifact. The
 * list page (`/doctor/ai/artifacts`) shows the queue; this page shows the full record and,
 * while the artifact is still `pending_review`, exposes the immutable review decision.
 *
 * A 404 IS NOT ONLY "DOES NOT EXIST". As with the support ticket thread, the API declines
 * to confirm an artifact the caller cannot read, answering 404 rather than 403, so "not
 * found" here may also mean "not assigned to you".
 *
 * THE REVIEW IS OPTIMISTIC-CONCURRENCY GUARDED. `reviewAiArtifact` carries
 * `expected_version` from the artifact as read. A 409 means a concurrent review landed
 * first; the artifact is re-read so a retry uses fresh state. The acknowledgement is the
 * updated artifact itself, so we always RE-READ rather than incrementing what we hold
 * (the trap in AGENTS.md: "A mutation acknowledgement is not the new state").
 *
 * THE READ ENDPOINT DOES NOT RETURN THE RATIONALE. `AiArtifact` carries `review_status`
 * (approved/rejected/superseded) but not the `rationale_code` the reviewer supplied —
 * that field lives only on the request. The reviewed state therefore shows the decision
 * and is honest that the rationale is not surfaced here, rather than inventing one.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import { readAiArtifact, reviewAiArtifact } from '@/lib/api/clinical';
import { humaniseCode, shortId, formatInstant } from '@/lib/api/directory';
import { ApiError } from '@/lib/api/client';
import type {
  AiArtifact,
  AiArtifactType,
  AiReviewStatus,
  AiRiskLevel,
  ReviewAiArtifactRequest,
} from '@/types/contracts';

// Exhaustive over the generated enums so an invented value cannot compile a wrong tone —
// the same trap that let `not_required` and `pending` slip in elsewhere. These mirror the
// list page's maps; both fail to compile if the enum gains a member, which is the safety.
const ARTIFACT_TYPE_TONE: Record<
  Exclude<AiArtifactType, 'unknown'>,
  BadgeTone
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

function artifactTypeTone(type: AiArtifactType): BadgeTone {
  return type === 'unknown' || !ARTIFACT_TYPE_TONE[type] ? 'slate' : ARTIFACT_TYPE_TONE[type];
}

function riskTone(level: AiRiskLevel): 'slate' | 'green' | 'amber' | 'red' {
  return level === 'unknown' || !RISK_TONE[level] ? 'slate' : RISK_TONE[level];
}

function reviewTone(status: AiReviewStatus): 'amber' | 'green' | 'red' | 'slate' {
  return status === 'unknown' || !REVIEW_TONE[status] ? 'slate' : REVIEW_TONE[status];
}

/** The decision vocabulary the backend accepts, derived from the request contract. */
type ReviewDecision = Exclude<ReviewAiArtifactRequest['decision'], 'unknown'>;

const REVIEW_DECISIONS: ReadonlyArray<{ value: ReviewDecision; label: string }> = [
  { value: 'approved', label: 'Approve' },
  { value: 'rejected', label: 'Reject' },
];

export default function AiArtifactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();

  const artifactId = String(params.id);

  const artifact = useApiResource(
    (signal) => readAiArtifact(artifactId, signal),
    [artifactId],
  );

  const notFound = artifact.error?.status === 404;
  const data = artifact.data;
  const isPending = data?.review_status === 'pending_review';

  // --- Review mutation ------------------------------------------------------
  const [decision, setDecision] = useState<ReviewDecision>('approved');
  const [rationaleCode, setRationaleCode] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<ApiError | null>(null);
  const [confirmModal, setConfirmModal] = useState(false);

  const runReview = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!data || rationaleCode.trim() === '' || reviewBusy) return;
      setReviewBusy(true);
      setReviewError(null);
      const req: ReviewAiArtifactRequest = {
        decision,
        rationale_code: rationaleCode.trim(),
        expected_version: data.version,
      };
      try {
        await reviewAiArtifact(artifactId, req);
        setConfirmModal(false);
        setRationaleCode('');
        // Re-read the artifact: the response carries the new state, but reloading is the
        // single source of truth and avoids any local increment drift.
        artifact.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setReviewError(apiError);
        if (apiError.isConflict) {
          // The version in hand is stale — re-read so a retry uses fresh state.
          artifact.reload();
        }
      } finally {
        setReviewBusy(false);
      }
    },
    [data, decision, rationaleCode, reviewBusy, artifactId, artifact],
  );

  if (isAuthLoading || !user || user.activeRole !== 'doctor') {
    return <PageLoader label="Loading AI artifact..." />;
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Doctor' },
          { label: 'AI', href: '/doctor/ai' },
          { label: 'Artifacts', href: '/doctor/ai/artifacts' },
          { label: shortId(artifactId) },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1000px] mx-auto flex flex-col gap-6">
          <Link
            href="/doctor/ai/artifacts"
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[#1e3fae] transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to AI artifacts
          </Link>

          {notFound ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">
                auto_awesome
              </span>
              <h2 className="font-bold text-slate-900 mt-3">Artifact not found</h2>
              <p className="text-sm text-slate-500 mt-1">
                This artifact does not exist, or it belongs to a patient not assigned to you.
              </p>
              <Link
                href="/doctor/ai/artifacts"
                className="inline-block mt-4 text-sm font-bold text-[#1e3fae] hover:underline"
              >
                Back to AI artifacts
              </Link>
            </div>
          ) : (
            <ResourceState
              isLoading={artifact.isLoading}
              error={artifact.error}
              isEmpty={false}
              onRetry={artifact.reload}
              loadingLabel="Loading the AI artifact…"
              forbiddenTitle="You cannot view this AI artifact"
              errorTitle="Could not load the AI artifact"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {data && !artifact.error && (
            <>
              {/* Header */}
              <SectionCard>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                      {humaniseCode(data.artifact_type)}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                      Artifact <code>{shortId(data.artifact_id)}</code> · patient{' '}
                      <code>{shortId(data.patient_profile_id)}</code> · version{' '}
                      {data.version_no}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={reviewTone(data.review_status)}>
                      {humaniseCode(data.review_status)}
                    </Badge>
                    <Badge tone={riskTone(data.risk_level)}>
                      {humaniseCode(data.risk_level)} risk
                    </Badge>
                    <Badge tone={artifactTypeTone(data.artifact_type)}>
                      {humaniseCode(data.artifact_type)}
                    </Badge>
                  </div>
                </div>
              </SectionCard>

              {/* Metadata */}
              <SectionCard title="Details">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <DetailField label="Patient">
                    <code>{shortId(data.patient_profile_id)}</code>
                  </DetailField>
                  <DetailField label="Artifact type">
                    {humaniseCode(data.artifact_type)}
                  </DetailField>
                  <DetailField label="Version no.">{data.version_no}</DetailField>
                  <DetailField label="Review status">
                    <Badge tone={reviewTone(data.review_status)}>
                      {humaniseCode(data.review_status)}
                    </Badge>
                  </DetailField>
                  <DetailField label="Risk level">
                    <Badge tone={riskTone(data.risk_level)}>
                      {humaniseCode(data.risk_level)}
                    </Badge>
                  </DetailField>
                  <DetailField label="Confidence">
                    {data.confidence !== null
                      ? `${Math.round(data.confidence * 100)}%`
                      : '—'}
                  </DetailField>
                  <DetailField label="Model">
                    <code>{shortId(data.model_id)}</code>
                  </DetailField>
                  <DetailField label="Prompt template">
                    <code>{shortId(data.prompt_template_id)}</code>
                  </DetailField>
                  {data.replaces_artifact_id && (
                    <DetailField label="Replaces">
                      <code>{shortId(data.replaces_artifact_id)}</code>
                    </DetailField>
                  )}
                  <DetailField label="Created">
                    {formatInstant(data.created_at)}
                  </DetailField>
                  <DetailField label="Updated">
                    {formatInstant(data.updated_at)}
                  </DetailField>
                  <DetailField label="Record version">{data.version}</DetailField>
                </div>
              </SectionCard>

              {/* Non-diagnostic disclaimer — the content payload's one typed field. */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-amber-700">warning</span>
                  <div>
                    <p className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                      Non-diagnostic
                    </p>
                    <p className="mt-1 text-sm text-amber-800">
                      This AI output is for clinical decision support only and is explicitly
                      flagged <code>non_diagnostic</code>. It is not a diagnosis. Always apply
                      your own clinical judgment, correlate with the patient&apos;s record and
                      vitals, and confirm findings with the patient before acting.
                    </p>
                  </div>
                </div>
              </div>

              {/* Review section */}
              <SectionCard title="Doctor review">
                {isPending ? (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-500">
                      This artifact is awaiting your review. Record an immutable decision and a
                      structured rationale code. The decision cannot be changed once submitted.
                    </p>
                    <form onSubmit={(e) => { e.preventDefault(); setConfirmModal(true); }} className="flex flex-col gap-4">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-sm font-bold text-slate-700">Decision</span>
                        <select
                          value={decision}
                          onChange={(e) => setDecision(e.target.value as ReviewDecision)}
                          className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
                        >
                          {REVIEW_DECISIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-sm font-bold text-slate-700">
                          Rationale code <span className="text-red-500">*</span>
                        </span>
                        <input
                          value={rationaleCode}
                          onChange={(e) => setRationaleCode(e.target.value)}
                          placeholder="e.g. clinically_appropriate, unsupported_conclusion"
                          className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                          required
                        />
                        <span className="text-xs text-slate-400">
                          Lowercase, snake_case. Describes why you approved or rejected the output.
                        </span>
                      </label>
                      {reviewError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                          <p className="text-sm font-bold text-red-700">
                            {reviewError.isForbidden
                              ? 'You cannot review this artifact'
                              : reviewError.isConflict
                                ? 'Conflict — the artifact changed. Please retry.'
                                : reviewError.isUnauthenticated
                                  ? 'Your session expired. Please sign in again.'
                                  : reviewError.title}
                          </p>
                          <p className="text-xs text-red-600 mt-1">{reviewError.message}</p>
                          {reviewError.correlationId && (
                            <p className="text-xs text-red-400 mt-1">
                              Reference: <code>{reviewError.correlationId}</code>
                            </p>
                          )}
                        </div>
                      )}
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={rationaleCode.trim() === '' || reviewBusy}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                          <span className="material-symbols-outlined text-base">rate_review</span>
                          {reviewBusy ? 'Submitting...' : 'Submit review'}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-slate-700">Decision:</span>
                      <Badge tone={reviewTone(data.review_status)}>
                        {humaniseCode(data.review_status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-500">
                      This artifact has already been reviewed. The rationale code submitted at
                      review time is not surfaced by the read endpoint.
                    </p>
                    {data.replaces_artifact_id && (
                      <p className="text-xs text-slate-400">
                        This artifact supersedes{' '}
                        <Link
                          href={`/doctor/ai/artifacts/${data.replaces_artifact_id}`}
                          className="text-[#1e3fae] font-bold hover:underline"
                        >
                          <code>{shortId(data.replaces_artifact_id)}</code>
                        </Link>
                        .
                      </p>
                    )}
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </div>
      </div>

      {/* Confirmation modal — a review is immutable, so confirm before committing. */}
      {confirmModal && data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">
                {decision === 'approved' ? 'Approve artifact?' : 'Reject artifact?'}
              </h2>
              <button
                type="button"
                onClick={() => setConfirmModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={runReview} className="p-6 flex flex-col gap-4">
              <p className="text-sm text-slate-600">
                You are about to record an immutable <strong>{decision}</strong> review on
                artifact <code>{shortId(data.artifact_id)}</code> (version {data.version_no})
                with rationale code <code>{rationaleCode.trim()}</code>. This decision cannot be
                changed once submitted.
              </p>
              {reviewError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                  <p className="text-sm font-bold text-red-700">
                    {reviewError.isConflict
                      ? 'Conflict — the artifact changed. Please retry.'
                      : reviewError.title}
                  </p>
                  <p className="text-xs text-red-600 mt-1">{reviewError.message}</p>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal(false)}
                  disabled={reviewBusy}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reviewBusy}
                  className={`px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 transition-colors ${
                    decision === 'approved'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {reviewBusy
                    ? 'Submitting...'
                    : decision === 'approved'
                      ? 'Confirm approve'
                      : 'Confirm reject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail field                                                                */
/* -------------------------------------------------------------------------- */

interface DetailFieldProps {
  readonly label: string;
  readonly children: React.ReactNode;
}

function DetailField({ label, children }: DetailFieldProps) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-slate-700">{children}</p>
    </div>
  );
}
