'use client';

/**
 * Medication catalogue, wired to GET /medications and POST /medications.
 *
 * The catalogue is medication MASTER DATA, not stock: a row is the generic substance and
 * its regulatory classification (ATC code, controlled-substance schedule, prescription
 * requirement), independent of any batch or site. Retired entries are hidden by default
 * because they are kept for historical reference, not for new prescribing — the
 * `include_retired` toggle surfaces them so a pharmacist can audit or reinstate one.
 *
 * `controlled_schedule` is the generated `ControlledSubstanceSchedule` enum, so the style
 * and label maps are keyed exhaustively over `Exclude<..., UnknownEnumValue>` with a
 * fallback at the call site. `controlled_substance` is a derived boolean the server
 * computes from the schedule, so it is shown read-only and never sent on create.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import { ApiError } from '@/lib/api/client';
import {
  createMedication,
  listMedications,
  humaniseCode,
  shortId,
  formatInstant,
} from '@/lib/api/pharmacy';
import type { ControlledSubstanceSchedule, Medication, UnknownEnumValue } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';
import PageHeader from '@/components/ui/page-header';
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

function scheduleBadge(schedule: ControlledSubstanceSchedule) {
  const known = schedule as KnownSchedule;
  if (SCHEDULE_VALUES.includes(known)) {
    return { tone: SCHEDULE_TONE[known], label: SCHEDULE_LABEL[known] };
  }
  // UnknownEnumValue fallback: a schedule the server may add later.
  return { tone: 'slate' as BadgeTone, label: humaniseCode(String(schedule)) };
}

interface CreateFormState {
  genericName: string;
  atcCode: string;
  controlledSchedule: KnownSchedule;
  requiresPrescription: boolean;
}

const EMPTY_CREATE_FORM: CreateFormState = {
  genericName: '',
  atcCode: '',
  controlledSchedule: 'none',
  requiresPrescription: true,
};

export default function MedicationCataloguePage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [includeRetired, setIncludeRetired] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const resource = useApiResource(
    (signal) => listMedications({ includeRetired, signal }),
    [includeRetired],
  );
  const medications = useMemo(() => resource.data?.data ?? [], [resource.data]);

  // Counts are derived from the loaded page, never stored: a projection cached separately
  // is the second answer this schema was designed to prevent.
  const stats = useMemo(() => {
    let controlled = 0;
    let retired = 0;
    let prescription = 0;
    for (const medication of medications) {
      if (medication.controlled_substance) controlled += 1;
      if (medication.retired) retired += 1;
      if (medication.requires_prescription) prescription += 1;
    }
    return { total: medications.length, controlled, retired, prescription };
  }, [medications]);

  function resetForm() {
    setForm(EMPTY_CREATE_FORM);
  }

  const submitCreate = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const genericName = form.genericName.trim();
    if (genericName === '') {
      setWriteError(
        new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Generic name is required' }),
      );
      return;
    }
    if (busy) return;
    setBusy(true);
    setWriteError(null);
    setMessage(null);
    try {
      const created = await createMedication(
        {
          generic_name: genericName,
          atc_code: form.atcCode.trim() || null,
          controlled_schedule: form.controlledSchedule,
          requires_prescription: form.requiresPrescription,
        },
        crypto.randomUUID(),
      );
      setMessage(`Medication "${created.generic_name}" created.`);
      resetForm();
      setShowCreate(false);
      await resource.reload();
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
      setWriteError(apiError);
      // A conflict here would mean the generic name already exists; re-read so the table
      // reflects the server's view rather than retrying blind.
      if (apiError.isConflict) await resource.reload();
    } finally {
      setBusy(false);
    }
  }, [busy, form, resource]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Medications' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Medication Catalogue"
            subtitle="Medication master data"
            actions={
              <button
                type="button"
                onClick={() => {
                  setShowCreate((value) => !value);
                  setWriteError(null);
                  setMessage(null);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-[20px]">{showCreate ? 'close' : 'add'}</span>
                {showCreate ? 'Cancel' : 'Create Medication'}
              </button>
            }
          />

          {/* KPI row — derived from the loaded page. */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: 'medication', tint: 'text-teal-600', label: 'Medications', value: stats.total, note: includeRetired ? 'Including retired' : 'Active only' },
              { icon: 'gavel', tint: 'text-red-600', label: 'Controlled', value: stats.controlled, note: 'Scheduled substances' },
              { icon: 'recipe', tint: 'text-blue-600', label: 'Prescription', value: stats.prescription, note: 'Requires Rx' },
              { icon: 'archive', tint: 'text-slate-600', label: 'Retired', value: stats.retired, note: 'Hidden from new use' },
            ].map((card) => (
              <div key={card.label} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>{card.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{resource.isLoading ? '—' : card.value}</p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
          </div>

          {/* Retired filter toggle. Retired entries are off by default because they are
              retained for history, not for new prescribing. */}
          <label className="inline-flex items-center gap-3 cursor-pointer select-none self-start">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-[#1e3fae] focus:ring-[#1e3fae]/20"
              checked={includeRetired}
              onChange={(e) => setIncludeRetired(e.target.checked)}
            />
            <span className="text-sm font-semibold text-slate-700">Include retired medications</span>
          </label>

          {showCreate && (
            <SectionCard title="Create medication" bodyClassName="space-y-4">
              <form onSubmit={submitCreate} className="space-y-4">
                {writeError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
                    <p className="text-sm font-bold text-red-800">
                      {writeError.isConflict ? 'This medication already exists' : writeError.title}
                    </p>
                    <p className="text-sm text-red-700 mt-1">
                      {writeError.isConflict
                        ? 'A medication with this generic name is already in the catalogue. The list has been refreshed.'
                        : writeError.message}
                    </p>
                  </div>
                )}
                <div>
                  <label htmlFor="med-generic-name" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Generic name
                  </label>
                  <input
                    id="med-generic-name"
                    type="text"
                    required
                    maxLength={200}
                    className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                    placeholder="e.g. amoxicillin"
                    value={form.genericName}
                    onChange={(e) => setForm((prev) => ({ ...prev, genericName: e.target.value }))}
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="med-atc" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      ATC code
                    </label>
                    <input
                      id="med-atc"
                      type="text"
                      maxLength={20}
                      className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-mono focus:ring-2 focus:ring-[#1e3fae]/20 focus:border-[#1e3fae] transition-all"
                      placeholder="e.g. J01CA04 (optional)"
                      value={form.atcCode}
                      onChange={(e) => setForm((prev) => ({ ...prev, atcCode: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="med-schedule" className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      Controlled substance schedule
                    </label>
                    <select
                      id="med-schedule"
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
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[20px]">{busy ? 'progress_activity' : 'add'}</span>
                    {busy ? 'Creating...' : 'Create medication'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreate(false);
                      setWriteError(null);
                      resetForm();
                    }}
                    disabled={busy}
                    className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </SectionCard>
          )}

          {!showCreate && message && (
            <p role="status" className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
              {message}
            </p>
          )}

          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={medications.length === 0}
            onRetry={resource.reload}
            loadingLabel="Loading medications…"
            errorTitle="Could not load the medication catalogue"
            forbiddenTitle="You cannot view the medication catalogue"
            emptyTitle={includeRetired ? 'No medications in the catalogue' : 'No active medications'}
            emptyBody={
              includeRetired
                ? 'The catalogue is empty. Create the first medication entry.'
                : 'There are no active medications. Toggle "Include retired" to see retired entries.'
            }
            emptyIcon="medication"
          />

          {!resource.isLoading && !resource.error && medications.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Medication catalogue</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Generic name</th>
                    <th scope="col" className="px-5 py-3">ATC code</th>
                    <th scope="col" className="px-5 py-3">Schedule</th>
                    <th scope="col" className="px-5 py-3">Rx</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {medications.map((medication: Medication) => {
                    const schedule = scheduleBadge(medication.controlled_schedule);
                    return (
                      <tr
                        key={medication.medication_id}
                        onClick={() => router.push(`/pharmacy/medications/${medication.medication_id}`)}
                        className="cursor-pointer hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-5 py-3">
                          <span className="font-bold text-slate-900">{medication.generic_name}</span>
                          <span className="block text-xs text-slate-400">
                            <code>{shortId(medication.medication_id)}</code>
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {medication.atc_code ? (
                            <code className="text-xs text-slate-600">{medication.atc_code}</code>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={schedule.tone}>{schedule.label}</Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          {medication.requires_prescription ? 'Required' : 'OTC'}
                        </td>
                        <td className="px-5 py-3">
                          {medication.retired ? (
                            <Badge tone="slate">
                              <span className="material-symbols-outlined text-[14px] mr-1">archive</span>
                              Retired
                            </Badge>
                          ) : (
                            <Badge tone="green">Active</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-500">{formatInstant(medication.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!resource.isLoading && !resource.error && medications.length > 0 && (
            <p className="py-4 text-sm text-slate-500">
              Showing <span className="font-bold text-slate-900">{medications.length}</span> medication
              {medications.length === 1 ? '' : 's'}
              {includeRetired ? ' (including retired)' : ' (active only)'}.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
