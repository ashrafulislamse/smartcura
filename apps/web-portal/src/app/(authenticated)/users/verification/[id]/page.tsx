'use client';

/**
 * Verification document detail and review page.
 *
 * Fetches the `VerificationDocumentView` via
 * `GET /memberships/{membershipId}/verification-documents/{documentId}`.
 *
 * The review action calls
 * `PUT /organizations/{orgId}/verification-documents/{documentId}/status`
 * with `expected_version` for optimistic concurrency. A 409 means someone
 * else already reviewed it — the caller must reload, not overwrite.
 *
 * REASON CODE CONSTRAINTS (from the contract description):
 * - `approved_verified` may justify ONLY an approval.
 * - An approval may carry NO other reason.
 * So when status = `approved`, the reason dropdown is locked to
 * `approved_verified`; when status is anything else, `approved_verified`
 * is excluded from the dropdown.
 *
 * STEP-UP. The review endpoint requires current MFA. A 403 with
 * `STEP_UP_REQUIRED` redirects to the 2FA flow rather than showing an
 * inline error (same pattern as emergency break-glass).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import {
  VERIFICATION_STYLE,
  formatInstant,
  humaniseCode,
  shortId,
} from '@/lib/api/directory';
import type {
  ReviewVerificationDocumentRequest,
  VerificationDocumentView,
  VerificationReasonCode,
  VerificationStatus,
} from '@/types/contracts';
import { ApiError } from '@/lib/api/client';
import {
  downloadVerificationDocument,
  readVerificationDocument,
  reviewVerificationDocument,
} from '@/lib/api/workstream-f';

/** The narrower status union the review endpoint accepts. */
type ReviewStatus = ReviewVerificationDocumentRequest['status'];

/** Reviewer-assignable statuses (from the contract: not_submitted and pending_review are not reviewer outcomes). */
const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'approved',
  'rejected',
  'changes_requested',
  'suspended',
  'expired',
];

/** All reason codes except `approved_verified` — used when status is not `approved`. */
const REASON_CODES_NON_APPROVAL: readonly VerificationReasonCode[] = [
  'document_illegible',
  'document_expired',
  'name_mismatch',
  'wrong_document_type',
  'suspected_forgery',
  'licence_not_verifiable',
  'administrative_request',
  'policy_violation',
];

/** Only `approved_verified` may justify an approval. */
const REASON_CODES_APPROVAL: readonly VerificationReasonCode[] = ['approved_verified'];

/** Statuses that mean a human still has to act. */
const ACTIONABLE_STATUSES: readonly VerificationStatus[] = ['pending_review', 'changes_requested'];

function isActionable(status: VerificationStatus): boolean {
  return ACTIONABLE_STATUSES.includes(status);
}

