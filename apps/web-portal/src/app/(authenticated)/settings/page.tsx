'use client';

/**
 * Organization settings, wired to the real backend at /admin/settings and
 * /admin/maintenance.
 *
 * RECONCILIATION WITH THE PREVIOUS SHELL. The inert shell carried fabricated
 * fields — clinic name, tax ID, address, timezone, currency, date format and a
 * brand-colour picker — none of which the API models as organization settings.
 * They are removed rather than filled with invented values, because a settings
 * field that persists nothing is worse than an honest list of what does persist.
 * The backend exposes a flat key/value setting list with optimistic concurrency
 * (every write quotes `expected_version`), so the page renders exactly those
 * rows as editable fields and saves each one independently.
 *
 * MAINTENANCE MODE is a separate global surface (`/admin/maintenance`) that
 * requires step-up auth, not an organization setting. Disabling it must clear
 * the reason and start time, which the page enforces before sending.
 *
 * Loading, failed and empty are three distinct states — a permission error must
 * never look like an empty settings list. A 403 on settings or maintenance gets
 * no retry button.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import { ApiError } from '@/lib/api/client';
import {
  listOrganizationSettings,
  readPlatformMaintenance,
  updateOrganizationSetting,
  updatePlatformMaintenance,
} from '@/lib/api/administration';
import type {
  OrganizationSetting,
  PlatformMaintenanceState,
} from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import ResourceState from '@/components/data/ResourceState';
import { formatInstant, humaniseCode } from '@/lib/api/directory';

/**
 * Friendly labels for known setting keys. A key the catalogue does not list is
 * shown verbatim, so a newly added setting is never hidden from an editor. The
 * map is not exhaustive on purpose — it labels what exists today.
 */
const SETTING_LABELS: Record<string, string> = {
  clinic_name: 'Clinic name',
  org_name: 'Organization name',
  support_email: 'Support email',
  support_phone: 'Support phone',
  default_locale: 'Default locale',
  default_currency: 'Default currency',
  default_timezone: 'Default timezone',
};

function labelFor(key: string): string {
  return SETTING_LABELS[key] ?? key.replace(/_/g, ' ');
}

interface EditRow {
  /** Working value the editor is typing. */
  draft: string;
  /** Whether this row has been changed away from the stored value. */
  dirty: boolean;
  /** Whether a save is in flight for this row. */
  saving: boolean;
  /** Save error for this row only. */
  error: ApiError | null;
}

