'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import StatCard from '@/components/ui/stat-card';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import SearchInput from '@/components/ui/search-input';
import {
  listDoctorTemplates,
  createDoctorTemplate,
  deriveTemplateType,
  deriveSectionFieldSummary,
  TEMPLATE_TYPE_LABEL,
  TEMPLATE_TYPE_TONE,
  type TemplateType,
  type UiTone,
} from '@/lib/api/doctor-templates';
import type { ClinicalTemplateStatus, UnknownEnumValue } from '@/types/contracts';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';

type KnownTemplateStatus = Exclude<ClinicalTemplateStatus, UnknownEnumValue>;

const STATUS_TONE: Record<KnownTemplateStatus, UiTone> = {
  active: 'green',
  archived: 'slate',
};

export default function TemplatesLibrary() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  // Create-form fields. `content` is a JSON textarea; the contract types content as
  // Record<string, unknown>, so an object with a free-form body field is a safe shape.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [contentBody, setContentBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const resource = useApiResource(
    (signal) => listDoctorTemplates({ search: search.trim() || undefined, pageSize: 100, signal }),
    [search],
  );
  const templates = resource.data?.data ?? [];

  // KPIs are derived from the loaded page, never cached: a count stored separately is the
  // projection-this-schema-was-designed-to-prevent. Active vs archived split uses the real
  // status vocabulary, not a substring match. The memo depends on the stable `resource.data`
  // rather than the `?? []` fallback, which would be a fresh array every render.
  const stats = useMemo(() => {
    const rows = resource.data?.data ?? [];
    let active = 0;
    let archived = 0;
    for (const template of rows) {
      const status = template.status as KnownTemplateStatus;
      if (status === 'active') active += 1;
      else if (status === 'archived') archived += 1;
    }
    return { total: rows.length, active, archived };
  }, [resource.data]);

  function resetForm() {
    setName(''); setDescription(''); setSpecialty(''); setContentBody('');
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setMessage('A template name is required.'); return; }
    let content: Record<string, unknown> = {};
    if (contentBody.trim()) {
      try { content = JSON.parse(contentBody) as Record<string, unknown>; }
      catch { setMessage('Template content must be valid JSON.'); return; }
    }
    setBusy(true); setMessage(null);
    try {
      const created = await createDoctorTemplate(
        { name: name.trim(), description: description.trim() || null, specialty: specialty.trim() || null, content },
        crypto.randomUUID(),
      );
      setMessage(`Template "${created.name}" created.`);
      resetForm(); setShowForm(false);
      await resource.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create template.');
    } finally { setBusy(false); }
  }

  if (authLoading || !user) return <PageLoader label="Loading your workspace..." />;
  if (user.activeRole !== 'doctor') return null;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Templates' }]} />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Clinical Templates"
            subtitle="Reusable note and prescription templates for your practice."
            actions={
              <button
                type="button"
                onClick={() => { setShowForm((v) => !v); setMessage(null); }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-[20px]">{showForm ? 'close' : 'add'}</span>
                {showForm ? 'Cancel' : 'New template'}
              </button>
            }
          />

          {/* KPI row — derived from the loaded page, never stored. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon="content_copy" label="Total" value={stats.total} tone="blue" note="Authored by you" />
            <StatCard icon="check_circle" label="Active" value={stats.active} tone="green" note="Available for consultations" />
            <StatCard icon="archive" label="Archived" value={stats.archived} tone="slate" note="Hidden from new use" />
          </div>

          {showForm && (
            <SectionCard title="Create template" bodyClassName="space-y-4">
              <form onSubmit={submitCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required
                    className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all" placeholder="e.g. Adult SOAP follow-up" />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Specialty</label>
                    <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} maxLength={120}
                      className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all" placeholder="e.g. General practice" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Description</label>
                    <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000}
                      className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all" placeholder="Short summary" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Content (JSON)</label>
                  <textarea value={contentBody} onChange={(e) => setContentBody(e.target.value)} rows={7}
                    className="w-full font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg p-4 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                    placeholder='{"type":"soap","sections":[{"title":"Objective","fields":[{"label":"BP","type":"measurement","required":true}]}]}' />
                  <p className="text-xs text-slate-400 mt-1.5">Optional structured content — SOAP sections, fields, defaults. Set <code className="text-slate-500">"type"</code> to categorize the template.</p>
                </div>
                {message && (
                  <p role="status" className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm break-words text-slate-700">{message}</p>
                )}
                <div className="flex gap-3">
                  <button type="submit" disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors shadow-sm">
                    <span className="material-symbols-outlined text-[20px]">{busy ? 'progress_activity' : 'add'}</span>
                    {busy ? 'Creating...' : 'Create template'}
                  </button>
                  <button type="button" onClick={() => { setShowForm(false); setMessage(null); }} disabled={busy}
                    className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </form>
            </SectionCard>
          )}

          {!showForm && message && (
            <p role="status" className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm break-words text-slate-700">{message}</p>
          )}

          <SearchInput value={search} onChange={setSearch} placeholder="Search templates by name..." className="max-w-lg" />

          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={!resource.isLoading && !resource.error && templates.length === 0}
            onRetry={resource.reload}
            loadingLabel="Loading templates..."
            errorTitle="Could not load templates"
            forbiddenTitle="You cannot view clinical templates"
            emptyTitle="No clinical templates"
            emptyBody="You have not authored any templates yet. Create one to reuse it in consultations."
            emptyIcon="description"
          />

          {!resource.isLoading && !resource.error && templates.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {templates.map((template) => {
                const status = template.status as KnownTemplateStatus;
                const templateType = deriveTemplateType(template.content);
                return (
                  <button
                    key={template.template_id}
                    type="button"
                    onClick={() => router.push(`/doctor/templates/${template.template_id}`)}
                    className="text-left bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md hover:border-slate-300 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#1e3fae]/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-slate-900 text-base truncate">{template.name}</h3>
                        <p className="text-xs text-slate-400 mt-0.5"><code>{shortId(template.template_id)}</code>{template.specialty ? ` · ${template.specialty}` : ''}</p>
                      </div>
                      <Badge tone={TEMPLATE_TYPE_TONE[templateType]}>{TEMPLATE_TYPE_LABEL[templateType]}</Badge>
                    </div>

                    <p className="text-sm text-slate-500 mt-3 inline-flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[18px] text-slate-400">view_list</span>
                      {deriveSectionFieldSummary(template.content)}
                    </p>

                    {template.description && (
                      <p className="text-sm text-slate-600 mt-2 line-clamp-2">{template.description}</p>
                    )}

                    <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-slate-100">
                      <Badge tone={STATUS_TONE[status] ?? 'slate'}>
                        <span className="material-symbols-outlined text-[14px] mr-1">{status === 'active' ? 'check_circle' : 'archive'}</span>
                        {humaniseCode(template.status)}
                      </Badge>
                      <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">schedule</span>
                        {formatInstant(template.updated_at)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
