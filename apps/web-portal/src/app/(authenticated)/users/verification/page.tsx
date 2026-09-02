'use client';

/**
 * Verification queue, wired to GET /organizations/{id}/verification-queue.
 *
 * RECONCILIATION WITH THE PREVIOUS MOCK. `mockVerificationQueue` carried a
 * free-text `licenseNumber`, `education`, `experience` and a `documents[]`
 * array — none of which the queue endpoint returns. The queue is a triage
 * surface: provider name, document kind, status, submitted date and version.
 * The full document metadata (file size, scan state, downloadability) lives
 * on the detail page, fetched via `listVerificationDocuments`. Those invented
 * fields are removed rather than approximated.
 *
 * STATUS BADGES use `VERIFICATION_STYLE` (exhaustive over the generated enum)
 * so `approved` is visually distinct from `rejected`. The previous version
 * hardcoded amber for every status, making them indistinguishable.
 *
 * ORDERING is server-side: `pending_review` rows first, then by submission
 * date. The backend promotes urgency over recency (AGENTS.md lists rule).
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import type { VerificationStatus } from '@/types/contracts';
import { listVerificationQueue } from '@/lib/api/workstream-f';

/** Filters matching the reviewer-assignable vocabulary. `not_submitted` never appears on a document row. */
const FILTERS: readonly ('' | VerificationStatus)[] = [
  '',
  'pending_review',
  'changes_requested',
  'approved',
  'rejected',
  'suspended',
  'expired',
];

export default function VerificationPage() {
  const { activeMembership, isLoading: authLoading } = useAuth();
  const organizationId = activeMembership?.organization_id;
  const router = useRouter();
  const [status, setStatus] = useState<'' | VerificationStatus>('');

  const resource = useApiResource(
    (signal) =>
      organizationId
        ? listVerificationQueue(organizationId, { status: status || undefined, limit: 100, signal })
        : Promise.resolve(null),
    [organizationId, status],
  );

  const rows = useMemo(() => resource.data?.data ?? [], [resource.data]);

  // KPI stat cards — derived from the full row set, not the filtered view.
  const stats = useMemo(() => {
    const pending = rows.filter((r) => r.status === 'pending_review').length;
    const changes = rows.filter((r) => r.status === 'changes_requested').length;
    const approved = rows.filter((r) => r.status === 'approved').length;
    return { pending, changes, approved };
  }, [rows]);

  if (authLoading) return <div className="p-8 text-slate-500">Loading session...</div>;

  if (!organizationId)
    return (
      <main className="p-8">
        <ResourceState
          isLoading={false}
          error={null}
          isEmpty
          onRetry={resource.reload}
          loadingLabel="Loading verification queue..."
          forbiddenTitle="Verification unavailable"
          errorTitle="Verification unavailable"
          emptyTitle="No active organization"
          emptyBody="Select an active membership before viewing the queue."
          emptyIcon="verified_user"
        />
      </main>
    );

  return (
    <main className="flex-1 min-h-screen bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Users' }, { label: 'Verification queue' }]} />
      <div className="p-5 sm:p-8 max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Verification queue</h1>
          <p className="text-slate-500 mt-1">
            Review submitted provider verification documents.
          </p>
        </div>

        {/* KPI stat cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <p className="text-3xl font-black text-amber-600">{stats.pending}</p>
            <p className="text-sm text-slate-500 mt-1">Pending review</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <p className="text-3xl font-black text-orange-600">{stats.changes}</p>
            <p className="text-sm text-slate-500 mt-1">Changes requested</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <p className="text-3xl font-black text-green-600">{stats.approved}</p>
            <p className="text-sm text-slate-500 mt-1">Approved</p>
          </div>
        </div>

        {/* Status filter */}
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map((value) => (
            <button
              key={value}
              onClick={() => setStatus(value)}
              className={`px-4 py-2 rounded-full text-sm font-bold ${
                status === value
                  ? 'bg-[#1e3fae] text-white'
                  : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              {value ? humaniseCode(value) : 'All'}
            </button>
          ))}
        </div>

        <ResourceState
          isLoading={resource.isLoading}
          error={resource.error}
          isEmpty={!rows.length}
          onRetry={resource.reload}
          loadingLabel="Loading verification queue..."
          forbiddenTitle="You cannot view verification documents"
          errorTitle="Verification queue could not be loaded"
          emptyTitle="Queue is clear"
          emptyBody="No verification documents match this filter."
          emptyIcon="task_alt"
        />

        {!resource.isLoading && !resource.error && rows.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-4">Provider</th>
                  <th className="p-4">Document</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Submitted</th>
                  <th className="p-4">Version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr
                    key={row.document_id}
                    className="hover:bg-blue-50/40 cursor-pointer"
                    onClick={() =>
                      router.push(
                        `/users/verification/${row.document_id}?m=${row.membership_id}`,
                      )
                    }
                  >
                    <td className="p-4">
                      <div className="font-bold text-slate-900">{row.display_name}</div>
                      <code className="text-xs text-slate-400">{shortId(row.profile_id)}</code>
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      {humaniseCode(row.document_kind)}
                    </td>
                    <td className="p-4">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-bold ${
                          VERIFICATION_STYLE[
                            row.status as keyof typeof VERIFICATION_STYLE
                          ] ?? 'bg-slate-50 text-slate-600 border-slate-100'
                        }`}
                      >
                        {humaniseCode(row.status)}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-500">
                      {formatInstant(row.submitted_at)}
                    </td>
                    <td className="p-4 text-sm text-slate-500">{row.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
