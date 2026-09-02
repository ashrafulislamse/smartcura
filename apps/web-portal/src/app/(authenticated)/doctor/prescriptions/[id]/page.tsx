'use client';

/**
 * Prescription detail, wired to GET /prescriptions/{id}.
 *
 * Unlike clinical notes, a prescription DOES have a read-one endpoint
 * (`GET /prescriptions/{id}`), so this page fetches the single record directly.
 *
 * EDIT AND SIGN carry `expected_version` from the prescription as read. A 409 means the
 * version in hand is stale; the record is re-read so a retry uses fresh state.
 *
 * A prescription can only be edited while it is in `draft` status. Signing transitions
 * it to `signed` and requires an `expires_at` value (the existing one, or null to leave
 * it open-ended). Discarding transitions it to `discarded`.
 *
 * The generated contract types `PrescriptionItem` as a bare `string`, but the backend
 * serializer emits each item as a structured object. The local interface mirrors that
 * runtime payload; the cast bridges the generator's limitation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import SectionCard from '@/components/ui/section-card';
import Badge, { type BadgeTone } from '@/components/ui/badge';
import {
  cancelPrescription,
  downloadPrescriptionPdf,
  getPrescription,
  supersedePrescription,
  transitionPrescription,
  updatePrescription,
} from '@/lib/api/clinical';
import { ApiError } from '@/lib/api/client';
import { formatInstant, humaniseCode, shortId } from '@/lib/api/directory';
import type {
  CancelPrescriptionRequest,
  Prescription,
  PrescriptionItemInput,
  PrescriptionStatus,
  SupersedePrescriptionRequest,
  TransitionPrescriptionRequest,
  UnknownEnumValue,
  UpdatePrescriptionRequest,
} from '@/types/contracts';

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

const PRESCRIPTION_STATUS_TONE: Record<
  KnownPrescriptionStatus,
  BadgeTone
> = {
  draft: 'amber',
  signed: 'green',
  superseded: 'slate',
  cancelled: 'red',
  expired: 'orange',
  discarded: 'slate',
};

function asItem(value: Prescription['items'][number]): PrescriptionItemPayload {
  return value as unknown as PrescriptionItemPayload;
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

function itemToDraft(item: PrescriptionItemPayload): ItemDraft {
  return {
    medication_text: item.medication_text?.trim() ?? '',
    dose_value: item.dose_value?.trim() ?? '',
    dose_unit: item.dose_unit?.trim() ?? '',
    route_code: item.route_code?.trim() ?? 'oral',
    frequency_text: item.frequency_text?.trim() ?? '',
    duration_days: item.duration_days != null ? String(item.duration_days) : '',
    patient_instructions: item.patient_instructions?.trim() ?? '',
  };
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

/**
 * Converts an ISO-8601 instant (from the backend) into the local "YYYY-MM-DDTHH:mm"
 * value a `<input type="datetime-local">` expects, so a stored `expires_at` round-trips
 * into the correction form without timezone confusion.
 */
