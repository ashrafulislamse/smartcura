'use client';

/**
 * Doctor IoT patient monitoring.
 *
 * TWO LISTS, ONE PAGE:
 * - `listDoctorDevices` returns devices assigned to the doctor's actively
 *   monitored patients. These are the cards shown under the "All", "Online",
 *   "Offline" and "Needs attention" filters.
 * - `listAvailableDevices` returns devices with no active assignment that the
 *   doctor's membership is entitled to assign. These are shown under the
 *   "Available" filter, each with an "Assign to Patient" button that opens a
 *   patient picker (the doctor's own patients, via `listDoctorPatients`).
 *
 * The two lists are fetched independently because they are different backend
 * surfaces: one is a projection of the caller's caseload, the other is the pool
 * of assignable devices. Collapsing them into one fetch would require a query
 * the API does not offer, and fabricating "available" client-side by filtering
 * the assigned list to null `patient_profile_id` would always return zero,
 * because `listDoctorDevices` only returns devices that ARE assigned.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import FilterPills from '@/components/ui/filter-pills';
import type { BadgeTone } from '@/components/ui/badge';
import { ApiError } from '@/lib/api/client';
import { listDoctorDevices } from '@/lib/api/doctor-api';
import { assignDoctorDevice, listAvailableDevices } from '@/lib/api/doctor-devices';
import { listDoctorPatients } from '@/lib/api/doctor-patients';
import type { Device, DeviceState, DeviceType } from '@/types/contracts';
import { shortId, humaniseCode } from '@/lib/api/directory';

type DeviceFilterKey = 'all' | 'online' | 'offline' | 'alert' | 'available';

const FILTER_TABS: ReadonlyArray<{ key: DeviceFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'online', label: 'Online' },
  { key: 'offline', label: 'Offline' },
  { key: 'alert', label: 'Needs attention' },
  { key: 'available', label: 'Available' },
];

function stateTone(state: DeviceState): BadgeTone {
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

export default function IoTPatientMonitoring() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [filter, setFilter] = useState<DeviceFilterKey>('all');

  // Assigned devices: the doctor's caseload.
  const assignedResource = useApiResource(
    (signal) => listDoctorDevices({ pageSize: 100, signal }),
    [],
  );

  // Available devices: the pool the doctor may assign from.
  const availableResource = useApiResource(
    (signal) => listAvailableDevices({ pageSize: 100, signal }),
    [],
  );

  useEffect(() => {
    if (user && user.activeRole !== 'doctor') router.replace('/dashboard');
  }, [user, router]);

  const assignedDevices = useMemo(() => assignedResource.data?.data ?? [], [assignedResource.data]);
  const availableDevices = useMemo(() => availableResource.data?.data ?? [], [availableResource.data]);

  const online = assignedDevices.filter((d) => isRecentlyOnline(d.last_seen_at)).length;
  const active = assignedDevices.filter((d) => d.state === 'active').length;
  const needsAttention = assignedDevices.filter(
    (d) => !isRecentlyOnline(d.last_seen_at) || d.state === 'suspended' || d.state === 'retired',
  ).length;

  // The "available" filter shows the unassigned pool; every other filter shows
  // the assigned list filtered client-side.
  const isAvailableFilter = filter === 'available';

  const filteredAssigned = useMemo(() => {
    if (isAvailableFilter) return [];
    if (filter === 'all') return assignedDevices;
    if (filter === 'online') return assignedDevices.filter((d) => isRecentlyOnline(d.last_seen_at));
    if (filter === 'offline') return assignedDevices.filter((d) => !isRecentlyOnline(d.last_seen_at));
    // alert / needs attention
    return assignedDevices.filter(
      (d) => !isRecentlyOnline(d.last_seen_at) || d.state === 'suspended' || d.state === 'retired',
    );
  }, [assignedDevices, filter, isAvailableFilter]);

  // Assign modal state
  const [assignDeviceId, setAssignDeviceId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<ApiError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const runWrite = useCallback(
    async (operation: () => Promise<unknown>) => {
      setIsSaving(true);
      setWriteError(null);
      try {
        await operation();
        setAssignDeviceId(null);
        assignedResource.reload();
        availableResource.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        if (apiError.isConflict) {
          assignedResource.reload();
          availableResource.reload();
        }
      } finally {
        setIsSaving(false);
      }
    },
    [assignedResource, availableResource],
  );

  if (authLoading || !user || user.activeRole !== 'doctor') {
    return <PageLoader label="Loading IoT monitoring..." />;
  }

  const showEmpty = !isAvailableFilter
    ? !assignedResource.isLoading && !assignedResource.error && assignedDevices.length === 0
    : !availableResource.isLoading && !availableResource.error && availableDevices.length === 0;

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'IoT Monitoring' }]} />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          <PageHeader
            title="IoT Patient Monitoring"
            subtitle="Devices assigned to your actively monitored patients, plus the available pool for assignment."
          />

          {/* KPI stat cards */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon="devices" label="Assigned" value={assignedDevices.length} tone="blue" />
            <StatCard icon="wifi_on" label="Recently online" value={online} tone="green" note="Seen in last 5 min" />
            <StatCard icon="monitor_heart" label="Active" value={active} tone="teal" />
            <StatCard icon="devices_other" label="Available" value={availableDevices.length} tone="slate" note="Unassigned pool" />
          </section>

          <ResourceState
            isLoading={isAvailableFilter ? availableResource.isLoading : assignedResource.isLoading}
            error={isAvailableFilter ? availableResource.error : assignedResource.error}
            isEmpty={showEmpty}
            onRetry={isAvailableFilter ? availableResource.reload : assignedResource.reload}
            loadingLabel="Loading connected devices..."
            forbiddenTitle="You cannot view these devices"
            errorTitle="Devices could not be loaded"
            emptyTitle={isAvailableFilter ? 'No available devices' : 'No connected devices'}
            emptyBody={
              isAvailableFilter
                ? 'No unassigned devices are available for you to assign.'
                : 'No devices are registered for your assigned patients.'
            }
            emptyIcon="devices"
          />

          {/* Assigned devices view (all/online/offline/alert filters) */}
          {!isAvailableFilter && assignedDevices.length > 0 && (
            <>
              <FilterPills
                tabs={FILTER_TABS}
                activeKey={filter}
                onSelect={setFilter}
              />

              <SectionCard bodyClassName="p-0">
                {filteredAssigned.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="material-symbols-outlined text-slate-300 text-5xl">filter_alt_off</span>
                    <h3 className="font-bold text-slate-900 mt-3">No devices match this filter</h3>
                    <p className="text-sm text-slate-500 mt-1">Try a different filter to see more devices.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
                    {filteredAssigned.map((d) => {
                      const onlineNow = isRecentlyOnline(d.last_seen_at);
                      return (
                        <div
                          key={d.id}
                          className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow flex flex-col gap-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="material-symbols-outlined text-[#1e3fae] text-2xl p-2 rounded-lg bg-[#1e3fae]/10 shrink-0">
                                {deviceTypeIcon(d.device_type)}
                              </span>
                              <div className="min-w-0">
                                <p className="font-bold text-slate-900 truncate">{d.serial_number}</p>
                                <p className="text-xs text-slate-500">{humaniseCode(d.device_type)}</p>
                              </div>
                            </div>
                            <Badge tone={stateTone(d.state)}>
                              {onlineNow ? 'Online' : humaniseCode(d.state)}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-slate-400 text-base">person</span>
                              <code>{shortId(d.patient_profile_id)}</code>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-slate-400 text-base">schedule</span>
                              {relativeLastSeen(d.last_seen_at)}
                            </span>
                          </div>

                          <button
                            onClick={() => router.push(`/doctor/iot/patients/${d.patient_profile_id}/history`)}
                            className="self-start inline-flex items-center gap-1.5 text-sm font-bold text-[#1e3fae] hover:text-[#1a3695] transition-colors"
                          >
                            View readings
                            <span className="material-symbols-outlined text-base">arrow_forward</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* Available devices view (unassigned pool for assignment) */}
          {isAvailableFilter && availableDevices.length > 0 && (
            <>
              <FilterPills
                tabs={FILTER_TABS}
                activeKey={filter}
                onSelect={setFilter}
              />

              <SectionCard bodyClassName="p-0">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
                  {availableDevices.map((device) => (
                    <div
                      key={device.id}
                      className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow flex flex-col gap-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="material-symbols-outlined text-[#1e3fae] text-2xl p-2 rounded-lg bg-[#1e3fae]/10 shrink-0">
                            {deviceTypeIcon(device.device_type)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate">{device.serial_number}</p>
                            <p className="text-xs text-slate-500">{humaniseCode(device.device_type)}</p>
                          </div>
                        </div>
                        <Badge tone="slate">Available</Badge>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-slate-400 text-base">schedule</span>
                          {relativeLastSeen(device.last_seen_at)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-slate-400 text-base">history</span>
                          v{device.version}
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          setAssignDeviceId(device.id);
                          setWriteError(null);
                        }}
                        className="self-start inline-flex items-center gap-1.5 text-sm font-bold text-[#1e3fae] hover:text-[#1a3695] transition-colors"
                      >
                        <span className="material-symbols-outlined text-base">person_add</span>
                        Assign to Patient
                      </button>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </>
          )}

          {/* Inline error from the last write */}
          {writeError && !assignDeviceId && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900">
                    {writeError.isConflict ? 'Conflict — the device changed' : writeError.title}
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">{writeError.message}</p>
                </div>
              </div>
            </div>
          )}

          {/* Assign to patient modal */}
          {assignDeviceId && (
            <AssignToPatientModal
              deviceId={assignDeviceId}
              deviceVersion={availableDevices.find((d) => d.id === assignDeviceId)?.version ?? 0}
              isSaving={isSaving}
              error={writeError}
              onClose={() => { setAssignDeviceId(null); setWriteError(null); }}
              onSubmit={(patientProfileId, expectedVersion) =>
                runWrite(() =>
                  assignDoctorDevice(assignDeviceId, {
                    patient_profile_id: patientProfileId,
                    expected_version: expectedVersion,
                  }),
                )
              }
            />
          )}
        </div>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Assign-to-patient modal                                                     */
/* -------------------------------------------------------------------------- */

interface AssignToPatientModalProps {
  deviceId: string;
  deviceVersion: number;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (patientProfileId: string, expectedVersion: number) => void;
}

function AssignToPatientModal({ deviceVersion, isSaving, error, onClose, onSubmit }: AssignToPatientModalProps) {
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);

  const patientResource = useApiResource(
    (signal) =>
      listDoctorPatients({
        search: submittedSearch || undefined,
        pageSize: 50,
        signal,
      }),
    [submittedSearch],
  );

  const patients = useMemo(() => patientResource.data?.data ?? [], [patientResource.data]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Assign to Patient</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <p className="text-xs text-slate-500">
            Select one of your assigned patients to receive this device.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); setSubmittedSearch(search.trim()); }}
            className="flex gap-2"
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200">
              Search
            </button>
          </form>

          {patientResource.isLoading ? (
            <p className="text-sm text-slate-500 text-center py-4">Loading patients...</p>
          ) : patients.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No patients found.</p>
          ) : (
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {patients.map((patient) => (
                <button
                  key={patient.profile_id}
                  type="button"
                  onClick={() => setSelectedPatient(patient.profile_id)}
                  className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                    selectedPatient === patient.profile_id
                      ? 'border-[#1e3fae] bg-[#1e3fae]/5'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <p className="font-bold text-slate-900 text-sm">{patient.display_name}</p>
                  <p className="text-xs text-slate-500">{patient.email}</p>
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
              disabled={!selectedPatient || isSaving}
              onClick={() => selectedPatient && onSubmit(selectedPatient, deviceVersion)}
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
