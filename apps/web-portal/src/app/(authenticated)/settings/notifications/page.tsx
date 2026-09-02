'use client';

import { useMemo, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import ResourceState from '@/components/data/ResourceState';
import { useApiResource } from '@/hooks/use-api-resource';
import { listNotificationPreferences, updateNotificationPreference } from '@/lib/api/settings';
import type { NotificationPreference } from '@/types/contracts';

export default function NotificationSettingsPage() {
  const { data, isLoading, error, reload } = useApiResource((signal) => listNotificationPreferences(signal), []);
  const [saving, setSaving] = useState<string | null>(null);
  const preferences = useMemo(() => data?.data ?? [], [data]);
  const toggle = async (preference: NotificationPreference) => { setSaving(`${preference.category}:${preference.channel}`); try { await updateNotificationPreference({ ...preference, enabled: !preference.enabled }); reload(); } finally { setSaving(null); } };
  return <main className="flex-1 overflow-y-auto bg-[#F9FAFB]"><TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'Notifications' }]} /><div className="max-w-3xl mx-auto p-8"><h1 className="text-3xl font-bold text-slate-900">Notification preferences</h1><p className="mt-2 text-slate-500">Choose which notification categories are enabled for each supported channel.</p><ResourceState isLoading={isLoading} error={error} isEmpty={preferences.length === 0} onRetry={reload} loadingLabel="Loading preferences..." forbiddenTitle="Notification access denied" errorTitle="Could not load preferences" emptyIcon="notifications" emptyTitle="No preferences configured" emptyBody="Notification preferences are not available for this account." />{!isLoading && !error && preferences.length > 0 && <div className="mt-6 divide-y rounded-xl border border-slate-200 bg-white">{preferences.map((preference) => { const key = `${preference.category}:${preference.channel}`; return <div key={key} className="flex items-center justify-between p-5"><div><p className="font-semibold text-slate-900">{preference.category}</p><p className="text-sm text-slate-500">{preference.channel} channel</p></div><button onClick={() => toggle(preference)} disabled={saving === key} aria-pressed={preference.enabled} className={`rounded-full px-4 py-2 text-sm font-bold ${preference.enabled ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{saving === key ? 'Saving...' : preference.enabled ? 'Enabled' : 'Disabled'}</button></div>; })}</div>}</div></main>;
}
