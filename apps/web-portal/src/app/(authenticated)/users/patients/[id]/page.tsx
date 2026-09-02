'use client';

/**
 * Patient detail, wired to GET /organizations/{id}/patients/{patient_profile_id}.
 *
 * RECONCILIATION WITH THE PREVIOUS MOCK. The old mock detail page showed
 * `gender`, `age`, `bloodGroup`, `address`, `allergies`, `totalVisits`,
 * `lastVisit` and `nextAppointment`. The read-one endpoint returns only
 * `display_name`, `email`, `phone_e164`, `status`, `joined_at` and
 * `membership_id`. Those clinical fields are removed rather than approximated.
 *
 * A 404 IS NOT ONLY "DOES NOT EXIST". The API declines to confirm a patient
 * the caller cannot read, answering 404 rather than 403, so "not found" here
 * may also mean "not in your organization". The explicit 404 branch (copied
 * from `users/doctors/[id]`) renders a dedicated panel instead of routing
 * through `ResourceState`'s generic empty state.
 *
 * CARE ASSIGNMENTS. The page additionally loads the patient's care assignments
 * via `listCareAssignments` (filtered to this patient profile id client-side,
 * since the endpoint is not patient-scoped) and offers two admin actions, both
 * requiring MFA step-up: assign an approved doctor (chosen from the directory
 * via `listDoctors`) and end an active assignment. Both quote the optimistic
 * version from the row as read.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import {
  PROFILE_STATUS_STYLE,
  humaniseCode,
  shortId,
  formatInstant,
  listDoctors,
} from '@/lib/api/directory';
import { readOrganizationPatient } from '@/lib/api/workstream-f';
import {
  createCareAssignment,
  endCareAssignment,
  listCareAssignments,
} from '@/lib/api/care-assignments';
import { ApiError } from '@/lib/api/client';
import type {
  CareAssignment,
  CareAssignmentEndReason,
  UnknownEnumValue,
} from '@/types/contracts';

/** The known members of an enum, excluding the forward-compatibility escape hatch. */
type Known<T> = Exclude<T, UnknownEnumValue>;

/** Statuses an end-assignment may set. `expired` is a system outcome, not an admin one. */
const END_STATUSES: ReadonlyArray<'completed' | 'revoked'> = ['completed', 'revoked'];

/** Reason codes the end endpoint accepts, declared once so the picker cannot drift. */
const END_REASONS: ReadonlyArray<Known<CareAssignmentEndReason>> = [
  'care_completed',
  'patient_request',
  'clinician_request',
  'administrative_request',
  'membership_ended',
  'assignment_correction',
];

type ModalKind = 'assign' | 'end' | null;

