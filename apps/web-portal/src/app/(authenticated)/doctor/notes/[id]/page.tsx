'use client';

/**
 * Clinical note detail, wired to GET /clinical-notes/{id}.
 *
 * EDIT AND SIGN carry `expected_version` from the note as read. A 409 means the version
 * in hand is stale; the note is re-read so a retry uses fresh state. The acknowledgement
 * of a mutation carries the updated `ClinicalNote`, but we still RE-READ rather than
 * trusting it alone, because the version may have advanced further by the time the
 * acknowledgement arrives.
 *
 * A note can only be edited while it is in `draft` status. Signing transitions it to
 * `signed`, after which it is immutable. Discarding transitions it to `discarded`.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import {
  amendClinicalNote,
  getClinicalNote,
  transitionClinicalNote,
  updateClinicalNote,
} from '@/lib/api/clinical';
import { ApiError } from '@/lib/api/client';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';
import type {
  AmendClinicalNoteRequest,
  ClinicalNote,
  ClinicalNoteStatus,
  UnknownEnumValue,
  UpdateClinicalNoteRequest,
} from '@/types/contracts';

type KnownNoteStatus = Exclude<ClinicalNoteStatus, UnknownEnumValue>;

const NOTE_STATUS_TONE: Record<KnownNoteStatus, BadgeTone> = {
  draft: 'amber',
  signed: 'green',
  superseded: 'slate',
  discarded: 'red',
};

const SOAP_KEYS = ['subjective', 'objective', 'assessment', 'plan'] as const;

export default function ClinicalNoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const noteId = String(params.id);

  const resource = useApiResource(
    (signal) => getClinicalNote(noteId, signal),
    [noteId],
  );

  const note = resource.data ?? null;

  const notFound = resource.error?.status === 404;

  const status = note?.status as KnownNoteStatus | undefined;
  const isDraft = status === 'draft';
  const isSigned = status === 'signed';
  const isDiscarded = status === 'discarded';
  const isSuperseded = status === 'superseded';
  const isMutable = isDraft;

  // Editable SOAP fields, seeded from the saved record. Re-seeded on every reload so a
  // post-save version bump is reflected, not incremented locally.
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [extraJson, setExtraJson] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<ApiError | null>(null);

  // Amend a signed note — modal that creates a signed replacement and supersedes the
  // immutable prior note. Reuses the SOAP shape so the amendment starts as a copy.
  const [showAmendModal, setShowAmendModal] = useState(false);
  const [amendSubjective, setAmendSubjective] = useState('');
  const [amendObjective, setAmendObjective] = useState('');
  const [amendAssessment, setAmendAssessment] = useState('');
  const [amendExtraJson, setAmendExtraJson] = useState('');

  useEffect(() => {
    if (!note) return;
    const content = note.content;
    const subjective = typeof content.subjective === 'string' ? content.subjective : '';
    const objective = typeof content.objective === 'string' ? content.objective : '';
    const assessment = typeof content.assessment === 'string' ? content.assessment : '';
    setSubjective(subjective);
    setObjective(objective);
    setAssessment(assessment);
    // Preserve non-SOAP keys as a JSON blob so editing never drops data the server stored.
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(content)) {
      if (!SOAP_KEYS.includes(key as (typeof SOAP_KEYS)[number])) {
        extras[key] = value;
      }
    }
    const extra = Object.keys(extras).length > 0 ? JSON.stringify(extras, null, 2) : '';
    setExtraJson(extra);
    // Seed the amendment form with the current content so the doctor edits a copy.
    setAmendSubjective(subjective);
    setAmendObjective(objective);
    setAmendAssessment(assessment);
    setAmendExtraJson(extra);
  }, [note]);

  function buildContent(fields: {
    subjective: string;
    objective: string;
    assessment: string;
    extraJson: string;
  }): Record<string, unknown> | null {
    const content: Record<string, unknown> = {};
    if (fields.subjective.trim()) content.subjective = fields.subjective.trim();
    if (fields.objective.trim()) content.objective = fields.objective.trim();
    if (fields.assessment.trim()) content.assessment = fields.assessment.trim();
    if (fields.extraJson.trim()) {
      try {
        const parsed = JSON.parse(fields.extraJson) as Record<string, unknown>;
        Object.assign(content, parsed);
      } catch {
        setMessage('The extra content JSON is invalid.');
        return null;
      }
    }
    return content;
  }

  const runUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!note) return;
      const content = buildContent({ subjective, objective, assessment, extraJson });
      if (content === null) return;
      setBusy(true);
      setWriteError(null);
      setMessage(null);
      const body: UpdateClinicalNoteRequest = {
        content,
        expected_version: note.version,
      };
      try {
        const updated = await updateClinicalNote(noteId, body, crypto.randomUUID());
        setMessage(`Note saved (v${updated.version}).`);
        setEditing(false);
        await resource.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        if (apiError.isConflict) resource.reload();
      } finally {
        setBusy(false);
      }
    },
    [note, noteId, resource, subjective, objective, assessment, extraJson],
  );

  // Amend a signed note: atomically create a signed replacement and supersede the prior
  // immutable note. The amendment form starts as a copy of the current content.
  const runAmend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!note) return;
      const content = buildContent({
        subjective: amendSubjective,
        objective: amendObjective,
        assessment: amendAssessment,
        extraJson: amendExtraJson,
      });
      if (content === null) return;
      setBusy(true);
      setWriteError(null);
      setMessage(null);
      const body: AmendClinicalNoteRequest = {
        content,
        expected_version: note.version,
      };
      try {
        const result = await amendClinicalNote(noteId, body, crypto.randomUUID());
        setMessage(`Amendment issued: Note ${shortId(result.note_id)} (${humaniseCode(result.status)}).`);
        setShowAmendModal(false);
        await resource.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        if (apiError.isConflict) resource.reload();
      } finally {
        setBusy(false);
      }
    },
    [note, noteId, resource, amendSubjective, amendObjective, amendAssessment, amendExtraJson],
  );

  const runTransition = useCallback(
    async (target: 'signed' | 'discarded') => {
      if (!note) return;
      setBusy(true);
      setWriteError(null);
      setMessage(null);
      try {
        const result = await transitionClinicalNote(
          noteId,
          { status: target, expected_version: note.version },
          crypto.randomUUID(),
        );
        setMessage(`Note ${humaniseCode(result.status)}.`);
        await resource.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        if (apiError.isConflict) resource.reload();
      } finally {
        setBusy(false);
      }
    },
    [note, noteId, resource],
  );

  if (authLoading || !user) return <PageLoader label="Loading your session..." />;
  if (user.activeRole !== 'doctor') return null;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Doctor' },
          { label: 'Clinical Notes', href: '/doctor/notes' },
          { label: shortId(noteId) },
        ]}
      />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[1000px] mx-auto flex flex-col gap-6">
          <button
            type="button"
            onClick={() => router.push('/doctor/notes')}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#1e3fae] transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to notes
          </button>

          {notFound ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">sticky_note_2</span>
              <h2 className="font-bold text-slate-900 mt-3">Note not found</h2>
              <p className="text-sm text-slate-500 mt-1">
                This note does not exist or is not accessible to you.
              </p>
              <button
                onClick={() => router.push('/doctor/notes')}
                className="inline-block mt-4 text-sm font-bold text-[#1e3fae] hover:underline"
              >
                Back to notes
              </button>
            </div>
          ) : (
            <ResourceState
              isLoading={resource.isLoading}
              error={resource.error}
              isEmpty={false}
              onRetry={resource.reload}
              loadingLabel="Loading note..."
              errorTitle="Could not load note"
              forbiddenTitle="You cannot view this note"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {note && !resource.error && (
            <>
              {/* Header */}
              <SectionCard>
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                        Note <code className="text-slate-700">{shortId(note.note_id)}</code>
                      </h1>
                      <Badge tone={NOTE_STATUS_TONE[status ?? 'draft'] ?? 'slate'}>
                        {humaniseCode(note.status)}
                      </Badge>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-bold">
                        v{note.version_no}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">stethoscope</span>
                        Consultation <code className="text-slate-600">{shortId(note.consultation_id)}</code>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">schedule</span>
                        Created {formatInstant(note.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">history</span>
                        Updated {formatInstant(note.updated_at)}
                      </span>
                      {note.signed_at && (
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">verified</span>
                          Signed {formatInstant(note.signed_at)}
                        </span>
                      )}
                      {note.replaces_note_id && (
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">swap_vert</span>
                          Replaces <code>{shortId(note.replaces_note_id)}</code>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Lifecycle actions */}
                  <div className="flex flex-wrap items-stretch gap-2 md:items-end">
                    {isMutable && !editing && (
                      <button
                        type="button"
                        onClick={() => { setEditing(true); setWriteError(null); setMessage(null); }}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">edit</span>
                        Edit
                      </button>
                    )}
                    {isMutable && (
                      <button
                        type="button"
                        onClick={() => void runTransition('signed')}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">{busy ? 'progress_activity' : 'draw'}</span>
                        {busy ? 'Processing...' : 'Sign'}
                      </button>
                    )}
                    {isMutable && (
                      <button
                        type="button"
                        onClick={() => void runTransition('discarded')}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">delete</span>
                        Discard
                      </button>
                    )}
                    {isSigned && (
                      <button
                        type="button"
                        onClick={() => { setShowAmendModal(true); setWriteError(null); setMessage(null); }}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">edit_note</span>
                        Amend
                      </button>
                    )}
                  </div>
                </div>
              </SectionCard>

              {message && (
                <p role="status" className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm break-words text-slate-700">
                  {message}
                </p>
              )}

              {writeError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                  <p className="text-sm font-bold text-red-700">
                    {writeError.isForbidden
                      ? 'You cannot modify this note'
                      : writeError.isConflict
                        ? 'Conflict — the note changed since you loaded it. Please retry.'
                        : writeError.isUnauthenticated
                          ? 'Your session expired. Please sign in again.'
                          : writeError.title}
                  </p>
                  <p className="text-xs text-red-600 mt-1">{writeError.message}</p>
                  {writeError.correlationId && (
                    <p className="text-xs text-red-400 mt-1">
                      Reference: <code>{writeError.correlationId}</code>
                    </p>
                  )}
                </div>
              )}

              {/* Read-only banner for non-draft statuses */}
              {!isMutable && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px]">lock</span>
                  {isSigned && 'This note is signed and locked. Use Amend to issue a signed replacement.'}
                  {isDiscarded && 'This note has been discarded.'}
                  {isSuperseded && 'This note has been superseded by a newer version.'}
                </div>
              )}

              {/* Editable SOAP fields or read-only display */}
              {editing && isMutable ? (
                <SectionCard title="Edit note">
                  <form onSubmit={runUpdate} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Subjective</label>
                      <textarea
                        value={subjective}
                        onChange={(e) => setSubjective(e.target.value)}
                        rows={4}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none"
                        placeholder="Patient-reported symptoms, complaints, history..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Objective</label>
                      <textarea
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        rows={4}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none"
                        placeholder="Examination findings, vitals, observations..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Assessment</label>
                      <textarea
                        value={assessment}
                        onChange={(e) => setAssessment(e.target.value)}
                        rows={4}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none"
                        placeholder="Diagnosis, clinical impression, differential..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                        Additional content (JSON)
                      </label>
                      <textarea
                        value={extraJson}
                        onChange={(e) => setExtraJson(e.target.value)}
                        rows={4}
                        className="w-full font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                        placeholder='{"plan": "...", "chief_complaint": "..."}'
                      />
                      <p className="text-xs text-slate-400 mt-1.5">Non-SOAP keys are preserved here. Leave empty if none.</p>
                    </div>
                    <div className="flex flex-wrap gap-3 pt-2">
                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors shadow-sm"
                      >
                        <span className="material-symbols-outlined text-[20px]">{busy ? 'progress_activity' : 'save'}</span>
                        {busy ? 'Saving...' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditing(false); setMessage(null); setWriteError(null); }}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </SectionCard>
              ) : (
                <NoteContentDisplay note={note} />
              )}

              {/* Amend signed note modal */}
              {showAmendModal && note && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                      <h2 className="text-lg font-bold text-slate-900">Amend note</h2>
                      <button
                        type="button"
                        onClick={() => { setShowAmendModal(false); setWriteError(null); }}
                        className="text-slate-400 hover:text-slate-600"
                        aria-label="Close"
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <form onSubmit={runAmend} className="p-6 flex flex-col gap-4">
                      <p className="text-sm text-slate-500">
                        This atomically creates a signed replacement and supersedes Note{' '}
                        <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">
                          {shortId(note.note_id)}
                        </code>
                        . The prior note stays immutable and points to the new one.
                      </p>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                          Subjective
                        </label>
                        <textarea
                          value={amendSubjective}
                          onChange={(e) => setAmendSubjective(e.target.value)}
                          rows={4}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none"
                          placeholder="Patient-reported symptoms, complaints, history..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                          Objective
                        </label>
                        <textarea
                          value={amendObjective}
                          onChange={(e) => setAmendObjective(e.target.value)}
                          rows={4}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none"
                          placeholder="Examination findings, vitals, observations..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                          Assessment
                        </label>
                        <textarea
                          value={amendAssessment}
                          onChange={(e) => setAmendAssessment(e.target.value)}
                          rows={4}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all resize-none"
                          placeholder="Diagnosis, clinical impression, differential..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                          Additional content (JSON)
                        </label>
                        <textarea
                          value={amendExtraJson}
                          onChange={(e) => setAmendExtraJson(e.target.value)}
                          rows={4}
                          className="w-full font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                          placeholder='{"plan": "...", "chief_complaint": "..."}'
                        />
                        <p className="text-xs text-slate-400 mt-1.5">Non-SOAP keys are preserved here. Leave empty if none.</p>
                      </div>
                      {writeError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                          <p className="text-sm font-bold text-red-700">
                            {writeError.isForbidden
                              ? 'You cannot amend this note'
                              : writeError.isConflict
                                ? 'Conflict — the note changed since you loaded it. Please retry.'
                                : writeError.needsStepUp
                                  ? 'Recent authentication is required to amend a signed note.'
                                  : writeError.isUnauthenticated
                                    ? 'Your session expired. Please sign in again.'
                                    : writeError.title}
                          </p>
                          <p className="text-xs text-red-600 mt-1">{writeError.message}</p>
                          {writeError.correlationId && (
                            <p className="text-xs text-red-400 mt-1">
                              Reference: <code>{writeError.correlationId}</code>
                            </p>
                          )}
                        </div>
                      )}
                      <div className="flex justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => { setShowAmendModal(false); setWriteError(null); }}
                          disabled={busy}
                          className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[20px]">{busy ? 'progress_activity' : 'draw'}</span>
                          {busy ? 'Issuing...' : 'Sign & supersede'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * Renders the note's `content` as labeled SOAP sections plus any additional keys.
 * Pure projection: never fabricates a value the server did not send.
 */
function NoteContentDisplay({ note }: { note: ClinicalNote }) {
  const content = note.content;
  const soapEntries = SOAP_KEYS.filter(
    (key) => typeof content[key] === 'string' && (content[key] as string).trim().length > 0,
  );
  const extraEntries = Object.entries(content).filter(
    ([key]) => !SOAP_KEYS.includes(key as (typeof SOAP_KEYS)[number]),
  );

  return (
    <>
      <SectionCard title="Clinical content">
        {soapEntries.length === 0 && extraEntries.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">This note has no content yet.</p>
        ) : (
          <div className="space-y-4">
            {soapEntries.map((key) => (
              <div key={key}>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                  {humaniseCode(key)}
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {String(content[key])}
                </p>
              </div>
            ))}
            {extraEntries.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
                  Additional fields
                </h3>
                <pre className="text-sm text-slate-600 bg-slate-50 rounded-lg border border-slate-200 p-4 overflow-x-auto font-mono">
                  {JSON.stringify(Object.fromEntries(extraEntries), null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </>
  );
}
