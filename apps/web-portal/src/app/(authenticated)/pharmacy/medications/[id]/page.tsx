'use client';

/**
 * Medication catalogue detail, wired to GET/PUT /medications/{id}.
 *
 * A medication row is master data: the generic substance, its ATC code, the controlled-
 * substance schedule, the prescription requirement and a retired flag. The PUT replaces
 * the whole row and carries `expected_version` for optimistic concurrency, so after a
 * save the page re-reads (a mutation acknowledgement is not the new state) and on a 409
 * it re-reads rather than retrying with a stale version.
 *
 * `controlled_substance` is derived server-side from `controlled_schedule`, so it is
 * shown read-only and is never part of the edit body. The edit form toggles `retired`,
 * which is the only way to take a medication out of (or back into) active use — deletion
 * is not modelled, because historical prescriptions must keep resolving.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import { ApiError } from '@/lib/api/client';
import {
  readMedication,
  updateMedication,
  humaniseCode,
  shortId,
  formatInstant,
} from '@/lib/api/pharmacy';
import type { ControlledSubstanceSchedule, UnknownEnumValue } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import ResourceState from '@/components/data/ResourceState';

type KnownSchedule = Exclude<ControlledSubstanceSchedule, UnknownEnumValue>;

/** The full known schedule vocabulary, in display order. Never retype an enum. */
const SCHEDULE_VALUES: readonly KnownSchedule[] = [
  'none',
  'schedule_2',
  'schedule_3',
  'schedule_4',
  'schedule_5',
];

const SCHEDULE_LABEL: Record<KnownSchedule, string> = {
  none: 'Non-controlled',
  schedule_2: 'Schedule 2',
  schedule_3: 'Schedule 3',
  schedule_4: 'Schedule 4',
  schedule_5: 'Schedule 5',
};

const SCHEDULE_TONE: Record<KnownSchedule, BadgeTone> = {
  none: 'slate',
  schedule_2: 'red',
  schedule_3: 'orange',
  schedule_4: 'amber',
  schedule_5: 'blue',
};

function scheduleBadge(schedule: ControlledSubstanceSchedule): { tone: BadgeTone; label: string } {
  const known = schedule as KnownSchedule;
  if (SCHEDULE_VALUES.includes(known)) {
    return { tone: SCHEDULE_TONE[known], label: SCHEDULE_LABEL[known] };
  }
  // UnknownEnumValue fallback: a schedule the server may add later.
  return { tone: 'slate', label: humaniseCode(String(schedule)) };
}

interface EditFormState {
  genericName: string;
  atcCode: string;
  controlledSchedule: KnownSchedule;
  requiresPrescription: boolean;
  retired: boolean;
}

