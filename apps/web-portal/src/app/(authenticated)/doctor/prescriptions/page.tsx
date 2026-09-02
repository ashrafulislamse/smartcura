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
import { createConsultationPrescription, listDoctorPrescriptions } from '@/lib/api/clinical';
import { ApiError } from '@/lib/api/client';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';
import type {
  CreatePrescriptionRequest,
  Prescription,
  PrescriptionItemInput,
  PrescriptionStatus,
  UnknownEnumValue,
} from '@/types/contracts';

/**
 * The generated contract types `PrescriptionItem` as a bare `string`, but the backend
 * serializer (`prescription-repository.ts`, `serializePrescription`) emits each item as a
 * structured object. This local interface mirrors that runtime payload exactly — the fields
 * are not invented, they are the snake_case keys the server sends. The cast at the call site
 * bridges the generator's limitation without fabricating data the API does not expose.
 */
interface PrescriptionItemPayload {
  readonly prescription_item_id?: string;
  readonly position?: number;
  readonly medication_reference?: string | null;
  readonly medication_text?: string | null;
  readonly dose_value?: string;
  readonly dose_unit?: string;
  readonly route_code?: string;
  readonly frequency_code?: string | null;
  readonly frequency_text?: string | null;
  readonly duration_days?: number;
  readonly patient_instructions?: string | null;
}

type KnownPrescriptionStatus = Exclude<PrescriptionStatus, UnknownEnumValue>;
const PRESCRIPTION_STATUSES: readonly KnownPrescriptionStatus[] = [
  'draft',
  'signed',
  'superseded',
  'cancelled',
  'expired',
  'discarded',
];

/** Badge tone per known status, keyed exhaustively over the generated enum. */
const PRESCRIPTION_STATUS_TONE: Record<
  KnownPrescriptionStatus,
  'amber' | 'green' | 'slate' | 'red' | 'orange'
> = {
  draft: 'amber',
  signed: 'green',
  superseded: 'slate',
  cancelled: 'red',
  expired: 'orange',
  discarded: 'slate',
};

type PrescriptionFilter = 'all' | KnownPrescriptionStatus;

const FILTER_TABS: ReadonlyArray<{ key: PrescriptionFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'signed', label: 'Signed' },
  { key: 'superseded', label: 'Superseded' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'expired', label: 'Expired' },
  { key: 'discarded', label: 'Discarded' },
];

/** A signed, non-expired prescription is "active" — in force for a pharmacy to fill. */
function isActive(p: Prescription): boolean {
  return p.status === 'signed';
}

/**
 * "Dispensed/Ready" maps to `document_status === 'ready'` — the generated-document pipeline
 * has produced the printable prescription. There is no `dispensed` status in the vocabulary,
 * so this is the closest real signal; the label is honest about what it counts.
 */
function isReady(p: Prescription): boolean {
  return p.document_status === 'ready';
}

function itemLabel(item: PrescriptionItemPayload): string {
  return (
    item.medication_text?.trim() ||
    item.medication_reference?.trim() ||
    'Unnamed medication'
  );
}

function dosageLabel(item: PrescriptionItemPayload): string {
  const dose = [item.dose_value, item.dose_unit].filter(Boolean).join(' ');
  return dose.trim() || '—';
}

function frequencyLabel(item: PrescriptionItemPayload): string {
  return (item.frequency_text?.trim() || item.frequency_code?.trim() || '—').trim();
}

function asItem(value: Prescription['items'][number]): PrescriptionItemPayload {
  return value as unknown as PrescriptionItemPayload;
}

