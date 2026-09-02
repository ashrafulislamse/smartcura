'use client';

/**
 * Emergency system settings, wired to GET /admin/settings and PUT /admin/settings/{key}.
 *
 * The backend exposes a generic key-value organization settings store. This page reads the
 * full list and lets an administrator update any setting's value inline. Each write quotes
 * the version read from the server for optimistic concurrency; a concurrent edit by another
 * administrator is refused with 409 and the page prompts a reload rather than retrying the
 * stale version.
 *
 * RECONCILIATION WITH THE MOCK: the mock carried audio volume sliders, visual notification
 * toggles, response-time targets, auto-dispatch radius, zone configurations, and integration
 * status panels — none of which map to the real settings API. The real API is a flat
 * key-value store: each setting has a `setting_key`, a `value` (string), and a `version`.
 * What keys exist depends on what the backend has been configured with, so this page renders
 * whatever the server returns rather than hardcoding a fixed set of controls.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import {
  listOrganizationSettings,
  updateOrganizationSetting,
} from '@/lib/api/administration';
import { ApiError } from '@/lib/api/client';
import { humaniseCode } from '@/lib/api/directory';
import type { OrganizationSetting } from '@/types/contracts';

/** Per-row edit state. The version comes from the last read. */
interface RowEdit {
  value: string;
  expectedVersion: number;
  saving: boolean;
  error: string;
  saved: boolean;
}

export default function EmergencySettingsPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { data, isLoading, error, reload } = useApiResource(
    (signal) => listOrganizationSettings(signal),
    [],
  );

  const settings = useMemo(() => data?.data ?? [], [data]);

  // Track edits per setting key.
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});

  const getEdit = (setting: OrganizationSetting): RowEdit =>
    edits[setting.setting_key] ?? {
      value: setting.value,
      expectedVersion: setting.version,
      saving: false,
      error: '',
      saved: false,
    };

  const setEdit = (key: string, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch } as RowEdit,
    }));
  };

  const handleSave = async (setting: OrganizationSetting) => {
    const edit = getEdit(setting);
    if (edit.value === setting.value) return;
    setEdit(setting.setting_key, { saving: true, error: '', saved: false });
    try {
      const result = await updateOrganizationSetting(setting.setting_key, {
        value: edit.value,
        expected_version: edit.expectedVersion,
      });
      // The response carries the new version; update the edit state so a second
      // edit on the same key uses the correct version without a full reload.
      setEdit(setting.setting_key, {
        saving: false,
        saved: true,
        expectedVersion: result.version,
        error: '',
      });
      // Clear the saved indicator after 2 seconds.
      setTimeout(() => {
        setEdits((prev) => ({
          ...prev,
          [setting.setting_key]: { ...prev[setting.setting_key]!, saved: false },
        }));
      }, 2000);
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected error' });
      if (apiError.needsStepUp) {
        router.push('/2fa');
        return;
      }
      if (apiError.isConflict) {
        setEdit(setting.setting_key, {
          saving: false,
          error: 'Another editor changed this setting. Reload to see the current value.',
        });
      } else {
        setEdit(setting.setting_key, {
          saving: false,
          error: apiError.message || apiError.title,
        });
      }
    }
  };

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Emergency' }, { label: 'System settings' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1000px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                System Settings
              </h1>
              <p className="text-slate-500 mt-1">
                Organization-wide settings for the emergency dispatch system.
              </p>
            </div>
            <button
              onClick={reload}
              className="px-4 py-2.5 border border-slate-200 bg-white rounded-lg font-bold text-sm text-slate-700 hover:bg-slate-50"
            >
              Reload
            </button>
          </div>

          <ResourceState
            isLoading={isLoading}
            error={error}
            isEmpty={settings.length === 0}
            onRetry={reload}
            loadingLabel="Loading settings…"
            forbiddenTitle="You cannot view system settings"
            errorTitle="Could not load settings"
            emptyTitle="No settings configured"
            emptyBody="No organization settings have been defined yet."
            emptyIcon="settings"
          />

          {!isLoading && !error && settings.length > 0 && (
            <div className="flex flex-col gap-3">
              {settings.map((setting) => {
                const edit = getEdit(setting);
                const dirty = edit.value !== setting.value;
                return (
                  <div
                    key={setting.setting_key}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm p-5"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">
                          {humaniseCode(setting.setting_key)}
                        </h3>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          {setting.setting_key} · v{setting.version}
                        </p>
                      </div>
                      {edit.saved && (
                        <span className="text-xs font-bold text-green-700 bg-green-50 border border-green-100 px-2 py-1 rounded-full">
                          Saved
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="text"
                        value={edit.value}
                        onChange={(e) =>
                          setEdit(setting.setting_key, {
                            value: e.target.value,
                            expectedVersion: edit.expectedVersion,
                            saving: false,
                            error: '',
                            saved: false,
                          })
                        }
                        className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal focus:border-[#1e3fae] focus:outline-none focus:ring-1 focus:ring-[#1e3fae]"
                        placeholder="Setting value"
                      />
                      <button
                        disabled={!dirty || edit.saving}
                        onClick={() => handleSave(setting)}
                        className="px-5 py-2 rounded-lg bg-[#1e3fae] text-white font-bold text-sm disabled:opacity-50 hover:bg-[#1a3694] transition-colors whitespace-nowrap"
                      >
                        {edit.saving ? 'Saving…' : 'Update'}
                      </button>
                    </div>

                    {edit.error && (
                      <p className="text-sm text-red-600 mt-2" role="alert">
                        {edit.error}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!isLoading && !error && settings.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              <span className="font-bold text-slate-900">{settings.length}</span> setting
              {settings.length === 1 ? '' : 's'} configured. Each update is versioned for
              optimistic concurrency — a concurrent edit by another administrator is refused
              rather than overwritten.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