export default function MedicationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const medicationId = String(params.id);

  const resource = useApiResource(
    (signal) => readMedication(medicationId, signal),
    [medicationId],
  );
  const medication = resource.data;

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditFormState>({
    genericName: '',
    atcCode: '',
    controlledSchedule: 'none',
    requiresPrescription: true,
    retired: false,
  });
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Seed the editable fields from the saved record whenever it changes (initial load and
  // after every reload). Re-reading after a save is what keeps the held version honest.
  useEffect(() => {
    if (!medication) return;
    const known = medication.controlled_schedule as KnownSchedule;
    setForm({
      genericName: medication.generic_name,
      atcCode: medication.atc_code ?? '',
      controlledSchedule: SCHEDULE_VALUES.includes(known) ? known : 'none',
      requiresPrescription: medication.requires_prescription,
      retired: medication.retired,
    });
    setEditing(false);
  }, [medication]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  const notFound = resource.error?.status === 404;

  function validate(): string | null {
    if (form.genericName.trim() === '') {
      return 'Generic name is required.';
    }
    return null;
  }

  async function submitUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!medication) return;
    const validationError = validate();
    if (validationError) {
      setWriteError(new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Check your input', detail: validationError }));
      return;
    }
    if (busy) return;
    setBusy(true);
    setWriteError(null);
    setMessage(null);
    try {
      const updated = await updateMedication(medicationId, {
        generic_name: form.genericName.trim(),
        atc_code: form.atcCode.trim() || null,
        controlled_schedule: form.controlledSchedule,
        requires_prescription: form.requiresPrescription,
        retired: form.retired,
        expected_version: medication.version,
      });
      setMessage(`Medication "${updated.generic_name}" saved (v${updated.version}).`);
      setEditing(false);
      await resource.reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
      setWriteError(apiError);
      // A conflict means somebody else wrote first; re-read instead of retrying the stale
      // version.
      if (apiError.isConflict) {
        setMessage(null);
        await resource.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  const schedule = medication ? scheduleBadge(medication.controlled_schedule) : null;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Pharmacy', href: '/pharmacy/medications' },
          { label: 'Medications', href: '/pharmacy/medications' },
          { label: shortId(medicationId) },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-6 md:p-8 scroll-smooth">
        <div className="max-w-[1000px] mx-auto w-full flex flex-col gap-6">
          <button
            type="button"
            onClick={() => router.push('/pharmacy/medications')}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[#1e3fae] transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to medications
          </button>

          {notFound ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">medication</span>
              <h2 className="font-bold text-slate-900 mt-3">Medication not found</h2>
              <p className="text-sm text-slate-500 mt-1">
                This medication does not exist or is not accessible to your membership.
              </p>
              <button
                onClick={() => router.push('/pharmacy/medications')}
                className="inline-block mt-4 text-sm font-bold text-[#1e3fae] hover:underline"
              >
                Back to medications
              </button>
            </div>
          ) : (
            <ResourceState
              isLoading={resource.isLoading}
              error={resource.error}
              isEmpty={false}
              onRetry={resource.reload}
              loadingLabel="Loading medication..."
              errorTitle="Could not load the medication"
              forbiddenTitle="You cannot view this medication"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {medication && !resource.error && (
            <>
              {/* Header card: the saved state. Metadata reflects the persisted record, not
                  the in-progress edit, so version and status stay truthful mid-edit. */}
              <SectionCard>
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                        {medication.generic_name}
                      </h1>
                      {schedule && <Badge tone={schedule.tone}>{schedule.label}</Badge>}
                      {medication.retired ? (
                        <Badge tone="slate">
                          <span className="material-symbols-outlined text-[14px] mr-1">archive</span>
                          Retired
                        </Badge>
                      ) : (
                        <Badge tone="green">
                          <span className="material-symbols-outlined text-[14px] mr-1">check_circle</span>
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">tag</span>
                        <code>{shortId(medication.medication_id)}</code>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">history</span>
                        Version {medication.version}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">schedule</span>
                        Updated {formatInstant(medication.updated_at)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">add_circle</span>
                        Created {formatInstant(medication.created_at)}
                      </span>
                    </div>
                  </div>

                  {!editing && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setWriteError(null);
                        setMessage(null);
                      }}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors shadow-sm self-start"
                    >
                      <span className="material-symbols-outlined text-[20px]">edit</span>
                      Edit
                    </button>
                  )}
                </div>
              </SectionCard>

              {message && (
                <p role="status" className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                  {message}
                </p>
              )}

              {writeError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                  <p className="text-sm font-bold text-red-800">
                    {writeError.isConflict
                      ? 'This medication changed while you were editing'
                      : writeError.title}
                  </p>
                  <p className="text-sm text-red-700 mt-1">
                    {writeError.isConflict
                      ? 'The record has been refreshed. Reapply your change and save again.'
                      : writeError.message}
                  </p>
                  {writeError.correlationId && (
                    <p className="text-xs text-red-500 mt-2">
                      Reference: <code>{writeError.correlationId}</code>
                    </p>
                  )}
                </div>
              )}

              {editing ? (
                <SectionCard title="Edit medication" bodyClassName="space-y-4">
                  <form onSubmit={submitUpdate} className="space-y-4">
                    <div>
                      <label htmlFor="edit-generic-name" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                        Generic name
                      </label>
                      <input
                        id="edit-generic-name"
                        type="text"
                        required
                        maxLength={200}
                        className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                        value={form.genericName}
                        onChange={(e) => setForm((prev) => ({ ...prev, genericName: e.target.value }))}
                      />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="edit-atc" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                          ATC code
                        </label>
                        <input
                          id="edit-atc"
                          type="text"
                          maxLength={20}
                          className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-mono focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                          placeholder="Leave blank if none"
                          value={form.atcCode}
                          onChange={(e) => setForm((prev) => ({ ...prev, atcCode: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label htmlFor="edit-schedule" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                          Controlled substance schedule
                        </label>
                        <select
                          id="edit-schedule"
                          className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm bg-white focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                          value={form.controlledSchedule}
                          onChange={(e) => setForm((prev) => ({ ...prev, controlledSchedule: e.target.value as KnownSchedule }))}
                        >
                          {SCHEDULE_VALUES.map((value) => (
                            <option key={value} value={value}>{SCHEDULE_LABEL[value]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-[#1e3fae] focus:ring-[#1e3fae]/20"
                        checked={form.requiresPrescription}
                        onChange={(e) => setForm((prev) => ({ ...prev, requiresPrescription: e.target.checked }))}
                      />
                      <span className="text-sm font-semibold text-slate-700">Requires a prescription</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-[#1e3fae] focus:ring-[#1e3fae]/20"
                        checked={form.retired}
                        onChange={(e) => setForm((prev) => ({ ...prev, retired: e.target.checked }))}
                      />
                      <span className="text-sm font-semibold text-slate-700">
                        Retired (hidden from new prescribing, retained for history)
                      </span>
                    </label>
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
                        onClick={() => {
                          setEditing(false);
                          setWriteError(null);
                          if (medication) {
                            const known = medication.controlled_schedule as KnownSchedule;
                            setForm({
                              genericName: medication.generic_name,
                              atcCode: medication.atc_code ?? '',
                              controlledSchedule: SCHEDULE_VALUES.includes(known) ? known : 'none',
                              requiresPrescription: medication.requires_prescription,
                              retired: medication.retired,
                            });
                          }
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                        Cancel
                      </button>
                    </div>
                  </form>
                </SectionCard>
              ) : (
                <SectionCard title="Details" bodyClassName="space-y-4">
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                    <div>
                      <dt className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">ATC code</dt>
                      <dd className="text-sm text-slate-900">
                        {medication.atc_code ? <code>{medication.atc_code}</code> : <span className="text-slate-400">—</span>}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Controlled substance</dt>
                      <dd className="text-sm text-slate-900">
                        {medication.controlled_substance ? 'Yes — scheduled' : 'No'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Prescription</dt>
                      <dd className="text-sm text-slate-900">
                        {medication.requires_prescription ? 'Required' : 'Over the counter'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Status</dt>
                      <dd className="text-sm text-slate-900">
                        {medication.retired ? 'Retired' : 'Active'}
                      </dd>
                    </div>
                  </dl>
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
