'use client';

/**
 * Bulk data export requests, wired to the real backend at /admin/exports.
 *
 * There is no list endpoint for export jobs — the backend only exposes
 * create (`POST /admin/exports`) and read-one (`GET /admin/exports/{id}`). So
 * this page keeps the jobs requested during the current session in component
 * state (newest first), seeds each entry with the `queued` status the create
 * response confirms, then polls `readExportJob` every 3 seconds until the job
 * reaches a terminal status (`completed`, `failed`, `expired`, `cancelled`).
 * The interval is torn down when no job is still pending and on unmount.
 *
 * DOWNLOAD AVAILABILITY IS NOT A DOWNLOAD URL. `ExportJobView` carries only a
 * `downloadable: boolean` and the OpenAPI exposes no `/admin/exports/{id}/download`
 * route, so a "ready" indicator is rendered rather than a fabricated link that
 * would 404. When the API gains a download capability, this is the single place
 * to wire it.
 *
 * Loading, failed and empty are distinct states. A 403 on the create is a lack
 * of the bulk-disclosure authority (or a missing step-up window), not an empty
 * list, and gets no retry button.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api/client';
import { requestExport, readExportJob } from '@/lib/api/administration';
import type { ExportJobView } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { humaniseCode, shortId } from '@/lib/api/directory';

/** Statuses after which polling stops — the worker will not change them again. */
const TERMINAL_EXPORT_STATUSES = new Set([
  'completed',
  'failed',
  'expired',
  'cancelled',
]);

const POLL_INTERVAL_MS = 3000;

const DATASET_EXAMPLES = ['patients', 'appointments', 'prescriptions', 'vitals'];
const PURPOSE_EXAMPLES = ['analytics', 'compliance', 'research', 'audit'];

function exportStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'completed':
      return 'green';
    case 'running':
      return 'blue';
    case 'failed':
      return 'red';
    case 'expired':
    case 'cancelled':
      return 'amber';
    case 'queued':
    default:
      return 'slate';
  }
}

function isTerminalExportStatus(status: string): boolean {
  return TERMINAL_EXPORT_STATUSES.has(status);
}

interface JobEntry {
  exportJobId: string;
  datasetCode: string;
  purposeCode: string;
  /** Latest snapshot from `readExportJob`; seeded from the create response. */
  view: ExportJobView | null;
  /** Set when a poll failed for a reason other than unmount abort. */
  pollError: ApiError | null;
}

/** A job still needs polling while it has no error and a non-terminal status. */
function jobIsPending(job: JobEntry): boolean {
  if (job.pollError) return false;
  if (job.view === null) return true;
  return !isTerminalExportStatus(job.view.status);
}

