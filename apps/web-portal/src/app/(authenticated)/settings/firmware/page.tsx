'use client';

/**
 * Firmware rollout management, wired to the real backend at /firmware/rollouts.
 *
 * There is no list endpoint for rollouts — the backend only exposes create
 * (`POST /firmware/rollouts`) and read-one. So this page keeps the rollouts
 * created during the current session in component state (newest first) and
 * renders the details the create response returns (rollout_id, status, version,
 * created_at). A refresh clears the list because there is nothing to rehydrate
 * from.
 *
 * AUTHORITY. Creating a rollout requires `iot.firmware:manage:global` — a
 * super-admin permission. A 403 is surfaced as a clear "You do not have
 * authority to manage firmware rollouts" message rather than a generic error,
 * and gets no retry button because retrying an authorization failure cannot
 * succeed.
 *
 * The creation form offers only `draft`, `scheduled` and `active` because the
 * other statuses (`paused`, `completed`, `failed`, `cancelled`) are worker- or
 * operator-driven transitions, not initial states an admin picks at creation.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api/client';
import { createFirmwareRollout } from '@/lib/api/administration';
import type {
  CreateFirmwareRolloutRequest,
  FirmwareRollout,
  FirmwareRolloutStatus,
} from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';

/**
 * Statuses an admin may choose at creation. The full `FirmwareRolloutStatus`
 * union includes worker/operator transitions that are not valid initial states,
 * so the select is narrowed to these three on purpose.
 */
const CREATION_STATUSES = ['draft', 'scheduled', 'active'] as const;
type CreationStatus = (typeof CREATION_STATUSES)[number];

function rolloutStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'active':
      return 'blue';
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'cancelled':
    case 'paused':
      return 'amber';
    case 'draft':
    case 'scheduled':
    default:
      return 'slate';
  }
}

