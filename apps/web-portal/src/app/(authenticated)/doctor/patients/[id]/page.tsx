'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';
import Badge from '@/components/ui/badge';
import FilterPills from '@/components/ui/filter-pills';
import type { BadgeTone } from '@/components/ui/badge';
import { ApiError } from '@/lib/api/client';
import { getDoctorPatient } from '@/lib/api/doctor-patients';
import { formatInstant, humaniseCode, initials, shortId } from '@/lib/api/directory';
import { listDoctorDevices } from '@/lib/api/doctor-api';
import { assignDoctorDevice, listAvailableDevices, releaseDoctorDevice } from '@/lib/api/doctor-devices';
import type { Device, DeviceReleaseReasonCode, DeviceState, DeviceType } from '@/types/contracts';

type TabKey = 'overview' | 'appointments' | 'notes' | 'prescriptions' | 'vitals';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'notes', label: 'Notes' },
  { key: 'prescriptions', label: 'Prescriptions' },
  { key: 'vitals', label: 'Vitals' },
];

/** Map a doctor-patient assignment status to a Badge tone. */
function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'active':
      return 'green';
    case 'pending':
    case 'invited':
    case 'applied':
      return 'amber';
    case 'suspended':
      return 'orange';
    case 'revoked':
    case 'expired':
      return 'slate';
    default:
      return 'slate';
  }
}

/** Map a device state to a Badge tone. */
function deviceStateTone(state: DeviceState): BadgeTone {
  switch (state) {
    case 'active': return 'green';
    case 'suspended': return 'amber';
    case 'retired': return 'red';
    case 'provisioned': return 'slate';
    default: return 'slate';
  }
}

function deviceTypeIcon(type: DeviceType): string {
  switch (type) {
    case 'vitals_monitor': return 'monitor_heart';
    case 'ecg': return 'ecg_heart';
    case 'thermometer': return 'thermostat';
    case 'pulse_oximeter': return 'water_drop';
    case 'simulator': return 'memory';
    default: return 'devices';
  }
}

const DEVICE_RELEASE_REASONS: ReadonlyArray<DeviceReleaseReasonCode> = [
  'administrative_request',
  'device_replaced',
  'device_fault',
  'patient_discharged',
  'assignment_correction',
  'security_incident',
  'offboarding',
];

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function isRecentlyOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - Date.parse(lastSeenAt) < ONLINE_WINDOW_MS;
}

function relativeLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'Never';
  const then = Date.parse(lastSeenAt);
  if (Number.isNaN(then)) return 'Never';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function PatientProfile() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const resource = useApiResource(
    (signal) => getDoctorPatient(params.id, signal),
    [params.id],
  );
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  if (authLoading || !user) return <PageLoader label="Loading..." />;
  if (user.activeRole !== 'doctor') return null;

  const patient = resource.data;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar
        breadcrumbs={[
          { label: 'Doctor' },
          { label: 'Patients', href: '/doctor/patients' },
          { label: 'Profile' },
        ]}
      />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          {/* Back link */}
          <button
            onClick={() => router.push('/doctor/patients')}
            className="text-sm text-slate-500 hover:text-[#1e3fae] transition-colors self-start inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to Patients
          </button>

          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={!resource.isLoading && !resource.error && !patient}
            onRetry={resource.reload}
            loadingLabel="Loading patient profile..."
            errorTitle="Could not load patient profile"
            forbiddenTitle="You cannot view this patient"
            emptyTitle="Patient profile unavailable"
            emptyBody="No assigned patient profile was returned."
            emptyIcon="person_off"
          />

          {patient && !resource.error && (
            <>
              {/* Patient header card */}
              <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex flex-col md:flex-row md:items-center gap-5">
                  <div className="size-16 rounded-full bg-[#1e3fae]/10 text-[#1e3fae] flex items-center justify-center font-bold text-2xl shrink-0">
                    {patient.display_name.trim().length > 0
                      ? initials(patient.display_name)
                      : shortId(patient.profile_id).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                        {patient.display_name.trim().length > 0
                          ? patient.display_name
                          : `Patient ${shortId(patient.profile_id)}`}
                      </h1>
                      <Badge tone={statusTone(patient.status)}>
                        {humaniseCode(patient.status)}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-slate-500">
                      {patient.email && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-slate-400 text-[18px]">
                            mail
                          </span>
                          {patient.email}
                        </span>
                      )}
                      {patient.phone_e164 && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-slate-400 text-[18px]">
                            call
                          </span>
                          {patient.phone_e164}
                        </span>
                      )}
                      {patient.preferred_locale && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-slate-400 text-[18px]">
                            translate
                          </span>
                          {patient.preferred_locale}
                        </span>
                      )}
                      {patient.timezone && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-slate-400 text-[18px]">
                            schedule
                          </span>
                          {patient.timezone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick-action buttons */}
                <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/doctor/patients/${patient.profile_id}/consultation`)
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a3694] transition-colors shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      stethoscope
                    </span>
                    Start consultation
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/doctor/notes')}
                    className="inline-flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      edit_note
                    </span>
                    New note
                  </button>
                </div>
              </section>

              {/* Tab navigation */}
              <FilterPills
                tabs={TABS}
                activeKey={activeTab}
                onSelect={setActiveTab}
              />

              {/* Tab content */}
              {activeTab === 'overview' && (
                <SectionCard title="Patient details">
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                    <div>
                      <dt className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        Display name
                      </dt>
                      <dd className="text-sm text-slate-900 mt-1">
                        {patient.display_name.trim().length > 0
                          ? patient.display_name
                          : `Patient ${shortId(patient.profile_id)}`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        Status
                      </dt>
                      <dd className="text-sm text-slate-900 mt-1">
                        <Badge tone={statusTone(patient.status)}>
                          {humaniseCode(patient.status)}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        Email
                      </dt>
                      <dd className="text-sm text-slate-900 mt-1 break-all">
                        {patient.email || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        Phone
                      </dt>
                      <dd className="text-sm text-slate-900 mt-1">
                        {patient.phone_e164 ?? 'Not provided'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        Preferred locale
                      </dt>
                      <dd className="text-sm text-slate-900 mt-1">
                        {patient.preferred_locale || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        Timezone
                      </dt>
                      <dd className="text-sm text-slate-900 mt-1">
                        {patient.timezone || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        Assigned
                      </dt>
                      <dd className="text-sm text-slate-900 mt-1">
                        {formatInstant(patient.assigned_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                        Profile ID
                      </dt>
                      <dd className="text-sm text-slate-900 mt-1">
                        <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">
                          {patient.profile_id}
                        </code>
                      </dd>
                    </div>
                  </dl>
                </SectionCard>
              )}

              {activeTab === 'appointments' && (
                <SectionCard
                  title="Appointments"
                  action={
                    <button
                      onClick={() => router.push('/doctor/appointments')}
                      className="text-sm font-bold text-[#1e3fae] hover:underline inline-flex items-center gap-1"
                    >
                      View appointments
                      <span className="material-symbols-outlined text-[18px]">
                        arrow_forward
                      </span>
                    </button>
                  }
                >
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <span className="material-symbols-outlined text-slate-300 text-5xl">
                      event
                    </span>
                    <p className="text-sm text-slate-500 max-w-sm">
                      Appointment history for this patient is available in the
                      appointments workspace. View all bookings scoped to your
                      doctor membership there.
                    </p>
                  </div>
                </SectionCard>
              )}

              {activeTab === 'notes' && (
                <SectionCard
                  title="Clinical notes"
                  action={
                    <button
                      onClick={() => router.push('/doctor/notes')}
                      className="text-sm font-bold text-[#1e3fae] hover:underline inline-flex items-center gap-1"
                    >
                      View notes
                      <span className="material-symbols-outlined text-[18px]">
                        arrow_forward
                      </span>
                    </button>
                  }
                >
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <span className="material-symbols-outlined text-slate-300 text-5xl">
                      edit_note
                    </span>
                    <p className="text-sm text-slate-500 max-w-sm">
                      Clinical notes for this patient are managed in the notes
                      workspace. Create, sign and review notes there.
                    </p>
                  </div>
                </SectionCard>
              )}

              {activeTab === 'prescriptions' && (
                <SectionCard
                  title="Prescriptions"
                  action={
                    <button
                      onClick={() => router.push('/doctor/prescriptions')}
                      className="text-sm font-bold text-[#1e3fae] hover:underline inline-flex items-center gap-1"
                    >
                      View prescriptions
                      <span className="material-symbols-outlined text-[18px]">
                        arrow_forward
                      </span>
                    </button>
                  }
                >
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <span className="material-symbols-outlined text-slate-300 text-5xl">
                      medication
                    </span>
                    <p className="text-sm text-slate-500 max-w-sm">
                      Prescriptions for this patient are managed in the
                      prescriptions workspace.
                    </p>
                  </div>
                </SectionCard>
              )}

              {activeTab === 'vitals' && (
                <VitalsTab
                  patientProfileId={patient.profile_id}
                  onNavigateHistory={() =>
                    router.push(
                      `/doctor/iot/patients/${patient.profile_id}/history`,
                    )
                  }
                />
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Vitals tab — device assignment and readings history link                     */
/* -------------------------------------------------------------------------- */

interface VitalsTabProps {
  patientProfileId: string;
  onNavigateHistory: () => void;
}

function VitalsTab({ patientProfileId, onNavigateHistory }: VitalsTabProps) {
  // Fetch all the doctor's devices, then filter client-side to this patient.
  // The backend scopes to the doctor's assigned patients, so the full list is
  // already bounded by the doctor's caseload.
  const deviceResource = useApiResource(
    (signal) => listDoctorDevices({ pageSize: 100, signal }),
    [],
  );

  const patientDevices = useMemo(
    () =>
      (deviceResource.data?.data ?? []).filter(
        (d) => d.patient_profile_id === patientProfileId,
      ),
    [deviceResource.data, patientProfileId],
  );

  const [showAssignModal, setShowAssignModal] = useState(false);
  const [releaseDeviceId, setReleaseDeviceId] = useState<string | null>(null);
  const [releaseReason, setReleaseReason] = useState<DeviceReleaseReasonCode>('patient_discharged');
  const [writeError, setWriteError] = useState<ApiError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const runWrite = useCallback(
    async (operation: () => Promise<unknown>) => {
      setIsSaving(true);
      setWriteError(null);
      try {
        await operation();
        setShowAssignModal(false);
        setReleaseDeviceId(null);
        deviceResource.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        if (apiError.isConflict) deviceResource.reload();
      } finally {
        setIsSaving(false);
      }
    },
    [deviceResource],
  );

  return (
    <>
      <SectionCard
        title="Assigned Devices"
        action={
          <button
            onClick={() => { setWriteError(null); setShowAssignModal(true); }}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1e3fae] hover:underline"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Assign Device
          </button>
        }
      >
        {patientDevices.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="material-symbols-outlined text-slate-300 text-5xl">devices_off</span>
            <p className="text-sm text-slate-500 max-w-sm">
              No IoT devices are assigned to this patient. Click "Assign Device" to
              connect an available device.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {patientDevices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="material-symbols-outlined text-[#1e3fae] text-2xl p-2 rounded-lg bg-[#1e3fae]/10 shrink-0">
                    {deviceTypeIcon(device.device_type)}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{device.serial_number}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-0.5">
                      <span>{humaniseCode(device.device_type)}</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-slate-400 text-[14px]">schedule</span>
                        {relativeLastSeen(device.last_seen_at)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Badge tone={deviceStateTone(device.state)}>
                    {isRecentlyOnline(device.last_seen_at) ? 'Online' : humaniseCode(device.state)}
                  </Badge>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      setReleaseDeviceId(device.id);
                      setReleaseReason('patient_discharged');
                      setWriteError(null);
                    }}
                    className="text-sm font-bold text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Release
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Inline error from the last write */}
        {writeError && !showAssignModal && !releaseDeviceId && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
            <p className="text-sm font-bold text-red-700">
              {writeError.isConflict ? 'Conflict — the device changed' : writeError.title}
            </p>
            <p className="text-xs text-red-600 mt-1">{writeError.message}</p>
          </div>
        )}
      </SectionCard>

      {/* Release confirmation inline */}
      {releaseDeviceId && (
        <div className="bg-white rounded-xl border border-red-200 shadow-sm p-5">
          <h3 className="font-bold text-slate-900">Release device</h3>
          <p className="text-sm text-slate-600 mt-1">
            Select a reason for releasing this device from the patient.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <select
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value as DeviceReleaseReasonCode)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
            >
              {DEVICE_RELEASE_REASONS.map((r) => (
                <option key={r} value={r}>{humaniseCode(r)}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                const device = patientDevices.find((d) => d.id === releaseDeviceId);
                runWrite(() =>
                  releaseDoctorDevice(releaseDeviceId!, {
                    expected_version: device?.version ?? 0,
                    reason_code: releaseReason,
                  }),
                );
              }}
              className="px-4 py-2 rounded-lg bg-red-600 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isSaving ? 'Releasing...' : 'Confirm release'}
            </button>
            <button
              type="button"
              onClick={() => setReleaseDeviceId(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
          {writeError && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {writeError.isConflict ? 'Conflict — the device changed' : writeError.title}
              </p>
              <p className="text-xs text-red-600 mt-1">{writeError.message}</p>
            </div>
          )}
        </div>
      )}

      {/* Readings history link */}
      <SectionCard
        title="Vital readings history"
        action={
          <button
            onClick={onNavigateHistory}
            className="text-sm font-bold text-[#1e3fae] hover:underline inline-flex items-center gap-1"
          >
            View vitals history
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        }
      >
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="material-symbols-outlined text-slate-300 text-5xl">monitor_heart</span>
          <p className="text-sm text-slate-500 max-w-sm">
            Historical vital readings for this patient are available in the
            vitals history view.
          </p>
        </div>
      </SectionCard>

      {/* Assign device modal */}
      {showAssignModal && (
        <AssignDeviceModalInner
          patientProfileId={patientProfileId}
          isSaving={isSaving}
          error={writeError}
          onClose={() => { setShowAssignModal(false); setWriteError(null); }}
          onSubmit={(deviceId, expectedVersion) =>
            runWrite(() =>
              assignDoctorDevice(deviceId, {
                patient_profile_id: patientProfileId,
                expected_version: expectedVersion,
              }),
            )
          }
        />
      )}
    </>
  );
}

interface AssignDeviceModalInnerProps {
  patientProfileId: string;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (deviceId: string, expectedVersion: number) => void;
}

function AssignDeviceModalInner({ isSaving, error, onClose, onSubmit }: AssignDeviceModalInnerProps) {
  const availableResource = useApiResource(
    (signal) => listAvailableDevices({ pageSize: 50, signal }),
    [],
  );
  const availableDevices = useMemo(() => availableResource.data?.data ?? [], [availableResource.data]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const selectedDevice = availableDevices.find((d) => d.id === selectedDeviceId) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Assign Device</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <p className="text-xs text-slate-500">
            Select an available device to assign to this patient.
          </p>

          {availableResource.isLoading ? (
            <p className="text-sm text-slate-500 text-center py-4">Loading available devices...</p>
          ) : availableDevices.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No available devices to assign.</p>
          ) : (
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {availableDevices.map((device) => (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => setSelectedDeviceId(device.id)}
                  className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                    selectedDeviceId === device.id
                      ? 'border-[#1e3fae] bg-[#1e3fae]/5'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[#1e3fae] text-xl shrink-0">
                      {deviceTypeIcon(device.device_type)}
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{device.serial_number}</p>
                      <p className="text-xs text-slate-500">
                        {humaniseCode(device.device_type)} · v{device.version}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
              <p className="text-sm font-bold text-red-700">
                {error.isConflict ? 'Conflict — the device changed' : error.title}
              </p>
              <p className="text-xs text-red-600 mt-1">{error.message}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedDevice || isSaving}
              onClick={() => selectedDevice && onSubmit(selectedDevice.id, selectedDevice.version)}
              className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#1a3694] disabled:opacity-50"
            >
              {isSaving ? 'Assigning...' : 'Assign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