function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function PrescriptionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const prescriptionId = String(params.id);

  const resource = useApiResource(
    (signal) => getPrescription(prescriptionId, signal),
    [prescriptionId],
  );

  const record = resource.data;

  const notFound = resource.error?.status === 404;

  const status = record?.status as KnownPrescriptionStatus | undefined;
  const isDraft = status === 'draft';
  const isSigned = status === 'signed';
  const isCancelled = status === 'cancelled';
  const isExpired = status === 'expired';
  const isDiscarded = status === 'discarded';
  const isSuperseded = status === 'superseded';
  const isMutable = isDraft;

  const [editing, setEditing] = useState(false);
  const [itemDrafts, setItemDrafts] = useState<ItemDraft[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<ApiError | null>(null);

  // Cancel signed prescription — modal with a structured reason_code.
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Supersede (issue correction) — modal that atomically signs a replacement and
  // supersedes the immutable prior prescription. Reuses the ItemDraft shape.
  const [showSupersedeModal, setShowSupersedeModal] = useState(false);
  const [supersedeItems, setSupersedeItems] = useState<ItemDraft[]>([emptyItem()]);
  const [supersedeDiagnosis, setSupersedeDiagnosis] = useState('');
  const [supersedeExpiresAt, setSupersedeExpiresAt] = useState('');

  // Download PDF — generated on first request, returned as a base64 data URI.
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<ApiError | null>(null);

  // Seed the editable items from the saved record on every reload. The supersede
  // correction drafts are seeded from the same items so a correction starts as a
  // copy the doctor can then edit, rather than a blank row.
  useEffect(() => {
    if (!record) return;
    const items = record.items.map((raw) => itemToDraft(asItem(raw)));
    const seed = items.length > 0 ? items : [emptyItem()];
    setItemDrafts(seed);
    setSupersedeItems(seed.map((draft) => ({ ...draft })));
    setSupersedeDiagnosis(record.diagnosis ?? '');
    setSupersedeExpiresAt(record.expires_at ?? '');
  }, [record]);

  function updateItem(index: number, field: keyof ItemDraft, value: string) {
    setItemDrafts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addItem() {
    setItemDrafts((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setItemDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSupersedeItem(index: number, field: keyof ItemDraft, value: string) {
    setSupersedeItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addSupersedeItem() {
    setSupersedeItems((prev) => [...prev, emptyItem()]);
  }

  function removeSupersedeItem(index: number) {
    setSupersedeItems((prev) => prev.filter((_, i) => i !== index));
  }

  function buildItemInputs(drafts: ItemDraft[]): PrescriptionItemInput[] | null {
    const inputs: PrescriptionItemInput[] = [];
    for (const draft of drafts) {
      if (draft.medication_text.trim() === '' || draft.dose_value.trim() === '' || draft.dose_unit.trim() === '') {
        setMessage('Each item needs a medication name, dose value and unit.');
        return null;
      }
      inputs.push({
        medication_reference: null,
        medication_text: draft.medication_text.trim(),
        dose_value: draft.dose_value.trim(),
        dose_unit: draft.dose_unit.trim(),
        route_code: draft.route_code.trim() || 'oral',
        frequency_code: null,
        frequency_text: draft.frequency_text.trim() || null,
        duration_days: draft.duration_days.trim() ? Number(draft.duration_days) : 0,
        patient_instructions: draft.patient_instructions.trim() || null,
      });
    }
    return inputs;
  }

  const runUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!record) return;
      const items = buildItemInputs(itemDrafts);
      if (items === null) return;
      setBusy(true);
      setWriteError(null);
      setMessage(null);
      const body: UpdatePrescriptionRequest = {
        items,
        expected_version: record.version,
      };
      try {
        const updated = await updatePrescription(prescriptionId, body, crypto.randomUUID());
        setMessage(`Prescription saved (v${updated.version}).`);
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
    [record, prescriptionId, resource, itemDrafts],
  );

  const runTransition = useCallback(
    async (target: 'signed' | 'discarded') => {
      if (!record) return;
      setBusy(true);
      setWriteError(null);
      setMessage(null);
      const body: TransitionPrescriptionRequest = {
        status: target,
        expected_version: record.version,
        // Preserve the existing expiry when signing; null leaves it open-ended.
        expires_at: record.expires_at ?? null,
      };
      try {
        const result = await transitionPrescription(prescriptionId, body, crypto.randomUUID());
        setMessage(`Prescription ${humaniseCode(result.status)}.`);
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
    [record, prescriptionId, resource],
  );

  // Cancel a signed prescription with a structured reason_code. The backend stamps
  // `cancellation_reason_code`; the signed record itself becomes immutable.
  const runCancel = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!record) return;
      const reason = cancelReason.trim();
      if (!reason) {
        setWriteError(
          new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'A reason code is required' }),
        );
        return;
      }
      setBusy(true);
      setWriteError(null);
      setMessage(null);
      const body: CancelPrescriptionRequest = {
        reason_code: reason,
        expected_version: record.version,
      };
      try {
        const result = await cancelPrescription(prescriptionId, body, crypto.randomUUID());
        setMessage(`Prescription ${humaniseCode(result.status)}.`);
        setShowCancelModal(false);
        setCancelReason('');
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
    [record, prescriptionId, resource, cancelReason],
  );

  // Supersede: atomically sign a correction and replace the immutable prior prescription.
  // The replacement starts as a copy of the current items so the doctor edits a copy,
  // never the locked record. `expires_at` is optional (null leaves it open-ended).
  const runSupersede = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!record) return;
      const items = buildItemInputs(supersedeItems);
      if (items === null) return;
      setBusy(true);
      setWriteError(null);
      setMessage(null);
      const body: SupersedePrescriptionRequest = {
        items,
        diagnosis: supersedeDiagnosis.trim() || null,
        expected_version: record.version,
        expires_at: supersedeExpiresAt.trim() ? supersedeExpiresAt.trim() : null,
      };
      try {
        const result = await supersedePrescription(prescriptionId, body, crypto.randomUUID());
        setMessage(`Correction issued: Rx ${shortId(result.prescription_id)} (${humaniseCode(result.status)}).`);
        setShowSupersedeModal(false);
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
    [record, prescriptionId, resource, supersedeItems, supersedeDiagnosis, supersedeExpiresAt],
  );

  // Download the signed PDF. The backend returns a base64 data URI; opening it in a
  // new tab renders the PDF without a download round-trip through a CDN.
  const runDownloadPdf = useCallback(async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const response = await downloadPrescriptionPdf(prescriptionId);
      if (response.download_url) {
        window.open(response.download_url, '_blank', 'noopener,noreferrer');
      } else {
        setPdfError(
          new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'No PDF available' }),
        );
      }
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Could not download PDF' });
      setPdfError(apiError);
    } finally {
      setPdfBusy(false);
    }
  }, [prescriptionId, pdfBusy]);

  if (authLoading || !user) return <PageLoader label="Loading your session..." />;
  if (user.activeRole !== 'doctor') return null;

  const items = record ? record.items.map(asItem) : [];

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Doctor' },
          { label: 'Prescriptions', href: '/doctor/prescriptions' },
          { label: shortId(prescriptionId) },
        ]}
      />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[1000px] mx-auto flex flex-col gap-6">
          <button
            type="button"
            onClick={() => router.push('/doctor/prescriptions')}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#1e3fae] transition-colors self-start"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to prescriptions
          </button>

          {notFound ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
              <span className="material-symbols-outlined text-slate-300 text-5xl">medication</span>
              <h2 className="font-bold text-slate-900 mt-3">Prescription not found</h2>
              <p className="text-sm text-slate-500 mt-1">
                This prescription does not exist, or you do not have access to it.
              </p>
              <button
                onClick={() => router.push('/doctor/prescriptions')}
                className="inline-block mt-4 text-sm font-bold text-[#1e3fae] hover:underline"
              >
                Back to prescriptions
              </button>
            </div>
          ) : (
            <ResourceState
              isLoading={resource.isLoading}
              error={resource.error}
              isEmpty={false}
              onRetry={resource.reload}
              loadingLabel="Loading prescription..."
              errorTitle="Could not load prescription"
              forbiddenTitle="You cannot view this prescription"
              emptyTitle=""
              emptyBody=""
              emptyIcon=""
            />
          )}

          {record && !resource.error && (
            <>
              {/* Header */}
              <SectionCard>
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                        Rx <code className="text-slate-700">{shortId(record.prescription_id)}</code>
                      </h1>
                      <Badge tone={PRESCRIPTION_STATUS_TONE[status ?? 'draft'] ?? 'slate'}>
                        {humaniseCode(record.status)}
                      </Badge>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-bold">
                        v{record.version}
                      </span>
                      {record.document_status && (
                        <Badge tone="teal">
                          {humaniseCode(String(record.document_status))}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">person</span>
                        Patient <code className="text-slate-600">{shortId(record.patient_profile_id)}</code>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">stethoscope</span>
                        Consultation <code className="text-slate-600">{shortId(record.consultation_id)}</code>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">schedule</span>
                        Created {formatInstant(record.created_at)}
                      </span>
                      {record.signed_at && (
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">verified</span>
                          Signed {formatInstant(record.signed_at)}
                        </span>
                      )}
                      {record.expires_at && (
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">event_busy</span>
                          Expires {formatInstant(record.expires_at)}
                        </span>
                      )}
                      {record.replaces_prescription_id && (
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">swap_vert</span>
                          Replaces <code>{shortId(record.replaces_prescription_id)}</code>
                        </span>
                      )}
                    </div>
                    {isCancelled && record.cancellation_reason_code && (
                      <p className="text-xs text-red-600 mt-1.5 inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">cancel</span>
                        Cancelled: {humaniseCode(record.cancellation_reason_code)}
                      </p>
                    )}
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
                      <>
                        <button
                          type="button"
                          onClick={() => { setShowCancelModal(true); setWriteError(null); setMessage(null); }}
                          disabled={busy}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[20px]">cancel</span>
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowSupersedeModal(true); setWriteError(null); setMessage(null); }}
                          disabled={busy}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#173080] disabled:opacity-50 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[20px]">edit_note</span>
                          Issue correction
                        </button>
                      </>
                    )}
                    {!isMutable && (
                      <button
                        type="button"
                        onClick={() => void runDownloadPdf()}
                        disabled={pdfBusy}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">{pdfBusy ? 'progress_activity' : 'picture_as_pdf'}</span>
                        {pdfBusy ? 'Preparing...' : 'Download PDF'}
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
                      ? 'You cannot modify this prescription'
                      : writeError.isConflict
                        ? 'Conflict — the prescription changed since you loaded it. Please retry.'
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
                  {isSigned && 'This prescription is signed and locked. Use Cancel or Issue correction to amend it.'}
                  {isCancelled && 'This prescription has been cancelled.'}
                  {isExpired && 'This prescription has expired.'}
                  {isDiscarded && 'This prescription has been discarded.'}
                  {isSuperseded && 'This prescription has been superseded by a newer version.'}
                </div>
              )}

              {/* Editable items or read-only display */}
              {editing && isMutable ? (
                <SectionCard
                  title="Edit prescription items"
                  action={
                    <button
                      type="button"
                      onClick={addItem}
                      className="inline-flex items-center gap-1 text-sm font-bold text-[#1e3fae] hover:underline"
                    >
                      <span className="material-symbols-outlined text-base">add</span>
                      Add item
                    </button>
                  }
                >
                  <form onSubmit={runUpdate} className="space-y-4">
                    {itemDrafts.map((item, index) => (
                      <div key={index} className="rounded-lg border border-slate-200 p-4 space-y-3 bg-slate-50/50">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Item {index + 1}</span>
                          {itemDrafts.length > 1 && (
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
                <SectionCard title="Medication items">
                  {items.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-8">This prescription has no items.</p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <div className="grid grid-cols-12 gap-3 text-xs font-bold text-slate-500 uppercase tracking-wide bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                        <span className="col-span-5">Medication</span>
                        <span className="col-span-2">Dosage</span>
                        <span className="col-span-3">Directions</span>
                        <span className="col-span-2">Duration</span>
                      </div>
                      <ul className="flex flex-col divide-y divide-slate-100">
                        {items.map((item, index) => (
                          <li key={item.prescription_item_id ?? index} className="grid grid-cols-12 gap-3 px-4 py-3 text-sm">
                            <div className="col-span-5 flex flex-col">
                              <span className="font-semibold text-slate-900">
                                {item.medication_text?.trim() || item.medication_reference?.trim() || 'Unnamed medication'}
                              </span>
                              <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                                <span className="material-symbols-outlined text-[14px]">route</span>
                                {humaniseCode(item.route_code || '—')}
                              </span>
                            </div>
                            <span className="col-span-2 text-slate-700 self-center">
                              {[item.dose_value, item.dose_unit].filter(Boolean).join(' ').trim() || '—'}
                            </span>
                            <span className="col-span-3 text-slate-600 self-center text-xs leading-relaxed">
                              {item.patient_instructions?.trim() || (item.frequency_text?.trim() || item.frequency_code?.trim() || '—')}
                            </span>
                            <span className="col-span-2 text-slate-600 self-center text-xs">
                              {item.duration_days ? `${item.duration_days} day${item.duration_days === 1 ? '' : 's'}` : '—'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </SectionCard>
              )}

              {/* PDF download error */}
              {pdfError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                  <p className="text-sm font-bold text-red-700">
                    {pdfError.isForbidden
                      ? 'You cannot download this prescription'
                      : pdfError.isConflict
                        ? 'Conflict — the prescription changed since you loaded it. Please retry.'
                        : pdfError.title}
                  </p>
                  <p className="text-xs text-red-600 mt-1">{pdfError.message}</p>
                </div>
              )}

              {/* Cancel signed prescription modal */}
              {showCancelModal && record && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                      <h2 className="text-lg font-bold text-slate-900">Cancel prescription</h2>
                      <button
                        type="button"
                        onClick={() => { setShowCancelModal(false); setCancelReason(''); setWriteError(null); }}
                        className="text-slate-400 hover:text-slate-600"
                        aria-label="Close"
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <form onSubmit={runCancel} className="p-6 flex flex-col gap-4">
                      <p className="text-sm text-slate-500">
                        Cancellation stamps a structured reason code on the signed record and locks
                        it. This cannot be undone. To issue replacement items instead, close this and
                        use <strong>Issue correction</strong>.
                      </p>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                          Reason code <span className="text-red-500">*</span>
                        </span>
                        <input
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          placeholder="e.g. patient_request, clinical_error, duplicate_issue"
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          pattern="^[a-z][a-z0-9_]{1,62}$"
                          required
                          autoFocus
                        />
                        <span className="text-xs text-slate-400">
                          Lowercase snake_case, 2-63 chars (e.g. <code>patient_request</code>).
                        </span>
                      </label>
                      {writeError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                          <p className="text-sm font-bold text-red-700">
                            {writeError.isForbidden
                              ? 'You cannot cancel this prescription'
                              : writeError.isConflict
                                ? 'Conflict — the prescription changed since you loaded it. Please retry.'
                                : writeError.needsStepUp
                                  ? 'Recent authentication is required to cancel a prescription.'
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
                          onClick={() => { setShowCancelModal(false); setCancelReason(''); setWriteError(null); }}
                          disabled={busy}
                          className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[20px]">{busy ? 'progress_activity' : 'cancel'}</span>
                          {busy ? 'Cancelling...' : 'Confirm cancel'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Supersede (issue correction) modal */}
              {showSupersedeModal && record && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                  role="dialog"
                  aria-modal="true"
                >
                  <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                      <h2 className="text-lg font-bold text-slate-900">Issue correction</h2>
                      <button
                        type="button"
                        onClick={() => { setShowSupersedeModal(false); setWriteError(null); }}
                        className="text-slate-400 hover:text-slate-600"
                        aria-label="Close"
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <form onSubmit={runSupersede} className="p-6 flex flex-col gap-4">
                      <p className="text-sm text-slate-500">
                        This atomically signs a replacement and supersedes Rx{' '}
                        <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">
                          {shortId(record.prescription_id)}
                        </code>
                        . The prior record stays immutable and points to the new one.
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                          Replacement items
                        </span>
                        <button
                          type="button"
                          onClick={addSupersedeItem}
                          className="inline-flex items-center gap-1 text-sm font-bold text-[#1e3fae] hover:underline"
                        >
                          <span className="material-symbols-outlined text-base">add</span>
                          Add item
                        </button>
                      </div>

                      <div className="flex flex-col gap-3">
                        {supersedeItems.map((item, index) => (
                          <div key={index} className="rounded-lg border border-slate-200 p-4 space-y-3 bg-slate-50/50">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                                Item {index + 1}
                              </span>
                              {supersedeItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeSupersedeItem(index)}
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
                                onChange={(e) => updateSupersedeItem(index, 'medication_text', e.target.value)}
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
                                  onChange={(e) => updateSupersedeItem(index, 'dose_value', e.target.value)}
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
                                  onChange={(e) => updateSupersedeItem(index, 'dose_unit', e.target.value)}
                                  placeholder="e.g. mg"
                                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                  required
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs font-bold text-slate-600">Route</span>
                                <input
                                  value={item.route_code}
                                  onChange={(e) => updateSupersedeItem(index, 'route_code', e.target.value)}
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
                                  onChange={(e) => updateSupersedeItem(index, 'frequency_text', e.target.value)}
                                  placeholder="e.g. 3 times daily"
                                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs font-bold text-slate-600">Duration (days)</span>
                                <input
                                  type="number"
                                  value={item.duration_days}
                                  onChange={(e) => updateSupersedeItem(index, 'duration_days', e.target.value)}
                                  placeholder="e.g. 7"
                                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                />
                              </label>
                            </div>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-bold text-slate-600">Patient instructions</span>
                              <input
                                value={item.patient_instructions}
                                onChange={(e) => updateSupersedeItem(index, 'patient_instructions', e.target.value)}
                                placeholder="e.g. Take with food"
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                              />
                            </label>
                          </div>
                        ))}
                      </div>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                          Diagnosis
                        </span>
                        <input
                          value={supersedeDiagnosis}
                          onChange={(e) => setSupersedeDiagnosis(e.target.value)}
                          placeholder="Optional diagnosis for the replacement"
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                          Expires at
                        </span>
                        <input
                          type="datetime-local"
                          value={supersedeExpiresAt ? toDateTimeLocalValue(supersedeExpiresAt) : ''}
                          onChange={(e) => {
                            // datetime-local yields a local "YYYY-MM-DDTHH:mm" string; convert
                            // to an ISO-8601 instant for the backend, or empty for open-ended.
                            setSupersedeExpiresAt(e.target.value ? new Date(e.target.value).toISOString() : '');
                          }}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                        <span className="text-xs text-slate-400">Leave blank for an open-ended prescription.</span>
                      </label>

                      {writeError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                          <p className="text-sm font-bold text-red-700">
                            {writeError.isForbidden
                              ? 'You cannot correct this prescription'
                              : writeError.isConflict
                                ? 'Conflict — the prescription changed since you loaded it. Please retry.'
                                : writeError.needsStepUp
                                  ? 'Recent authentication is required to issue a correction.'
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
                          onClick={() => { setShowSupersedeModal(false); setWriteError(null); }}
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
