'use client';

import { useEffect, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import ResourceState from '@/components/data/ResourceState';
import { useApiResource } from '@/hooks/use-api-resource';
import { getMyProfile, updateMyProfile } from '@/lib/api/settings';

export default function ProfileSettingsPage() {
  const { data, isLoading, error, reload } = useApiResource((signal) => getMyProfile(signal), []);
  const [form, setForm] = useState({ display_name: '', phone_e164: '', preferred_locale: '', timezone: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) setForm({ display_name: data.display_name, phone_e164: data.phone_e164 ?? '', preferred_locale: data.preferred_locale, timezone: data.timezone }); }, [data]);
  const save = async () => { setSaving(true); setSaved(false); try { await updateMyProfile({ ...form, phone_e164: form.phone_e164 || null }); setSaved(true); reload(); } finally { setSaving(false); } };
  return <main className="flex-1 overflow-y-auto bg-[#F8F9FC]"><TopBar breadcrumbs={[{ label: 'Settings' }, { label: 'Profile' }]} /><div className="max-w-3xl mx-auto p-8"><h1 className="text-3xl font-bold text-slate-900">Profile settings</h1><p className="mt-2 text-slate-500">Update the profile associated with your current session.</p><ResourceState isLoading={isLoading} error={error} isEmpty={!data} onRetry={reload} loadingLabel="Loading profile..." forbiddenTitle="Profile access denied" errorTitle="Could not load profile" emptyIcon="person" emptyTitle="Profile unavailable" emptyBody="Your profile could not be loaded." />{data && !error && <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 space-y-5"><label className="block text-sm font-semibold">Display name<input className="mt-2 w-full rounded-lg border border-slate-300 p-3" value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} /></label><label className="block text-sm font-semibold">Email (read only)<input className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 p-3" value={data.email} disabled /></label><label className="block text-sm font-semibold">Phone number<input className="mt-2 w-full rounded-lg border border-slate-300 p-3" value={form.phone_e164} onChange={e => setForm({ ...form, phone_e164: e.target.value })} /></label><div className="grid grid-cols-2 gap-4"><label className="text-sm font-semibold">Locale<input className="mt-2 w-full rounded-lg border border-slate-300 p-3" value={form.preferred_locale} onChange={e => setForm({ ...form, preferred_locale: e.target.value })} /></label><label className="text-sm font-semibold">Timezone<input className="mt-2 w-full rounded-lg border border-slate-300 p-3" value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} /></label></div><button onClick={save} disabled={saving} className="rounded-lg bg-[#1e3fae] px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save changes'}</button>{saved && <span className="ml-3 text-sm text-green-700">Saved</span>}</section>}</div></main>;
}