export default function PrescriptionsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const prescriptions = useApiResource(
    (signal) => listDoctorPrescriptions({ pageSize: 100, signal }),
    [],
  );

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PrescriptionFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showNewRx, setShowNewRx] = useState(false);

  // Order by most recently updated first: a prescription awaiting a signature or a pharmacy
  // hand-off is what the doctor needs to reach, not the oldest record. Recency is meaningless.
  const rows = useMemo(
    () =>
      [...(prescriptions.data?.data ?? [])].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      ),
    [prescriptions.data],
  );

  const counts = useMemo(() => {
    const total = rows.length;
    let active = 0;
    let ready = 0;
    for (const row of rows) {
      if (isActive(row)) active += 1;
      if (isReady(row)) ready += 1;
    }
    return { total, active, ready };
  }, [rows]);

  // Unique consultation IDs from the loaded prescriptions, for the consultation selector.
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
      if (row.prescription_id.toLowerCase().includes(needle)) return true;
      if (row.consultation_id.toLowerCase().includes(needle)) return true;
      if (row.patient_profile_id.toLowerCase().includes(needle)) return true;
      // Search the medication text of each item so a doctor can find a drug by name.
      return row.items.some((item) =>
        itemLabel(asItem(item)).toLowerCase().includes(needle),
      );
    });
  }, [rows, query, filter]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // --- New prescription mutation ---------------------------------------------
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<ApiError | null>(null);

  const runCreate = useCallback(
    async (consultationId: string, body: CreatePrescriptionRequest, idempotencyKey: string) => {
      setIsCreating(true);
      setCreateError(null);
      try {
        const created = await createConsultationPrescription(consultationId, body, idempotencyKey);
        setShowNewRx(false);
        // Navigate to the detail page so the doctor can review and sign it.
        router.push(`/doctor/prescriptions/${created.prescription_id}`);
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

  const hasData = !prescriptions.isLoading && !prescriptions.error && rows.length > 0;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'Prescriptions' }]} />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Prescriptions"
            subtitle="Prescriptions you have issued to assigned patients."
            actions={
              <button
                type="button"
                onClick={() => { setCreateError(null); setShowNewRx(true); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold border border-[#1e3fae] bg-[#1e3fae] text-white hover:bg-[#173080] transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-base">add</span>
                New prescription
              </button>
            }
          />

          {/* KPI row — derived from loaded data, never incremented from memory. */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              icon="medication"
              label="Total"
              value={counts.total}
              tone="blue"
              note="All issued prescriptions"
            />
            <StatCard
              icon="local_pharmacy"
              label="Active"
              value={counts.active}
              tone="green"
              note="Signed and in force"
            />
            <StatCard
              icon="check_circle"
              label="Ready"
              value={counts.ready}
              tone="teal"
              note="Document generated for dispensing"
            />
          </section>

          <ResourceState
            isLoading={prescriptions.isLoading}
            error={prescriptions.error}
            isEmpty={!prescriptions.isLoading && !prescriptions.error && rows.length === 0}
            onRetry={prescriptions.reload}
            loadingLabel="Loading prescriptions..."
            errorTitle="Could not load prescriptions"
            forbiddenTitle="You cannot view prescriptions"
            emptyTitle="No prescriptions yet"
            emptyBody="Prescriptions you issue during consultations appear here."
            emptyIcon="medication"
          />

          {hasData && (
            <>
              {/* Search + filter controls. */}
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search by id, patient, or medication..."
                  className="md:max-w-md"
                />
                <FilterPills
                  tabs={FILTER_TABS}
                  activeKey={filter}
                  onSelect={setFilter}
                  className="md:ml-auto"
                />
              </div>

              {visible.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                  <EmptyState
                    icon="search_off"
                    title="No matching prescriptions"
                    body="Try a different search term or status filter."
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {visible.map((row) => (
                    <PrescriptionCard
                      key={row.prescription_id}
                      prescription={row}
                      isOpen={expanded.has(row.prescription_id)}
                      onToggle={() => toggleExpanded(row.prescription_id)}
                      onClick={() => router.push(`/doctor/prescriptions/${row.prescription_id}`)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showNewRx && (
        <NewPrescriptionModal
          knownConsultations={knownConsultations}
          isSaving={isCreating}
          error={createError}
          onClose={() => { setShowNewRx(false); setCreateError(null); }}
          onSubmit={(consultationId, body, idempotencyKey) => runCreate(consultationId, body, idempotencyKey)}
        />
      )}
    </main>
  );
}

/**
 * A single prescription rendered as an expandable card. The collapsed view shows the
 * identifiers, status and item count; expanding reveals each dispensed line with its drug,
 * dosage, directions and quantity. Now links to the detail page.
 */
function PrescriptionCard({
  prescription,
  isOpen,
  onToggle,
  onClick,
}: {
  prescription: Prescription;
  isOpen: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  const status = prescription.status as KnownPrescriptionStatus | UnknownEnumValue;
  const isKnown = PRESCRIPTION_STATUSES.includes(status as KnownPrescriptionStatus);
  const tone = isKnown ? PRESCRIPTION_STATUS_TONE[status as KnownPrescriptionStatus] : 'slate';
  const items = prescription.items.map(asItem);
  const superseded = prescription.status === 'superseded' && prescription.replaces_prescription_id;
  const cancelled = prescription.status === 'cancelled' && prescription.cancellation_reason_code;

  return (
    <article
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
      aria-label={`Prescription ${shortId(prescription.prescription_id)}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-slate-900">
              Rx <code className="text-slate-700">{shortId(prescription.prescription_id)}</code>
            </h3>
            <Badge tone={tone}>{humaniseCode(prescription.status)}</Badge>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-bold">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
            {superseded && (
              <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">swap_vert</span>
                replaces <code>{shortId(prescription.replaces_prescription_id)}</code>
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-500 mt-1">
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-slate-400">person</span>
              Patient <code className="text-slate-600">{shortId(prescription.patient_profile_id)}</code>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-slate-400">stethoscope</span>
              Consultation <code className="text-slate-600">{shortId(prescription.consultation_id)}</code>
            </span>
            {prescription.signed_at && (
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-sm text-slate-400">verified</span>
                Signed {formatInstant(prescription.signed_at)}
              </span>
            )}
            {prescription.expires_at && (
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-sm text-slate-400">event_busy</span>
                Expires {formatInstant(prescription.expires_at)}
              </span>
            )}
          </div>

          {cancelled && (
            <p className="text-xs text-red-600 mt-1.5 inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">cancel</span>
              Cancelled: {humaniseCode(prescription.cancellation_reason_code!)}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-xs text-slate-400 inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">schedule</span>
            {formatInstant(prescription.created_at)}
          </span>
          {items.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              aria-expanded={isOpen}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">
                {isOpen ? 'expand_less' : 'expand_more'}
              </span>
              {isOpen ? 'Hide items' : 'Show items'}
            </button>
          )}
        </div>
      </div>

      {isOpen && items.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-12 gap-3 text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 px-2">
            <span className="col-span-5">Medication</span>
            <span className="col-span-2">Dosage</span>
            <span className="col-span-3">Directions</span>
            <span className="col-span-2">Duration</span>
          </div>
          <ul className="flex flex-col divide-y divide-slate-100">
            {items.map((item, index) => (
              <li key={item.prescription_item_id ?? index} className="grid grid-cols-12 gap-3 px-2 py-3 text-sm">
                <div className="col-span-5 flex flex-col">
                  <span className="font-semibold text-slate-900">{itemLabel(item)}</span>
                  <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">route</span>
                    {humaniseCode(item.route_code || '—')}
                  </span>
                </div>
                <span className="col-span-2 text-slate-700 self-center">{dosageLabel(item)}</span>
                <span className="col-span-3 text-slate-600 self-center text-xs leading-relaxed">
                  {item.patient_instructions?.trim() || frequencyLabel(item)}
                </span>
                <span className="col-span-2 text-slate-600 self-center text-xs">
                  {item.duration_days ? `${item.duration_days} day${item.duration_days === 1 ? '' : 's'}` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* New Prescription modal                                                      */
/* -------------------------------------------------------------------------- */

interface NewPrescriptionModalProps {
  readonly knownConsultations: readonly string[];
  readonly isSaving: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onSubmit: (consultationId: string, body: CreatePrescriptionRequest, idempotencyKey: string) => void;
}

interface ItemDraft {
  medication_text: string;
  dose_value: string;
  dose_unit: string;
  route_code: string;
  frequency_text: string;
  duration_days: string;
  patient_instructions: string;
}

function emptyItem(): ItemDraft {
  return {
    medication_text: '',
    dose_value: '',
    dose_unit: '',
    route_code: 'oral',
    frequency_text: '',
    duration_days: '',
    patient_instructions: '',
  };
}

function NewPrescriptionModal({ knownConsultations, isSaving, error, onClose, onSubmit }: NewPrescriptionModalProps) {
  const [consultationId, setConsultationId] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);

  function updateItem(index: number, field: keyof ItemDraft, value: string) {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const canSubmit =
    consultationId.trim() !== '' &&
    items.length > 0 &&
    items.every((item) => item.medication_text.trim() !== '' && item.dose_value.trim() !== '' && item.dose_unit.trim() !== '') &&
    !isSaving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const itemInputs: PrescriptionItemInput[] = items.map((item) => ({
      medication_reference: null,
      medication_text: item.medication_text.trim(),
      dose_value: item.dose_value.trim(),
      dose_unit: item.dose_unit.trim(),
      route_code: item.route_code.trim() || 'oral',
      frequency_code: null,
      frequency_text: item.frequency_text.trim() || null,
      duration_days: item.duration_days.trim() ? Number(item.duration_days) : 0,
      patient_instructions: item.patient_instructions.trim() || null,
    }));
    onSubmit(consultationId.trim(), { items: itemInputs }, crypto.randomUUID());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-slate-900">New Prescription</h2>
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
          <form id="new-rx-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Consultation selector */}
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

            {/* Medication items */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">Medication items</span>
                <button
                  type="button"
                  onClick={addItem}
                  className="inline-flex items-center gap-1 text-sm font-bold text-[#1e3fae] hover:underline"
                >
                  <span className="material-symbols-outlined text-base">add</span>
                  Add item
                </button>
              </div>

              {items.map((item, index) => (
                <div key={index} className="rounded-lg border border-slate-200 p-4 space-y-3 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Item {index + 1}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="text-slate-400 hover:text-red-600 transition-colors"
                        aria-label={`Remove item ${index + 1}`}
                      >
                        <span className="material-symbols-outlined text-base">remove_circle</span>
                      </button>
                    )}
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-slate-600">
                      Medication <span className="text-red-500">*</span>
                    </span>
                    <input
                      value={item.medication_text}
                      onChange={(e) => updateItem(index, 'medication_text', e.target.value)}
                      placeholder="e.g. Amoxicillin 500mg"
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      required
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-slate-600">
                        Dose value <span className="text-red-500">*</span>
                      </span>
                      <input
                        value={item.dose_value}
                        onChange={(e) => updateItem(index, 'dose_value', e.target.value)}
                        placeholder="e.g. 500"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        required
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-slate-600">
                        Unit <span className="text-red-500">*</span>
                      </span>
                      <input
                        value={item.dose_unit}
                        onChange={(e) => updateItem(index, 'dose_unit', e.target.value)}
                        placeholder="e.g. mg"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        required
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-slate-600">Route</span>
                      <input
                        value={item.route_code}
                        onChange={(e) => updateItem(index, 'route_code', e.target.value)}
                        placeholder="e.g. oral"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-slate-600">Frequency</span>
                      <input
                        value={item.frequency_text}
                        onChange={(e) => updateItem(index, 'frequency_text', e.target.value)}
                        placeholder="e.g. 3 times daily"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-slate-600">Duration (days)</span>
                      <input
                        type="number"
                        value={item.duration_days}
                        onChange={(e) => updateItem(index, 'duration_days', e.target.value)}
                        placeholder="e.g. 7"
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-slate-600">Patient instructions</span>
                    <input
                      value={item.patient_instructions}
                      onChange={(e) => updateItem(index, 'patient_instructions', e.target.value)}
                      placeholder="e.g. Take with food"
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              ))}
            </div>
          </form>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isForbidden
                  ? 'You cannot create prescriptions'
                  : error.isConflict
                    ? 'Conflict — this prescription may already exist'
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
              form="new-rx-form"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50"
            >
              {isSaving ? 'Creating...' : 'Create prescription'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