export default function VerificationDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { activeMembership, isLoading: authLoading } = useAuth();

  const documentId = String(params.id);
  const membershipId = searchParams.get('m') ?? '';
  const organizationId = activeMembership?.organization_id;

  // Fetch the single verification document by id.
  const resource = useApiResource(
    (signal) =>
      membershipId
        ? readVerificationDocument(membershipId, documentId, signal)
        : Promise.resolve(null),
    [membershipId, documentId],
  );

  const doc = resource.data ?? null;

  // Review form state.
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('approved');
  const [reasonCode, setReasonCode] = useState<VerificationReasonCode>('approved_verified');
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<ApiError | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState(false);

  // Download state. The endpoint returns a short-lived URL that expires at
  // `expires_at`, so it is opened immediately rather than stored.
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<ApiError | null>(null);

  async function handleDownload() {
    if (!membershipId || !doc) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const response = await downloadVerificationDocument(membershipId, documentId);
      // The URL is short-lived; open it in a new tab immediately.
      window.open(response.download.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err : null);
    } finally {
      setIsDownloading(false);
    }
  }

  // When status changes, reset the reason code to the first valid option.
  function handleStatusChange(newStatus: ReviewStatus) {
    setReviewStatus(newStatus);
    if (newStatus === 'approved') {
      setReasonCode('approved_verified');
    } else {
      setReasonCode(REASON_CODES_NON_APPROVAL[0]);
    }
  }

  const availableReasons = reviewStatus === 'approved' ? REASON_CODES_APPROVAL : REASON_CODES_NON_APPROVAL;

  async function handleReview() {
    if (!organizationId || !doc) return;
    setSubmitting(true);
    setReviewError(null);
    setReviewSuccess(false);
    try {
      await reviewVerificationDocument(organizationId, documentId, {
        status: reviewStatus,
        reason_code: reasonCode,
        expected_version: doc.version,
      });
      setReviewSuccess(true);
      // Reload the document to get the updated version.
      resource.reload();
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.needsStepUp) {
        router.push('/2fa');
        return;
      }
      setReviewError(apiError);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Early returns ----

  if (authLoading) return <div className="p-8 text-slate-500">Loading session...</div>;

  if (!organizationId)
    return (
      <main className="p-8">
        <ResourceState
          isLoading={false}
          error={null}
          isEmpty
          onRetry={resource.reload}
          loadingLabel="Loading document..."
          forbiddenTitle="Verification unavailable"
          errorTitle="Verification unavailable"
          emptyTitle="No active organization"
          emptyBody="Select an active membership before viewing this document."
          emptyIcon="verified_user"
        />
      </main>
    );

  if (!membershipId)
    return (
      <main className="p-8">
        <ResourceState
          isLoading={false}
          error={null}
          isEmpty
          onRetry={resource.reload}
          loadingLabel="Loading document..."
          forbiddenTitle="Verification unavailable"
          errorTitle="Verification unavailable"
          emptyTitle="Missing membership reference"
          emptyBody="This page was reached without a membership id. Go back to the queue and try again."
          emptyIcon="link_off"
        />
      </main>
    );

  const notFound = resource.error?.status === 404;

  return (
    <main className="flex-1 min-h-screen bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Users' },
          { label: 'Verification queue', href: '/users/verification' },
          { label: doc ? shortId(doc.document_id) : 'Document' },
        ]}
      />
      <div className="p-5 sm:p-8 max-w-5xl mx-auto space-y-6">
        <Link href="/users/verification" className="text-sm font-bold text-[#1e3fae]">
          ← Back to queue
        </Link>

        {/* 404 — not found or not readable by this caller */}
        {notFound ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <span className="material-symbols-outlined text-6xl text-slate-300">description_off</span>
            <h2 className="text-xl font-bold text-slate-900 mt-4">Document not found</h2>
            <p className="text-sm text-slate-500 mt-2">
              This document is not available in your organization, or it may have been removed.
            </p>
          </div>
        ) : (
          <>
            <ResourceState
              isLoading={resource.isLoading}
              error={resource.error}
              isEmpty={!doc}
              onRetry={resource.reload}
              loadingLabel="Loading document..."
              forbiddenTitle="You cannot review this document"
              errorTitle="Document could not be loaded"
              emptyTitle="Document not found"
              emptyBody="This document is not available in your organization."
              emptyIcon="description_off"
            />

            {doc && (
              <DocumentDetail
                doc={doc}
                isDownloading={isDownloading}
                downloadError={downloadError}
                onDownload={handleDownload}
              />
            )}

            {/* Review action card */}
            {doc && isActionable(doc.status) && (
              <ReviewCard
                reviewStatus={reviewStatus}
                reasonCode={reasonCode}
                availableReasons={availableReasons}
                submitting={submitting}
                reviewError={reviewError}
                reviewSuccess={reviewSuccess}
                onStatusChange={handleStatusChange}
                onReasonChange={setReasonCode}
                onSubmit={handleReview}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Document detail
// ---------------------------------------------------------------------------

interface DocumentDetailProps {
  doc: VerificationDocumentView;
  isDownloading: boolean;
  downloadError: ApiError | null;
  onDownload: () => void;
}

function DocumentDetail({ doc, isDownloading, downloadError, onDownload }: DocumentDetailProps) {
  return (
    <>
      {/* Header card */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900">
              {humaniseCode(doc.document_kind)}
            </h1>
            <p className="text-sm text-slate-400 font-mono mt-1">{shortId(doc.document_id)}</p>
            <span
              className={`inline-block mt-3 rounded-full border px-3 py-1 text-xs font-bold ${
                VERIFICATION_STYLE[doc.status as keyof typeof VERIFICATION_STYLE] ??
                'bg-slate-50 text-slate-600 border-slate-100'
              }`}
            >
              {humaniseCode(doc.status)}
            </span>
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>Version {doc.version}</p>
            <p className="mt-1">Submitted {formatInstant(doc.submitted_at)}</p>
            {doc.reviewed_at && (
              <p className="mt-1">Reviewed {formatInstant(doc.reviewed_at)}</p>
            )}
          </div>
        </div>
      </section>

      {/* File metadata */}
      <section className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-bold text-slate-900">File</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Content type</dt>
              <dd className="text-slate-700 font-mono">{doc.content_type}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Size</dt>
              <dd className="text-slate-700">{(doc.byte_size / 1024).toFixed(1)} KB</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Upload state</dt>
              <dd className="text-slate-700">{humaniseCode(doc.upload_state)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Scan state</dt>
              <dd className="text-slate-700">{humaniseCode(doc.scan_state)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Downloadable</dt>
              <dd className="text-slate-700">{doc.downloadable ? 'Yes' : 'No'}</dd>
            </div>
            {doc.expires_at && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Expires</dt>
                <dd className="text-slate-700">{formatInstant(doc.expires_at)}</dd>
              </div>
            )}
          </dl>

          {/* Download action */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onDownload}
              disabled={!doc.downloadable || isDownloading}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a3694] transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]">
                {isDownloading ? 'downloading' : 'download'}
              </span>
              {isDownloading ? 'Preparing…' : 'Download file'}
            </button>
            {!doc.downloadable && (
              <p className="text-xs text-slate-400 mt-2">
                This document is not currently downloadable.
              </p>
            )}
            {downloadError && (
              <div
                className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"
                role="alert"
              >
                <p className="text-sm font-bold text-red-700">
                  {downloadError.needsStepUp
                    ? 'Re-authentication required'
                    : downloadError.isForbidden
                      ? 'Permission denied'
                      : downloadError.title}
                </p>
                <p className="text-xs text-red-600 mt-1">
                  {downloadError.needsStepUp
                    ? 'Downloading a verification file requires a recent MFA step-up.'
                    : downloadError.message}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Review history */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-bold text-slate-900">Review</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {doc.reason_code && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Reason</dt>
                <dd className="text-slate-700">{humaniseCode(doc.reason_code)}</dd>
              </div>
            )}
            {doc.reviewer_profile_id && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Reviewer</dt>
                <dd className="text-slate-700 font-mono">{shortId(doc.reviewer_profile_id)}</dd>
              </div>
            )}
            {doc.reviewed_at && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Reviewed at</dt>
                <dd className="text-slate-700">{formatInstant(doc.reviewed_at)}</dd>
              </div>
            )}
            {!doc.reason_code && !doc.reviewer_profile_id && (
              <p className="text-slate-400">No review recorded yet.</p>
            )}
          </dl>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Review action card
// ---------------------------------------------------------------------------

interface ReviewCardProps {
  reviewStatus: ReviewStatus;
  reasonCode: VerificationReasonCode;
  availableReasons: readonly VerificationReasonCode[];
  submitting: boolean;
  reviewError: ApiError | null;
  reviewSuccess: boolean;
  onStatusChange: (status: ReviewStatus) => void;
  onReasonChange: (code: VerificationReasonCode) => void;
  onSubmit: () => void;
}

function ReviewCard({
  reviewStatus,
  reasonCode,
  availableReasons,
  submitting,
  reviewError,
  reviewSuccess,
  onStatusChange,
  onReasonChange,
  onSubmit,
}: ReviewCardProps) {
  const isConflict = reviewError?.isConflict;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6">
      <h2 className="text-xl font-bold text-slate-900">Review decision</h2>
      <p className="text-sm text-slate-500 mt-1">
        Requires MFA step-up. Nobody may review their own document.
      </p>

      {reviewSuccess && (
        <div className="mt-4 rounded-xl bg-green-50 border border-green-100 p-4">
          <p className="text-sm font-bold text-green-700">
            Decision recorded. The document has been updated.
          </p>
        </div>
      )}

      {reviewError && !reviewError.needsStepUp && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-100 p-4">
          <p className="text-sm font-bold text-red-700">
            {isConflict
              ? 'This document was already reviewed by someone else. Reload to see the current state.'
              : `${reviewError.title}: ${reviewError.message}`}
          </p>
          {isConflict && (
            <button
              onClick={() => window.location.reload()}
              className="mt-2 text-sm font-bold text-red-700 underline"
            >
              Reload page
            </button>
          )}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">Decision</label>
          <select
            value={reviewStatus}
            onChange={(e) => onStatusChange(e.target.value as ReviewStatus)}
            disabled={submitting}
            className="w-full h-11 px-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-700"
          >
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseCode(s)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">Reason</label>
          <select
            value={reasonCode}
            onChange={(e) => onReasonChange(e.target.value as VerificationReasonCode)}
            disabled={submitting}
            className="w-full h-11 px-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-700"
          >
            {availableReasons.map((r) => (
              <option key={r} value={r}>
                {humaniseCode(r)}
              </option>
            ))}
          </select>
          {reviewStatus === 'approved' && (
            <p className="text-xs text-slate-400 mt-1">
              An approval may only be justified as a positive verification.
            </p>
          )}
        </div>

        <button
          onClick={onSubmit}
          disabled={submitting}
          className="px-6 h-11 rounded-xl bg-[#1e3fae] text-white font-bold disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit decision'}
        </button>
      </div>
    </section>
  );
}