export default function PatientDetailsPage() {
  const { activeMembership, isLoading: authLoading } = useAuth();
  const patientId = String(useParams().id);
  const organizationId = activeMembership?.organization_id;

  const resource = useApiResource(
    (signal) =>
      organizationId
        ? readOrganizationPatient(organizationId, patientId, signal)
        : Promise.resolve(null),
    [organizationId, patientId],
  );

  // Care assignments for this patient. The endpoint is organization-scoped, so
  // a larger page is fetched and filtered client-side to this patient's profile id.
  const assignmentsResource = useApiResource(
    (signal) => listCareAssignments({ pageSize: 100, signal }),
    [patientId],
  );
  const assignments = useMemo(
    () =>
      (assignmentsResource.data?.data ?? []).filter(
        (a) => a.patient_profile_id === patientId,
      ),
    [assignmentsResource.data, patientId],
  );
  const activeAssignments = useMemo(
    () => assignments.filter((a) => a.status === 'active'),
    [assignments],
  );

  const [modal, setModal] = useState<ModalKind>(null);
  const [activeAssignment, setActiveAssignment] = useState<CareAssignment | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [writeError, setWriteError] = useState<ApiError | null>(null);

  const closeModal = useCallback(() => {
    setModal(null);
    setActiveAssignment(null);
    setWriteError(null);
  }, []);

  const runWrite = useCallback(
    async (operation: () => Promise<unknown>) => {
      setIsSaving(true);
      setWriteError(null);
      try {
        await operation();
        closeModal();
        assignmentsResource.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({
                status: 0,
                code: 'CLIENT_ERROR',
                title: 'Unexpected client error',
                detail: caught instanceof Error ? caught.message : String(caught),
              });
        setWriteError(apiError);
        if (apiError.isConflict) assignmentsResource.reload();
      } finally {
        setIsSaving(false);
      }
    },
    [closeModal, assignmentsResource],
  );

  if (authLoading) return <div className="p-8 text-slate-500">Loading session...</div>;

  if (!organizationId)
    return (
      <main className="p-8">
        <ResourceState
          isLoading={false}
          error={null}
          isEmpty
          onRetry={resource.reload}
          loadingLabel="Loading patient..."
          forbiddenTitle="Patient unavailable"
          errorTitle="Patient unavailable"
          emptyTitle="No active organization"
          emptyBody="Select an active membership before viewing this patient."
          emptyIcon="person_off"
        />
      </main>
    );

  const patient = resource.data;
  const notFound = resource.error?.status === 404;

  return (
    <main className="flex-1 min-h-screen bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Users' },
          { label: 'Patients', href: '/users/patients' },
          { label: patient?.display_name ?? 'Patient' },
        ]}
      />
      <div className="p-5 sm:p-8 max-w-5xl mx-auto space-y-6">
        <Link href="/users/patients" className="text-sm font-bold text-[#1e3fae]">
          ← Back to patients
        </Link>

        {/* Explicit 404 — not found or not readable by this caller */}
        {notFound ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <span className="material-symbols-outlined text-6xl text-slate-300">person_off</span>
            <h2 className="text-xl font-bold text-slate-900 mt-4">Patient not found</h2>
            <p className="text-sm text-slate-500 mt-2">
              This patient is not available in your active organization.
            </p>
          </div>
        ) : (
          <>
            <ResourceState
              isLoading={resource.isLoading}
              error={resource.error}
              isEmpty={!patient}
              onRetry={resource.reload}
              loadingLabel="Loading patient..."
              forbiddenTitle="You cannot view this patient"
              errorTitle="Patient could not be loaded"
              emptyTitle="Patient not found"
              emptyBody="This patient is not available in your active organization."
              emptyIcon="person_off"
            />

            {patient && (
              <>
                {/* Header card */}
                <section className="bg-white rounded-2xl border border-slate-200 p-6">
                  <div className="flex items-start gap-4">
                    <div className="size-14 rounded-2xl bg-blue-100 text-[#1e3fae] flex items-center justify-center text-xl font-black">
                      {patient.display_name.charAt(0)}
                    </div>
                    <div>
                      <h1 className="text-3xl font-black text-slate-900">
                        {patient.display_name}
                      </h1>
                      <p className="text-sm text-slate-400 font-mono mt-1">
                        {shortId(patient.profile_id)}
                      </p>
                      <span
                        className={`inline-block mt-3 rounded-full border px-3 py-1 text-xs font-bold ${
                          PROFILE_STATUS_STYLE[
                            patient.status as keyof typeof PROFILE_STATUS_STYLE
                          ] ?? 'bg-slate-50 text-slate-600 border-slate-100'
                        }`}
                      >
                        {humaniseCode(patient.status)}
                      </span>
                    </div>
                  </div>
                </section>

                {/* Detail cards */}
                <section className="grid sm:grid-cols-2 gap-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <h2 className="font-bold text-slate-900">Contact</h2>
                    <p className="text-sm text-slate-600 mt-3">{patient.email}</p>
                    <p className="text-sm text-slate-600 mt-1">
                      {patient.phone_e164 ?? 'No phone recorded'}
                    </p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <h2 className="font-bold text-slate-900">Membership</h2>
                    <p className="text-sm text-slate-500 mt-3">
                      Joined {new Date(patient.joined_at).toLocaleString()}
                    </p>
                    <code className="text-xs text-slate-400 break-all">
                      {shortId(patient.membership_id)}
                    </code>
                  </div>
                </section>

                {/* Care assignments */}
                <section className="bg-white rounded-2xl border border-slate-200 p-6">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="font-bold text-slate-900">Care assignments</h2>
                      <p className="text-sm text-slate-500 mt-1">
                        Doctors assigned to this patient. Admin, step-up required.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => {
                        setWriteError(null);
                        setModal('assign');
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a3694] transition-colors shadow-sm disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[20px]">person_add</span>
                      Assign doctor
                    </button>
                  </div>

                  {assignmentsResource.isLoading ? (
                    <p className="text-sm text-slate-500 py-4 text-center">
                      Loading care assignments…
                    </p>
                  ) : assignmentsResource.error ? (
                    <div
                      className="rounded-xl border border-red-200 bg-red-50 p-4"
                      role="alert"
                    >
                      <p className="text-sm font-bold text-red-700">
                        Could not load care assignments
                      </p>
                      <p className="text-xs text-red-600 mt-1">
                        {assignmentsResource.error.message}
                      </p>
                    </div>
                  ) : assignments.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">
                      No care assignments recorded for this patient.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {assignments.map((assignment) => {
                        const isActive = assignment.status === 'active';
                        return (
                          <div
                            key={assignment.id}
                            className="rounded-lg border border-slate-200 p-4 flex items-start justify-between gap-4"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-slate-900">
                                  Doctor{' '}
                                  <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">
                                    {shortId(assignment.clinician_membership_id)}
                                  </code>
                                </span>
                                <span
                                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                                    isActive
                                      ? 'bg-green-50 text-green-700 border-green-100'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}
                                >
                                  {humaniseCode(assignment.status)}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                Assigned {formatInstant(assignment.assigned_at)}
                                {assignment.ended_at &&
                                  ` · ended ${formatInstant(assignment.ended_at)}`}
                                {assignment.ended_reason &&
                                  ` · ${humaniseCode(assignment.ended_reason)}`}
                              </p>
                            </div>
                            {isActive && (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => {
                                  setActiveAssignment(assignment);
                                  setWriteError(null);
                                  setModal('end');
                                }}
                                className="shrink-0 inline-flex items-center gap-1.5 text-sm font-bold text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
                              >
                                <span className="material-symbols-outlined text-base">link_off</span>
                                End assignment
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {writeError && !modal && (
                    <div
                      className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4"
                      role="alert"
                    >
                      <p className="text-sm font-bold text-red-700">
                        {writeError.isConflict
                          ? 'Conflict — the assignment changed'
                          : writeError.needsStepUp
                            ? 'Re-authentication required'
                            : writeError.title}
                      </p>
                      <p className="text-xs text-red-600 mt-1">
                        {writeError.needsStepUp
                          ? 'This action requires a recent MFA step-up. Re-authenticate and try again.'
                          : writeError.message}
                      </p>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>

      {/* Assign doctor modal */}
      {modal === 'assign' && organizationId && (
        <AssignDoctorModal
          organizationId={organizationId}
          patientProfileId={patientId}
          isSaving={isSaving}
          error={writeError}
          onClose={closeModal}
          onSubmit={(clinicianMembershipId, idempotencyKey) =>
            runWrite(() =>
              createCareAssignment(
                organizationId,
                {
                  clinician_membership_id: clinicianMembershipId,
                  patient_profile_id: patientId,
                },
                idempotencyKey,
              ),
            )
          }
        />
      )}

      {/* End assignment modal */}
      {modal === 'end' && activeAssignment && organizationId && (
        <EndAssignmentModal
          assignment={activeAssignment}
          isSaving={isSaving}
          error={writeError}
          onClose={closeModal}
          onSubmit={(status, reason) =>
            runWrite(() =>
              endCareAssignment(organizationId, activeAssignment.id, {
                expected_version: activeAssignment.version,
                status,
                reason,
              }),
            )
          }
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Modals                                                                      */
/* -------------------------------------------------------------------------- */

interface ModalShellProps {
  title: string;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}

function ModalShell({ title, isSaving, error, onClose, children, footer }: ModalShellProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
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
          {children}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isConflict
                  ? 'Conflict — the assignment changed'
                  : error.needsStepUp
                    ? 'Re-authentication required'
                    : error.isForbidden
                      ? 'Permission denied'
                      : error.title}
              </p>
              <p className="text-xs text-red-600 mt-1">
                {error.needsStepUp
                  ? 'This action requires a recent MFA step-up. Re-authenticate and try again.'
                  : error.message}
              </p>
            </div>
          )}
          {footer}
        </div>
      </div>
    </div>
  );
}

interface AssignDoctorModalProps {
  organizationId: string;
  patientProfileId: string;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (clinicianMembershipId: string, idempotencyKey: string) => void;
}

function AssignDoctorModal({
  patientProfileId,
  isSaving,
  error,
  onClose,
  onSubmit,
}: AssignDoctorModalProps) {
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);

  const doctorResource = useApiResource(
    (signal) =>
      listDoctors({
        q: submittedSearch || undefined,
        sort: 'rating',
        signal,
      }),
    [submittedSearch],
  );

  const doctors = useMemo(() => doctorResource.data?.data ?? [], [doctorResource.data]);

  return (
    <ModalShell
      title="Assign doctor"
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedDoctor || isSaving}
            onClick={() => selectedDoctor && onSubmit(selectedDoctor, crypto.randomUUID())}
            className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#1a3694] disabled:opacity-50"
          >
            {isSaving ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      }
    >
      <p className="text-xs text-slate-500">
        Select an approved doctor to assign to patient{' '}
        <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">
          {shortId(patientProfileId)}
        </code>
        . Only doctors in the approved directory are offered.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedSearch(search.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or specialty"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200"
        >
          Search
        </button>
      </form>

      {doctorResource.isLoading ? (
        <p className="text-sm text-slate-500 text-center py-4">Loading doctors…</p>
      ) : doctors.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-4">
          {submittedSearch ? 'No doctors match your search.' : 'Search for a doctor to assign.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {doctors.map((doctor) => (
            <button
              key={doctor.membership_id}
              type="button"
              onClick={() => setSelectedDoctor(doctor.membership_id)}
              className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                selectedDoctor === doctor.membership_id
                  ? 'border-[#1e3fae] bg-[#1e3fae]/5'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <p className="font-bold text-slate-900 text-sm">{doctor.display_name}</p>
              <p className="text-xs text-slate-500">
                {doctor.primary_specialty ? humaniseCode(doctor.primary_specialty) : 'Specialty not stated'}
                {doctor.review_count > 0 &&
                  ` · ${(doctor.rating_average ?? 0).toFixed(1)} (${doctor.review_count})`}
              </p>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-amber-600 inline-flex items-center gap-1">
        <span className="material-symbols-outlined text-[14px]">lock_clock</span>
        Requires MFA step-up. Idempotent on the idempotency key.
      </p>
    </ModalShell>
  );
}

interface EndAssignmentModalProps {
  assignment: CareAssignment;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (status: 'completed' | 'revoked', reason: Known<CareAssignmentEndReason>) => void;
}

function EndAssignmentModal({
  assignment,
  isSaving,
  error,
  onClose,
  onSubmit,
}: EndAssignmentModalProps) {
  const [status, setStatus] = useState<'completed' | 'revoked'>('completed');
  const [reason, setReason] = useState<Known<CareAssignmentEndReason>>(END_REASONS[0]);

  return (
    <ModalShell
      title="End care assignment"
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      footer={
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
            form="end-assignment-form"
            disabled={isSaving}
            className="px-4 py-2 rounded-lg bg-red-600 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isSaving ? 'Ending…' : 'End assignment'}
          </button>
        </div>
      }
    >
      <p className="text-sm text-slate-600">
        Assignment <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">{shortId(assignment.id)}</code>.
        Doctor{' '}
        <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">
          {shortId(assignment.clinician_membership_id)}
        </code>
        . The version is quoted optimistically.
      </p>
      <form
        id="end-assignment-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (isSaving) return;
          onSubmit(status, reason);
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Outcome</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'completed' | 'revoked')}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
          >
            {END_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseCode(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as Known<CareAssignmentEndReason>)}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
          >
            {END_REASONS.map((r) => (
              <option key={r} value={r}>
                {humaniseCode(r)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-amber-600 inline-flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">lock_clock</span>
          Requires MFA step-up.
        </p>
      </form>
    </ModalShell>
  );
}
