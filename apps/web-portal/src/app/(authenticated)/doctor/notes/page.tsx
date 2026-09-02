'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import StatCard from '@/components/ui/stat-card';
import SearchInput from '@/components/ui/search-input';
import FilterPills from '@/components/ui/filter-pills';
import Badge from '@/components/ui/badge';
import EmptyState from '@/components/ui/empty-state';
import { createConsultationNote, listDoctorNotes } from '@/lib/api/clinical';
import { ApiError } from '@/lib/api/client';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';
import type { ClinicalNote, ClinicalNoteStatus, CreateClinicalNoteRequest, UnknownEnumValue } from '@/types/contracts';

/**
 * The generated contract types `ClinicalNoteStatus` as a union including the
 * forward-compatibility escape hatch `UnknownEnumValue`. The real vocabulary the
 * server sends today is the four values below; everything else falls through to a
 * neutral slate badge at the call site rather than rendering a default forever.
 */
type KnownNoteStatus = Exclude<ClinicalNoteStatus, UnknownEnumValue>;
const NOTE_STATUSES: readonly KnownNoteStatus[] = ['draft', 'signed', 'superseded', 'discarded'];

/** Badge tone per known status, keyed exhaustively so an invented value cannot compile. */
const NOTE_STATUS_TONE: Record<KnownNoteStatus, 'amber' | 'green' | 'slate' | 'red'> = {
  draft: 'amber',
  signed: 'green',
  superseded: 'slate',
  discarded: 'red',
};

type NoteFilter = 'all' | KnownNoteStatus;

const FILTER_TABS: ReadonlyArray<{ key: NoteFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'signed', label: 'Signed' },
  { key: 'superseded', label: 'Superseded' },
  { key: 'discarded', label: 'Discarded' },
];

/**
 * `content` is a free-form JSONB record (`Record<string, unknown>`). The fixture and
 * real payloads use SOAP-style keys (subjective, objective, assessment, plan, chief_complaint,
 * history, examination, diagnosis), but nothing enforces that, so the preview must work for
 * any shape. We prefer the recognised clinical keys in a stable order, then fall back to the
 * first string value found, and finally to a compact JSON stringification — never fabricating
 * a value the server did not send.
 */
const PREVIEW_KEYS = [
  'chief_complaint',
  'subjective',
  'objective',
  'assessment',
  'plan',
  'history',
  'examination',
  'diagnosis',
  'summary',
  'note',
] as const;

