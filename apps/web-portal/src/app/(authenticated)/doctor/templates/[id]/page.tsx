'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import {
  getDoctorTemplate,
  updateDoctorTemplate,
  archiveDoctorTemplate,
  deriveTemplateType,
  deriveSectionFieldSummary,
  extractTemplateSections,
  applyTemplateTypeToContentJson,
  TEMPLATE_TYPES,
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

/**
 * Renders the template `content` JSON as labeled section/field cards instead of a raw pre
 * block. Parsing is defensive: an invalid string shows a warning plus the raw text, a valid
 * object without `sections` shows the type and a hint, and a sectioned template renders each
 * field's label, type badge and required indicator. This is a pure projection of the textarea
 * contents — it never mutates state — so it updates live as the doctor edits the JSON.
 */
function TemplatePreview({ contentJson }: { readonly contentJson: string }) {
  const trimmed = contentJson.trim();
  let parsed: unknown = {};
  let parseError = false;
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parseError = true;
    }
  }

  if (parseError) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
          <span className="material-symbols-outlined text-amber-600 text-[20px]">warning</span>
          <p className="text-sm text-amber-800">The content is not valid JSON. Fix the editor to see the structured preview.</p>
        </div>
        <pre className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs overflow-x-auto font-mono text-slate-600">{contentJson || '(empty)'}</pre>
      </div>
    );
  }

  const sections = extractTemplateSections(parsed);
  const templateType = deriveTemplateType(parsed);
  const summary = deriveSectionFieldSummary(parsed);

  if (sections.length === 0) {
    return (
      <div className="text-center py-10">
        <span className="material-symbols-outlined text-slate-300 text-5xl">draft</span>
        <h4 className="font-bold text-slate-700 mt-3">{TEMPLATE_TYPE_LABEL[templateType]}</h4>
        <p className="text-sm text-slate-500 mt-1">{summary}</p>
        <p className="text-xs text-slate-400 mt-3">Add a <code className="text-slate-500">sections</code> array to the content to see a structured preview.</p>
        {trimmed && (
          <pre className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs overflow-x-auto font-mono text-left text-slate-600 max-h-64 overflow-y-auto">{contentJson}</pre>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Badge tone={TEMPLATE_TYPE_TONE[templateType]}>{TEMPLATE_TYPE_LABEL[templateType]}</Badge>
        <span>{summary}</span>
      </div>
      {sections.map((section, sIndex) => (
        <div key={sIndex} className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center gap-2">
            <span className="material-symbols-outlined text-slate-400 text-[18px]">format_list_bulleted</span>
            <h4 className="font-bold text-slate-800 text-sm">{section.title}</h4>
            <span className="ml-auto text-xs text-slate-400">{section.fields.length} field{section.fields.length === 1 ? '' : 's'}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {section.fields.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-400">No fields in this section.</p>
            ) : (
              section.fields.map((field, fIndex) => (
                <div key={fIndex} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-1 text-sm text-slate-700">{field.label}</span>
                  <Badge tone={field.typeTone}>{field.typeLabel}</Badge>
                  {field.required ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-bold text-red-600">
                      <span className="material-symbols-outlined text-[14px]">priority_high</span>Required
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Optional</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TemplateEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params.id);
  const resource = useApiResource((signal) => getDoctorTemplate(id, signal), [id]);
  const record = resource.data;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [contentBody, setContentBody] = useState('');
  const [templateType, setTemplateType] = useState<TemplateType>('note');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Seed the editable fields from the saved record whenever it changes (initial load and
  // after every reload). A mutation acknowledgement is not the new state: re-reading after a
  // save is what keeps the held version honest, so re-seeding on reload is correct rather than
  // incrementing what we already hold.
  useEffect(() => {
    if (!record) return;
    setName(record.name);
    setDescription(record.description ?? '');
    setSpecialty(record.specialty ?? '');
    setContentBody(JSON.stringify(record.content, null, 2));
    setTemplateType(deriveTemplateType(record.content));
    setConfirmArchive(false);
  }, [record]);

  function handleTypeChange(type: TemplateType) {
    // The type select writes into the same `content` object the JSON textarea owns, so there
    // is a single source of truth: the JSON. The select is a convenience editor over
    // `content.type`, not a parallel field.
    setTemplateType(type);
    setContentBody(applyTemplateTypeToContentJson(contentBody, type));
  }

  async function submitUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!record) return;
    if (!name.trim()) { setMessage('A template name is required.'); return; }
    let content: Record<string, unknown>;
    try { content = contentBody.trim() ? JSON.parse(contentBody) as Record<string, unknown> : {}; }
    catch { setMessage('Template content must be valid JSON.'); return; }
    setBusy(true); setMessage(null);
    try {
      const updated = await updateDoctorTemplate(
        id,
        { name: name.trim(), description: description.trim() || null, specialty: specialty.trim() || null, content, expected_version: record.version },
        crypto.randomUUID(),
      );
      setMessage(`Template "${updated.name}" saved (v${updated.version}).`);
      await resource.reload();
    } catch (error) {
      // A 409 means the version we held is stale: re-read rather than incrementing locally.
      setMessage(error instanceof Error ? error.message : 'Could not save template.');
    } finally { setBusy(false); }
  }

  async function archive() {
    if (!record) return;
    if (record.status === 'archived') { setMessage('This template is already archived.'); return; }
    setBusy(true); setMessage(null);
    try {
      const archived = await archiveDoctorTemplate(id, record.version, crypto.randomUUID());
      setMessage(`Template "${archived.name}" archived (v${archived.version}).`);
      setConfirmArchive(false);
      await resource.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not archive template.');
    } finally { setBusy(false); }
  }

  if (resource.isLoading && !record) {
    return (
      <main className="flex-1 overflow-y-auto bg-[#F9FAFB]">
        <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Templates', href: '/doctor/templates' }, { label: 'Edit' }]} />
        <PageLoader label="Loading template..." />
      </main>
    );
  }

  const status = record?.status as KnownTemplateStatus | undefined;
  const isArchived = status === 'archived';

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Templates', href: '/doctor/templates' }, { label: 'Edit' }]} />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          <button
            type="button"
            onClick={() => router.push('/doctor/templates')}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#1e3fae] transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to templates
          </button>

          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={false}
            onRetry={resource.reload}
            loadingLabel="Loading template..."
            errorTitle="Could not load template"
            forbiddenTitle="You cannot view this template"
            emptyTitle=""
            emptyBody=""
            emptyIcon=""
          />

          {record && !resource.error && (
            <>
              {/* Header card: the saved state. Metadata here reflects the persisted record,
                  not the in-progress edit, so version and status stay truthful mid-edit. */}
              <SectionCard>
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">{record.name}</h1>
                      <Badge tone={TEMPLATE_TYPE_TONE[deriveTemplateType(record.content)]}>
                        {TEMPLATE_TYPE_LABEL[deriveTemplateType(record.content)]}
                      </Badge>
                      {status && (
                        <Badge tone={STATUS_TONE[status] ?? 'slate'}>
                          <span className="material-symbols-outlined text-[14px] mr-1">{isArchived ? 'archive' : 'check_circle'}</span>
                          {humaniseCode(record.status)}
                        </Badge>
                      )}
                    </div>
                    {record.description && <p className="text-sm text-slate-600 mt-2">{record.description}</p>}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">history</span>Version {record.version}</span>
                      <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">schedule</span>Updated {formatInstant(record.updated_at)}</span>
                      <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">tag</span><code>{shortId(record.template_id)}</code></span>
                      {record.specialty && <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">medical_services</span>{record.specialty}</span>}
                    </div>
                  </div>

                  {/* Archive action lives on the header so it is visually separate from Save. */}
                  <div className="flex flex-col items-stretch gap-2 md:items-end">
                    {!confirmArchive ? (
                      <button
                        type="button"
                        onClick={() => { setConfirmArchive(true); setMessage(null); }}
                        disabled={busy || isArchived}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">archive</span>
                        {isArchived ? 'Archived' : 'Archive template'}
                      </button>
                    ) : (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 md:w-72">
                        <p className="text-sm font-bold text-red-800">Archive this template?</p>
                        <p className="text-xs text-red-700 mt-1">It will be hidden from new consultations; existing references keep resolving.</p>
                        <div className="flex gap-2 mt-3">
                          <button
                            type="button"
                            onClick={archive}
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[16px]">{busy ? 'progress_activity' : 'archive'}</span>
                            {busy ? 'Archiving...' : 'Archive'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmArchive(false)}
                            disabled={busy}
                            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
                          >
                            Keep
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>

              {message && (
                <p role="status" className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm break-words text-slate-700">{message}</p>
              )}

              {/* Side-by-side: edit form (left) and live preview (right). On narrow screens the
                  preview stacks below so the doctor can scroll between editing and its result. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <SectionCard title="Edit template" bodyClassName="space-y-4">
                  <form onSubmit={submitUpdate} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Name</label>
                      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required
                        className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all" />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Template type</label>
                        <select
                          value={templateType}
                          onChange={(e) => handleTypeChange(e.target.value as TemplateType)}
                          className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm bg-white focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                        >
                          {TEMPLATE_TYPES.map((type) => (
                            <option key={type} value={type}>{TEMPLATE_TYPE_LABEL[type]}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Specialty</label>
                        <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} maxLength={120}
                          className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all" placeholder="e.g. General practice" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Description</label>
                      <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000}
                        className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all" placeholder="Short summary" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Content (JSON)</label>
                      <textarea value={contentBody} onChange={(e) => setContentBody(e.target.value)} rows={14}
                        className="w-full font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg p-4 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all" />
                      <p className="text-xs text-slate-400 mt-1.5">Structure: <code className="text-slate-500">{`{"type":"soap","sections":[{"title":"...","fields":[{"label":"...","type":"text","required":true}]}]}`}</code></p>
                    </div>
                    <div className="flex flex-wrap gap-3 pt-2">
                      <button type="submit" disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors shadow-sm">
                        <span className="material-symbols-outlined text-[20px]">{busy ? 'progress_activity' : 'save'}</span>
                        {busy ? 'Saving...' : 'Save changes'}
                      </button>
                      <button type="button" onClick={() => { resource.reload(); setMessage(null); }} disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                        <span className="material-symbols-outlined text-[20px]">restart_alt</span>
                        Revert
                      </button>
                    </div>
                  </form>
                </SectionCard>

                <SectionCard
                  title="Live preview"
                  action={
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <span className="material-symbols-outlined text-[16px]">visibility</span>
                      Updates as you edit
                    </span>
                  }
                >
                  <TemplatePreview contentJson={contentBody} />
                </SectionCard>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