export default function DataExportsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();

  // Jobs requested this session, newest first. Not persisted — a refresh clears
  // the list because there is no list endpoint to rehydrate from.
  const [jobs, setJobs] = useState<JobEntry[]>([]);

  // Create-form state.
  const [datasetCode, setDatasetCode] = useState('');
  const [purposeCode, setPurposeCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const hasPending = useMemo(() => jobs.some(jobIsPending), [jobs]);

  // Poll every non-terminal job on a single interval. The interval runs only
  // while at least one job is pending; when the last one settles the effect
  // cleans up. The interval is recreated only when `hasPending` flips, so a
  // status refresh that does not change terminality does not reset the clock.
  useEffect(() => {
    if (!hasPending) return;

    const controller = new AbortController();

    const pollOnce = () => {
      void Promise.all(
        jobs.map(async (job) => {
          if (!jobIsPending(job)) return;
          try {
            const view = await readExportJob(job.exportJobId, controller.signal);
            setJobs((prev) =>
              prev.map((j) =>
                j.exportJobId === job.exportJobId
                  ? { ...j, view, pollError: null }
                  : j,
              ),
            );
          } catch (caught) {
            // Aborts come from unmount / effect teardown — not an error to show.
            if (controller.signal.aborted) return;
            const apiError =
              caught instanceof ApiError
                ? caught
                : new ApiError({
                    status: 0,
                    code: 'CLIENT_ERROR',
                    title: 'Unexpected client error',
                    detail: caught instanceof Error ? caught.message : String(caught),
                  });
            setJobs((prev) =>
              prev.map((j) =>
                j.exportJobId === job.exportJobId ? { ...j, pollError: apiError } : j,
              ),
            );
          }
        }),
      );
    };

    const interval = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [hasPending, jobs]);

  const resetForm = () => {
    setDatasetCode('');
    setPurposeCode('');
  };

  async function submitExport() {
    if (busy) return;
    const dataset = datasetCode.trim();
    const purpose = purposeCode.trim();
    if (dataset === '' || purpose === '') {
      setError(
        new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'Dataset and purpose are required',
          detail: 'Provide both a dataset code and a purpose code before requesting an export.',
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await requestExport(
        { dataset_code: dataset, purpose_code: purpose },
        crypto.randomUUID(),
      );
      // Seed the entry from the create response — it confirms `status: 'queued'`,
      // so the user sees progress immediately while the first poll is in flight.
      const seedView: ExportJobView = {
        export_job_id: created.export_job_id,
        status: created.status,
        row_count: null,
        downloadable: false,
      };
      setJobs((prev) => [
        {
          exportJobId: created.export_job_id,
          datasetCode: dataset,
          purposeCode: purpose,
          view: seedView,
          pollError: null,
        },
        ...prev,
      ]);
      resetForm();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({
              status: 0,
              code: 'CLIENT_ERROR',
              title: 'Unexpected client error',
              detail: caught instanceof Error ? caught.message : String(caught),
            });
      setError(apiError);
    } finally {
      setBusy(false);
    }
  }

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'Data Exports' }]} />

      <div className="flex-1 overflow-y-auto py-5 px-4 sm:px-6 lg:px-12">
        <div className="max-w-[1024px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Data Exports"
            subtitle="Request bulk data exports. Each request is recorded with who asked and why, and requires recent step-up authentication."
          />

          {/* Request form */}
          <SectionCard title="Request an export">
            <div className="flex flex-col gap-5">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-800">
                  Exports contain sensitive data. Access is audited.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="export-dataset" className="font-semibold text-slate-900">
                  Dataset code
                </Label>
                <Input
                  id="export-dataset"
                  placeholder="e.g. patients"
                  value={datasetCode}
                  onChange={(e) => setDatasetCode(e.target.value)}
                  disabled={busy}
                />
                <p className="text-xs text-slate-500">
                  The dataset to export. Examples:{' '}
                  {DATASET_EXAMPLES.map((example, index) => (
                    <span key={example}>
                      <code>{example}</code>
                      {index < DATASET_EXAMPLES.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                  .
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="export-purpose" className="font-semibold text-slate-900">
                  Purpose code
                </Label>
                <Input
                  id="export-purpose"
                  placeholder="e.g. compliance"
                  value={purposeCode}
                  onChange={(e) => setPurposeCode(e.target.value)}
                  disabled={busy}
                />
                <p className="text-xs text-slate-500">
                  Why this export is being requested. Examples:{' '}
                  {PURPOSE_EXAMPLES.map((example, index) => (
                    <span key={example}>
                      <code>{example}</code>
                      {index < PURPOSE_EXAMPLES.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                  .
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={submitExport} disabled={busy} className="w-fit">
                  {busy ? 'Requesting…' : 'Request Export'}
                </Button>
                <Button variant="outline" onClick={resetForm} disabled={busy || (datasetCode === '' && purposeCode === '')}>
                  Clear
                </Button>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                  <p className="text-sm font-bold text-red-800">
                    {error.needsStepUp
                      ? 'Step-up authentication required'
                      : error.isForbidden
                        ? 'You do not have authority to request exports'
                        : error.title}
                  </p>
                  <p className="text-sm text-red-700 mt-1">{error.message}</p>
                  {error.needsStepUp && (
                    <p className="text-xs text-slate-500 mt-2">
                      Re-authenticate to obtain a step-up window, then try again.
                    </p>
                  )}
                  {error.correlationId && (
                    <p className="text-xs text-slate-400 mt-2">
                      Reference: <code>{error.correlationId}</code>
                    </p>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Session job list — in-memory only; no list endpoint exists. */}
          <SectionCard title="Requested this session">
            {jobs.length === 0 ? (
              <p className="text-sm text-slate-500">
                No export jobs requested yet this session. The list clears on
                refresh because the backend does not expose a list endpoint.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-xs text-slate-500">
                  Jobs requested in this browser session. Polling continues every{' '}
                  {POLL_INTERVAL_MS / 1000}s until each job reaches a terminal status.
                </p>
                {jobs.map((job) => {
                  const status = job.view?.status ?? 'queued';
                  const pending = jobIsPending(job);
                  return (
                    <div
                      key={job.exportJobId}
                      className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 flex flex-col gap-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">
                              {humaniseCode(job.datasetCode)}
                            </span>
                            <span className="text-slate-400">·</span>
                            <span className="text-sm text-slate-600">
                              purpose: <code>{job.purposeCode}</code>
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <code>{shortId(job.exportJobId)}</code>
                            <span className="text-slate-400">·</span>
                            <span>id: <code>{job.exportJobId}</code></span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={exportStatusTone(status)}>
                            {pending ? `${humaniseCode(status)}…` : humaniseCode(status)}
                          </Badge>
                          {job.view?.downloadable && (
                            <Badge tone="green">Ready</Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                        {job.view && (
                          <span>
                            Rows:{' '}
                            <span className="font-bold text-slate-900">
                              {job.view.row_count === null ? '—' : job.view.row_count.toLocaleString()}
                            </span>
                          </span>
                        )}
                        {job.view?.downloadable && (
                          <span className="text-green-700">
                            The export file is available to administrators.
                          </span>
                        )}
                        {pending && (
                          <span className="flex items-center gap-2 text-slate-500">
                            <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-[#1e3fae]"></span>
                            Polling for progress…
                          </span>
                        )}
                      </div>

                      {job.pollError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
                          <p className="text-xs font-bold text-red-800">
                            Could not refresh this job
                          </p>
                          <p className="text-xs text-red-700 mt-1">{job.pollError.message}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </main>
  );
}