export default function SystemSettingsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();

  const { data, isLoading, error, reload } = useApiResource(
    (signal) => listOrganizationSettings(signal),
    [],
  );

  const settings = useMemo(() => data?.data ?? [], [data]);

  // Per-row editor state, keyed by setting_key. Each row carries its own draft,
  // dirty flag and error so saving one setting never blocks editing another.
  const [rows, setRows] = useState<Record<string, EditRow>>({});

  // Hydrate the editor state whenever the loaded list changes (initial load and
  // after a conflict-triggered re-read). Existing drafts are preserved so an
  // in-progress edit is not clobbered by a background re-fetch.
  useEffect(() => {
    setRows((prev) => {
      const next: Record<string, EditRow> = {};
      for (const s of settings) {
        const existing = prev[s.setting_key];
        next[s.setting_key] = {
          draft: existing?.draft ?? s.value,
          dirty: existing ? existing.dirty && existing.draft !== s.value : false,
          saving: false,
          error: null,
        };
      }
      return next;
    });
  }, [settings]);

  const dirtyCount = useMemo(
    () => Object.values(rows).filter((r) => r.dirty).length,
    [rows],
  );

  const updateDraft = useCallback((key: string, value: string) => {
    setRows((prev) => {
      const current = prev[key];
      if (!current) return prev;
      return {
        ...prev,
        [key]: { ...current, draft: value, dirty: true, error: null },
      };
    });
  }, []);

  /**
   * Save one setting. Quotes the version read for that key; on a 409 the whole
   * list is re-read so the version in hand is never stale on retry, and the row
   * is marked with the conflict for an inline message.
   */
  const saveSetting = useCallback(
    async (setting: OrganizationSetting) => {
      const row = rows[setting.setting_key];
      if (!row) return;
      const value = row.draft.trim();
      if (value === setting.value) {
        setRows((prev) => ({
          ...prev,
          [setting.setting_key]: { ...prev[setting.setting_key], dirty: false },
        }));
        return;
      }
      setRows((prev) => ({
        ...prev,
        [setting.setting_key]: { ...prev[setting.setting_key], saving: true, error: null },
      }));
      try {
        await updateOrganizationSetting(setting.setting_key, {
          value,
          expected_version: setting.version,
        });
        // Re-read so the row picks up the new version rather than guessing it.
        reload();
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
        setRows((prev) => ({
          ...prev,
          [setting.setting_key]: { ...prev[setting.setting_key], saving: false, error: apiError },
        }));
        // A conflict means the stored version moved on; re-read to refresh it.
        if (apiError.isConflict) reload();
      }
    },
    [reload, rows],
  );

  /** Reset all dirty drafts back to the stored values. */
  const discardAll = useCallback(() => {
    setRows((prev) => {
      const next: Record<string, EditRow> = {};
      for (const s of settings) {
        next[s.setting_key] = {
          draft: s.value,
          dirty: false,
          saving: false,
          error: null,
        };
      }
      return next;
    });
  }, [settings]);

  // ----------------------------------------------------------- maintenance mode

  // Maintenance is fetched separately because it is a global, step-up-gated
  // surface, not part of the organization settings list. A 403 here is a lack
  // of the `platform.maintenance:manage:global` permission, not step-up.
  const {
    data: maintenance,
    isLoading: isMaintenanceLoading,
    error: maintenanceError,
    reload: reloadMaintenance,
  } = useApiResource((signal) => readPlatformMaintenance(signal), []);

  const [mtSaving, setMtSaving] = useState(false);
  const [mtError, setMtError] = useState<ApiError | null>(null);
  const [mtReason, setMtReason] = useState('');
  const [mtStartsAt, setMtStartsAt] = useState('');

  // Seed the maintenance form fields from the loaded state.
  useEffect(() => {
    if (maintenance) {
      setMtReason(maintenance.reason_code ?? '');
      setMtStartsAt(maintenance.starts_at ?? '');
    }
  }, [maintenance]);

  const toggleMaintenance = useCallback(async () => {
    if (!maintenance) return;
    setMtSaving(true);
    setMtError(null);
    const enabled = !maintenance.enabled;
    try {
      await updatePlatformMaintenance({
        enabled,
        // Disabling must clear the reason and start time, per the backend contract.
        reason_code: enabled ? mtReason.trim() || null : null,
        starts_at: enabled ? mtStartsAt.trim() || null : null,
        expected_version: maintenance.version,
      });
      reloadMaintenance();
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
      setMtError(apiError);
      if (apiError.isConflict) reloadMaintenance();
    } finally {
      setMtSaving(false);
    }
  }, [maintenance, mtReason, mtStartsAt, reloadMaintenance]);

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'General' }]} />

      <div className="flex-1 overflow-y-auto py-5 px-4 sm:px-6 lg:px-12">
        <div className="max-w-[1024px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="System Configuration"
            subtitle="Manage organization settings and platform maintenance state. Each setting saves independently with optimistic concurrency."
          />

          {/* Organization settings list */}
          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={!isLoading && !error && settings.length === 0}
            onRetry={reload}
            loadingLabel="Loading organization settings…"
            forbiddenTitle="Cannot view organization settings"
            errorTitle="Could not load organization settings"
            emptyTitle="No organization settings"
            emptyBody="No settings are configured for this organization yet."
            emptyIcon="settings"
          />

          {!isLoading && !error && settings.length > 0 && (
            <SectionCard title="Organization settings">
              <div className="flex flex-col gap-5">
                {settings.map((setting) => {
                  const row = rows[setting.setting_key];
                  const draft = row?.draft ?? setting.value;
                  const dirty = row?.dirty ?? false;
                  const saving = row?.saving ?? false;
                  const rowError = row?.error ?? null;
                  return (
                    <div key={setting.setting_key} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`setting-${setting.setting_key}`} className="font-semibold text-slate-900">
                          {labelFor(setting.setting_key)}
                        </Label>
                        <span className="text-xs text-slate-400">
                          <code>{setting.setting_key}</code> · v{setting.version}
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <Input
                          id={`setting-${setting.setting_key}`}
                          value={draft}
                          onChange={(e) => updateDraft(setting.setting_key, e.target.value)}
                          disabled={saving}
                          className="flex-1"
                        />
                        <Button
                          size="sm"
                          onClick={() => saveSetting(setting)}
                          disabled={!dirty || saving}
                          className="shrink-0"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                      {rowError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
                          <p className="text-sm font-bold text-red-800">
                            {rowError.isConflict
                              ? 'This setting changed while you were editing'
                              : rowError.needsStepUp
                                ? 'Step-up authentication required'
                                : rowError.title}
                          </p>
                          <p className="text-sm text-red-700 mt-1">
                            {rowError.isConflict
                              ? 'The list has been refreshed with the latest version. Reapply your change.'
                              : rowError.message}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* Maintenance mode — global scope, requires step-up auth */}
          <SectionCard
            title="Platform maintenance mode"
            action={
              maintenance ? (
                <Badge tone={maintenance.enabled ? ('red' as BadgeTone) : ('green' as BadgeTone)}>
                  {maintenance.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              ) : undefined
            }
          >
            {isMaintenanceLoading && (
              <div className="flex flex-col items-center gap-3 py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3fae]"></div>
                <p className="text-sm text-slate-500">Loading maintenance state…</p>
              </div>
            )}

            {!isMaintenanceLoading && maintenanceError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                <p className="font-bold text-slate-900">
                  {maintenanceError.needsStepUp
                    ? 'Step-up authentication required'
                    : maintenanceError.isForbidden
                      ? 'Cannot manage platform maintenance'
                      : 'Could not load maintenance state'}
                </p>
                <p className="text-sm text-slate-600 mt-1">{maintenanceError.message}</p>
                {maintenanceError.needsStepUp && (
                  <p className="text-xs text-slate-500 mt-2">
                    Re-authenticate to obtain a step-up window, then try again.
                  </p>
                )}
                {!maintenanceError.isForbidden && (
                  <Button variant="outline" size="sm" onClick={reloadMaintenance} className="mt-4">
                    Try again
                  </Button>
                )}
              </div>
            )}

            {!isMaintenanceLoading && !maintenanceError && maintenance && (
              <div className="flex flex-col gap-5">
                <p className="text-sm text-slate-600">
                  Maintenance mode restricts the platform to administrators. It is a global
                  setting that requires step-up authentication to change. Disabling it clears
                  the reason and start time.
                </p>

                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                  <span>
                    Status: <Badge tone={maintenance.enabled ? 'red' : 'green'}>
                      {maintenance.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </span>
                  {maintenance.reason_code && (
                    <span>Reason: <code>{humaniseCode(maintenance.reason_code)}</code></span>
                  )}
                  {maintenance.starts_at && (
                    <span>Since: {formatInstant(maintenance.starts_at)}</span>
                  )}
                  <span>Updated: {formatInstant(maintenance.updated_at)}</span>
                </div>

                {maintenance.enabled ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-semibold text-slate-900">
                      Maintenance is currently enabled. Disable it to restore normal access.
                    </p>
                    <Button
                      variant="destructive"
                      onClick={toggleMaintenance}
                      disabled={mtSaving}
                      className="w-fit"
                    >
                      {mtSaving ? 'Disabling…' : 'Disable maintenance'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="mt-reason" className="font-semibold text-slate-900">
                        Reason code
                      </Label>
                      <Input
                        id="mt-reason"
                        placeholder="e.g. scheduled_upgrade"
                        value={mtReason}
                        onChange={(e) => setMtReason(e.target.value)}
                        disabled={mtSaving}
                      />
                      <p className="text-xs text-slate-500">
                        A short code describing why maintenance is being enabled.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="mt-starts" className="font-semibold text-slate-900">
                        Start time (optional)
                      </Label>
                      <Input
                        id="mt-starts"
                        type="datetime-local"
                        value={mtStartsAt}
                        onChange={(e) => setMtStartsAt(e.target.value)}
                        disabled={mtSaving}
                      />
                    </div>
                    <Button onClick={toggleMaintenance} disabled={mtSaving} className="w-fit">
                      {mtSaving ? 'Enabling…' : 'Enable maintenance'}
                    </Button>
                  </div>
                )}

                {mtError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                    <p className="text-sm font-bold text-red-800">
                      {mtError.needsStepUp
                        ? 'Step-up authentication required'
                        : mtError.isConflict
                          ? 'The maintenance state changed while you were editing'
                          : mtError.title}
                    </p>
                    <p className="text-sm text-red-700 mt-1">
                      {mtError.isConflict
                        ? 'The state has been refreshed. Reapply your change.'
                        : mtError.message}
                    </p>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* Sticky discard bar — reflects only the settings list, not maintenance. */}
          {settings.length > 0 && (
            <div className="sticky bottom-0 -mx-4 sm:-mx-6 lg:-mx-12 w-[calc(100%+2rem)] sm:w-[calc(100%+3rem)] lg:w-[calc(100%+6rem)] bg-white border-t border-slate-200 p-4 shadow-lg z-20">
              <div className="max-w-[1024px] mx-auto flex items-center justify-between">
                <div className="text-sm text-slate-500">
                  {dirtyCount > 0
                    ? `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`
                    : 'All changes saved'}
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={discardAll} disabled={dirtyCount === 0}>
                    Discard
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