export default function FirmwareManagementPage() {
  const { user, activeMembership, isLoading: isAuthLoading } = useAuth();

  // Rollouts created this session, newest first. Not persisted.
  const [rollouts, setRollouts] = useState<FirmwareRollout[]>([]);

  // Create-form state.
  const [firmwareVersionId, setFirmwareVersionId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [status, setStatus] = useState<CreationStatus>('draft');
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Seed the organization field from the active membership once it is known,
  // without clobbering a value the user has already typed.
  useEffect(() => {
    if (activeMembership?.organization_id && organizationId === '') {
      setOrganizationId(activeMembership.organization_id);
    }
  }, [activeMembership, organizationId]);

  const resetForm = () => {
    setFirmwareVersionId('');
    setStatus('draft');
    setScheduledAt('');
    // Keep the organization id; it is derived from the session, not the request.
  };

  const formInvalid = useMemo(
    () => firmwareVersionId.trim() === '' || organizationId.trim() === '',
    [firmwareVersionId, organizationId],
  );

  async function submitRollout() {
    if (busy) return;
    const versionId = firmwareVersionId.trim();
    const orgId = organizationId.trim();
    if (versionId === '' || orgId === '') {
      setError(
        new ApiError({
          status: 0,
          code: 'CLIENT_ERROR',
          title: 'Firmware version and organization are required',
          detail: 'Provide both a firmware version id and an organization id before creating a rollout.',
        }),
      );
      return;
    }

    // datetime-local yields a local "YYYY-MM-DDTHH:mm" string; convert to an
    // ISO-8601 instant for the backend, or null when unscheduled.
    const scheduledAtIso = scheduledAt ? new Date(scheduledAt).toISOString() : null;

    const body: CreateFirmwareRolloutRequest = {
      firmware_version_id: versionId,
      organization_id: orgId,
      status: status as FirmwareRolloutStatus,
      scheduled_at: scheduledAtIso,
    };

    setBusy(true);
    setError(null);
    try {
      const created = await createFirmwareRollout(body, crypto.randomUUID());
      setRollouts((prev) => [created, ...prev]);
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
      <TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'Firmware Management' }]} />

      <div className="flex-1 overflow-y-auto py-5 px-4 sm:px-6 lg:px-12">
        <div className="max-w-[1024px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Firmware Management"
            subtitle="Manage device firmware rollouts. Creating a rollout schedules which firmware version devices in an organization should run."
          />

          {/* Request form */}
          <SectionCard title="Create a rollout">
            <div className="flex flex-col gap-5">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-800">
                  Firmware rollouts require super-admin authority{' '}
                  (<code>iot.firmware:manage:global</code>).
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="fw-version" className="font-semibold text-slate-900">
                  Firmware version id
                </Label>
                <Input
                  id="fw-version"
                  placeholder="e.g. 01a01232-a19f-7fe6-8322-138e65df39c9"
                  value={firmwareVersionId}
                  onChange={(e) => setFirmwareVersionId(e.target.value)}
                  disabled={busy}
                />
                <p className="text-xs text-slate-500">
                  The registered firmware version to roll out. The version id is
                  created in the firmware version registry first.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="fw-org" className="font-semibold text-slate-900">
                  Organization id
                </Label>
                <Input
                  id="fw-org"
                  placeholder="e.g. 01a01232-a19f-7fe6-8322-138e65df39c9"
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  disabled={busy}
                />
                <p className="text-xs text-slate-500">
                  Pre-filled from your active membership. A super-admin may target
                  a different organization.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="fw-status" className="font-semibold text-slate-900">
                  Initial status
                </Label>
                <select
                  id="fw-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as CreationStatus)}
                  disabled={busy}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {CREATION_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {humaniseCode(option)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  Only <code>draft</code>, <code>scheduled</code> and{' '}
                  <code>active</code> are valid initial states. Other statuses are
                  worker- or operator-driven transitions.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="fw-scheduled" className="font-semibold text-slate-900">
                  Scheduled time (optional)
                </Label>
                <Input
                  id="fw-scheduled"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  disabled={busy}
                />
                <p className="text-xs text-slate-500">
                  Required in spirit when the status is <code>scheduled</code>.
                  Leave blank for an immediate <code>draft</code> or{' '}
                  <code>active</code> rollout.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={submitRollout} disabled={busy || formInvalid} className="w-fit">
                  {busy ? 'Creating…' : 'Create Rollout'}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetForm}
                  disabled={busy || (firmwareVersionId === '' && scheduledAt === '' && status === 'draft')}
                >
                  Clear
                </Button>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                  <p className="text-sm font-bold text-red-800">
                    {error.isForbidden
                      ? 'You do not have authority to manage firmware rollouts'
                      : error.needsStepUp
                        ? 'Step-up authentication required'
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

          {/* Session rollout list — in-memory only; no list endpoint exists. */}
          <SectionCard title="Created this session">
            {rollouts.length === 0 ? (
              <p className="text-sm text-slate-500">
                No rollouts created yet this session. The list clears on refresh
                because the backend does not expose a list endpoint.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {rollouts.map((rollout) => (
                  <div
                    key={rollout.rollout_id}
                    className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 flex flex-col gap-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            Rollout {shortId(rollout.rollout_id)}
                          </span>
                          <Badge tone={rolloutStatusTone(rollout.status)}>
                            {humaniseCode(rollout.status)}
                          </Badge>
                          <span className="text-xs text-slate-500">v{rollout.version}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <code>{rollout.rollout_id}</code>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                      <span>
                        Firmware version:{' '}
                        <code className="text-xs">{shortId(rollout.firmware_version_id)}</code>
                      </span>
                      <span>
                        Organization:{' '}
                        <code className="text-xs">{shortId(rollout.organization_id)}</code>
                      </span>
                      <span>
                        Scheduled: <span className="font-bold text-slate-900">
                          {formatInstant(rollout.scheduled_at)}
                        </span>
                      </span>
                      <span>
                        Created: <span className="font-bold text-slate-900">
                          {formatInstant(rollout.created_at)}
                        </span>
                      </span>
                      <span>
                        Updated: <span className="font-bold text-slate-900">
                          {formatInstant(rollout.updated_at)}
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </main>
  );
}