function noteContentPreview(content: Record<string, unknown>, max = 120): string {
  const recognised: string[] = [];
  for (const key of PREVIEW_KEYS) {
    const value = content[key];
    if (typeof value === 'string' && value.trim().length > 0) recognised.push(value.trim());
  }
  if (recognised.length > 0) return truncate(recognised.join(' · '), max);

  const fallback: string[] = [];
  for (const value of Object.values(content)) {
    if (typeof value === 'string' && value.trim().length > 0) fallback.push(value.trim());
  }
  if (fallback.length > 0) return truncate(fallback.join(' · '), max);

  const json = JSON.stringify(content);
  return json === '{}' ? 'Empty note content' : truncate(json, max);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export default function ConsultationNotesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const notes = useApiResource((signal) => listDoctorNotes({ pageSize: 100, signal }), []);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [showNewNote, setShowNewNote] = useState(false);

  // Order by most recently updated first: a doctor returning to sign or amend a note cares
  // about the one they were last working on, not the oldest. Recency is meaningless here.
  const rows = useMemo(
    () => [...(notes.data?.data ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [notes.data],
  );

  const counts = useMemo(() => {
    const total = rows.length;
    let draft = 0;
    let signed = 0;
    for (const row of rows) {
      if (row.status === 'draft') draft += 1;
      else if (row.status === 'signed') signed += 1;
    }
    return { total, draft, signed };
  }, [rows]);

  // Unique consultation IDs from the loaded notes, for the consultation selector in the
  // New Note modal. There is no list-consultations endpoint for a doctor, so the notes list
  // is the closest source of consultation IDs the doctor already reaches.
  const knownConsultations = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) ids.add(row.consultation_id);
    return Array.from(ids);
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false;
      if (needle === '') return true;
      if (row.consultation_id.toLowerCase().includes(needle)) return true;
      if (row.note_id.toLowerCase().includes(needle)) return true;
      return noteContentPreview(row.content).toLowerCase().includes(needle);
    });
  }, [rows, query, filter]);

  // --- New note mutation -----------------------------------------------------
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<ApiError | null>(null);

  const runCreate = useCallback(
    async (consultationId: string, body: CreateClinicalNoteRequest, idempotencyKey: string) => {
      setIsCreating(true);
      setCreateError(null);
      try {
        const created = await createConsultationNote(consultationId, body, idempotencyKey);
        setShowNewNote(false);
        // Navigate to the detail page so the doctor can review and sign it.
        router.push(`/doctor/notes/${created.note_id}`);
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setCreateError(apiError);
      } finally {
        setIsCreating(false);
      }
    },
    [router],
  );

  if (authLoading || !user) return <PageLoader label="Loading your session..." />;
  if (user.activeRole !== 'doctor') return null;

  const hasData = !notes.isLoading && !notes.error && rows.length > 0;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Clinical Notes' }]} />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Clinical Notes"
            subtitle="Notes from your assigned consultations."
            actions={
              <button
                type="button"
                onClick={() => { setCreateError(null); setShowNewNote(true); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080] transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-base">add</span>
                New Note
              </button>
            }
          />

          {/* KPI row — derived from loaded data, never incremented from memory. */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              icon="description"
              label="Total notes"
              value={counts.total}
              tone="blue"
              note="Across all your consultations"
            />
            <StatCard
              icon="edit_note"
              label="Draft"
              value={counts.draft}
              tone="amber"
              note="Awaiting your signature"
            />
            <StatCard
              icon="task_alt"
              label="Finalized"
              value={counts.signed}
              tone="green"
              note="Signed and locked"
            />
          </section>

          <ResourceState
            isLoading={notes.isLoading}
            error={notes.error}
            isEmpty={!notes.isLoading && !notes.error && rows.length === 0}
            onRetry={notes.reload}
            loadingLabel="Loading notes..."
            errorTitle="Could not load notes"
            forbiddenTitle="You cannot view notes"
            emptyTitle="No notes yet"
            emptyBody="Notes you author during consultations appear here."
            emptyIcon="sticky_note_2"
          />

          {hasData && (
            <>
              {/* Search + filter controls. */}
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search by consultation id or content..."
                  className="md:max-w-md"
                />
                <FilterPills
                  tabs={FILTER_TABS}
                  activeKey={filter}
                  onSelect={setFilter}
                  className="md:ml-auto"
                />
              </div>

              {/* Filtered result count, kept distinct from the empty state below: an empty
                  filter result is not the same as the collection being empty. */}
              {visible.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                  <EmptyState
                    icon="search_off"
                    title="No matching notes"
                    body="Try a different search term or status filter."
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {visible.map((row) => (
                    <NoteCard key={row.note_id} note={row} onClick={() => router.push(`/doctor/notes/${row.note_id}`)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showNewNote && (
        <NewNoteModal
          knownConsultations={knownConsultations}
          isSaving={isCreating}
          error={createError}
          onClose={() => { setShowNewNote(false); setCreateError(null); }}
          onSubmit={(consultationId, body, idempotencyKey) => runCreate(consultationId, body, idempotencyKey)}
        />
      )}
    </main>
  );
}

/**
 * A single note rendered as a card. Now links to the detail page where the doctor can
 * review, edit and sign it.
 */
function NoteCard({ note, onClick }: { note: ClinicalNote; onClick: () => void }) {
  const status = note.status as KnownNoteStatus | UnknownEnumValue;
  const isKnown = NOTE_STATUSES.includes(status as KnownNoteStatus);
  const tone = isKnown ? NOTE_STATUS_TONE[status as KnownNoteStatus] : 'slate';
  const superseded = note.status === 'superseded' && note.replaces_note_id;
  const discarded = note.status === 'discarded';

  return (
    <article
      onClick={onClick}
      className="group bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
      aria-label={`Clinical note ${shortId(note.note_id)}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-slate-900">
              Note <code className="text-slate-700">{shortId(note.note_id)}</code>
            </h3>
            <Badge tone={tone}>{humaniseCode(note.status)}</Badge>
            {superseded && (
              <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">swap_vert</span>
                replaces <code>{shortId(note.replaces_note_id)}</code>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 leading-relaxed mt-1">
            {noteContentPreview(note.content)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-bold">
            v{note.version_no}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 mt-4 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-sm text-slate-400">stethoscope</span>
            Consultation <code className="text-slate-600">{shortId(note.consultation_id)}</code>
          </span>
          {note.signed_at && (
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-slate-400">verified</span>
              Signed {formatInstant(note.signed_at)}
            </span>
          )}
        </div>
        <span className={`text-xs inline-flex items-center gap-1 ${discarded ? 'text-red-500' : 'text-slate-400'}`}>
          <span className="material-symbols-outlined text-sm">schedule</span>
          {formatInstant(note.created_at)}
        </span>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* New Note modal                                                              */
/* -------------------------------------------------------------------------- */

interface NewNoteModalProps {
  readonly knownConsultations: readonly string[];
  readonly isSaving: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onSubmit: (consultationId: string, body: CreateClinicalNoteRequest, idempotencyKey: string) => void;
}

function NewNoteModal({ knownConsultations, isSaving, error, onClose, onSubmit }: NewNoteModalProps) {
  const [consultationId, setConsultationId] = useState('');
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');

  const canSubmit = consultationId.trim() !== '' && !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const content: Record<string, unknown> = {};
    if (subjective.trim()) content.subjective = subjective.trim();
    if (objective.trim()) content.objective = objective.trim();
    if (assessment.trim()) content.assessment = assessment.trim();
    if (plan.trim()) content.plan = plan.trim();
    onSubmit(consultationId.trim(), { content }, crypto.randomUUID());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">New Clinical Note</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <form id="new-note-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Consultation selector: known consultations as quick-select, plus free-text. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-slate-700">
                Consultation <span className="text-red-500">*</span>
              </label>
              {knownConsultations.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1">
                  {knownConsultations.slice(0, 6).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setConsultationId(id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                        consultationId === id
                          ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {shortId(id)}
                    </button>
                  ))}
                </div>
              )}
              <input
                value={consultationId}
                onChange={(e) => setConsultationId(e.target.value)}
                placeholder="Paste a consultation UUID..."
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all font-mono"
                required
              />
            </div>

            {/* SOAP fields */}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">Subjective</span>
              <textarea
                value={subjective}
                onChange={(e) => setSubjective(e.target.value)}
                placeholder="Patient-reported symptoms, complaints, history..."
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none min-h-[80px]"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">Objective</span>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Examination findings, vitals, observations..."
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none min-h-[80px]"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">Assessment</span>
              <textarea
                value={assessment}
                onChange={(e) => setAssessment(e.target.value)}
                placeholder="Diagnosis, clinical impression, differential..."
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none min-h-[80px]"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-slate-700">Plan</span>
              <textarea
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                placeholder="Treatment plan, medications, follow-up..."
                className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none min-h-[80px]"
              />
            </label>
          </form>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isForbidden
                  ? 'You cannot create clinical notes'
                  : error.isConflict
                    ? 'Conflict — this note may already exist'
                    : error.title}
              </p>
              <p className="text-xs text-red-600 mt-1">{error.message}</p>
              {error.correlationId && (
                <p className="text-xs text-red-400 mt-1">
                  Reference: <code>{error.correlationId}</code>
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="new-note-form"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
            >
              {isSaving ? 'Creating...' : 'Create note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
