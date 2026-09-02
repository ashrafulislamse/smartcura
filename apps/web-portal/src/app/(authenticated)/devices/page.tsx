'use client';

/**
 * Admin device registry, wired to the organization-scoped device endpoints.
 *
 * SCOPE. The organization is the caller's own active membership organization,
 * never a parameter the page accepts. A non-admin is redirected to the dashboard
 * rather than shown a permission wall, because an admin page with no menu entry
 * is a dead end and the redirect is the cleaner outcome.
 *
 * RECONCILIATION. The device list carries only what the API models: serial
 * number, device type, state, last_seen_at, active_assignment, version. The
 * assigned patient is shown as the shortId of `active_assignment.patient_profile_id`
 * because no endpoint resolves a profile name here — the same constraint that
 * shapes the patient directory page. No name is fabricated.
 *
 * CONFLICTS. Assign and release carry `expected_version` from the row as read.
 * A 409 (DEVICE_ALREADY_ASSIGNED or DEVICE_VERSION_CONFLICT) is shown inline and
 * the list is re-read so the version in hand is never stale on retry.
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
import {
  assignDevice,
  DEVICE_CREDENTIAL_TYPES,
  DEVICE_RELEASE_REASONS,
  DEVICE_TYPES,
  listOrgDevices,
  registerDevice,
  releaseDevice,
} from '@/lib/api/devices';
import { submitDeviceVitalReadings } from '@/lib/api/iot';
import { listOrganizationPatients } from '@/lib/api/workstream-f';
import type {
  Device,
  DeviceCredentialType,
  DeviceReleaseReasonCode,
  DeviceState,
  DeviceType,
  RegisterDeviceRequest,
  UnknownEnumValue,
  VitalMetric,
  VitalReadingQuality,
} from '@/types/contracts';
import { shortId, humaniseCode, formatInstant } from '@/lib/api/directory';

/** The known members of an enum, excluding the forward-compatibility escape hatch. */
type Known<T> = Exclude<T, UnknownEnumValue>;

/** Vital metrics offered in the simulator submit form. */
const VITAL_METRICS: ReadonlyArray<Known<VitalMetric>> = [
  'heart_rate',
  'oxygen_saturation',
  'body_temperature',
  'systolic_bp',
  'diastolic_bp',
  'respiratory_rate',
  'blood_glucose',
  'body_weight',
];

/** Quality values a submitter may assert, in order of typical use. */
const VITAL_QUALITIES: ReadonlyArray<Known<VitalReadingQuality>> = [
  'valid',
  'suspect',
  'invalid',
  'unknown',
];

/** UCUM units the sample contract accepts. */
type VitalUnit = '/min' | '%' | 'Cel' | 'mm[Hg]' | 'mV';
const VITAL_UNITS: ReadonlyArray<VitalUnit> = ['/min', '%', 'Cel', 'mm[Hg]', 'mV'];

type DeviceFilterKey = 'all' | 'assigned' | 'available' | 'offline';

const FILTER_TABS: ReadonlyArray<{ key: DeviceFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'available', label: 'Available' },
  { key: 'offline', label: 'Offline' },
];

// Five minutes — within this window the device is considered "recently online".
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

function stateTone(state: DeviceState): BadgeTone {
  switch (state) {
    case 'active': return 'green';
    case 'suspended': return 'amber';
    case 'retired': return 'red';
    case 'provisioned': return 'slate';
    default: return 'slate';
  }
}

type ModalKind = 'register' | 'assign' | 'release' | 'submit-readings' | null;

export default function DeviceRegistryPage() {
  const router = useRouter();
  const { user, activeMembership, isLoading: authLoading } = useAuth();
  const organizationId = activeMembership?.organization_id ?? null;

  const [filter, setFilter] = useState<DeviceFilterKey>('all');
  const [modal, setModal] = useState<ModalKind>(null);
  const [activeDevice, setActiveDevice] = useState<Device | null>(null);
  const [writeError, setWriteError] = useState<ApiError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Redirect non-admin users. The route guard already denies access, but a
  // user who navigates directly is shown a clean redirect rather than a wall.
  useEffect(() => {
    if (user && user.activeRole !== 'admin' && user.activeRole !== 'super_admin') {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const resource = useApiResource(
    (signal) =>
      organizationId
        ? listOrgDevices(organizationId, { pageSize: 100, signal })
        : Promise.resolve(null),
    [organizationId],
  );

  const devices = useMemo(() => resource.data?.data ?? [], [resource.data]);

  const assigned = useMemo(() => devices.filter((d) => d.active_assignment !== null).length, [devices]);
  const available = useMemo(() => devices.filter((d) => d.active_assignment === null).length, [devices]);
  const needsAttention = useMemo(
    () => devices.filter((d) => !isRecentlyOnline(d.last_seen_at) || d.state === 'suspended' || d.state === 'retired').length,
    [devices],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return devices;
    if (filter === 'assigned') return devices.filter((d) => d.active_assignment !== null);
    if (filter === 'available') return devices.filter((d) => d.active_assignment === null);
    // offline
    return devices.filter((d) => !isRecentlyOnline(d.last_seen_at));
  }, [devices, filter]);

  const runWrite = useCallback(
    async (operation: () => Promise<unknown>) => {
      setIsSaving(true);
      setWriteError(null);
      try {
        await operation();
        setModal(null);
        setActiveDevice(null);
        resource.reload();
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError({ status: 0, code: 'CLIENT_ERROR', title: 'Unexpected client error' });
        setWriteError(apiError);
        // A conflict means the version in hand is stale; re-read so a retry uses fresh state.
        if (apiError.isConflict) resource.reload();
      } finally {
        setIsSaving(false);
      }
    },
    [resource],
  );

  if (authLoading || !user) return <PageLoader label="Loading device registry..." />;
  if (user.activeRole !== 'admin' && user.activeRole !== 'super_admin') {
    return <PageLoader label="Redirecting..." />;
  }

  if (!organizationId) {
    return (
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
        <TopBar breadcrumbs={[{ label: 'Devices' }]} />
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-[1200px] mx-auto">
            <ResourceState
              isLoading={false}
              error={null}
              isEmpty
              onRetry={resource.reload}
              loadingLabel="Loading devices..."
              forbiddenTitle="Devices unavailable"
              errorTitle="Devices unavailable"
              emptyTitle="No active organization"
              emptyBody="Select an active membership before viewing the device registry."
              emptyIcon="devices"
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Devices' }, { label: 'Device Registry' }]} />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          <PageHeader
            title="Device Registry"
            subtitle="Register, assign and release IoT devices for your organization."
            actions={
              <button
                type="button"
                onClick={() => { setWriteError(null); setModal('register'); }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3fae] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a3694] transition-colors shadow-sm"
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
                Register Device
              </button>
            }
          />

          {/* KPI stat cards */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon="devices" label="Total" value={devices.length} tone="blue" />
            <StatCard icon="person_check" label="Assigned" value={assigned} tone="green" note="Active assignment" />
            <StatCard icon="devices_other" label="Available" value={available} tone="teal" note="Unassigned" />
            <StatCard icon="warning" label="Needs attention" value={needsAttention} tone="red" note="Offline or suspended" />
          </section>

          <ResourceState
            isLoading={resource.isLoading}
            error={resource.error}
            isEmpty={!resource.isLoading && !resource.error && devices.length === 0}
            onRetry={resource.reload}
            loadingLabel="Loading registered devices..."
            forbiddenTitle="You cannot view the device registry"
            errorTitle="Devices could not be loaded"
            emptyTitle="No devices registered"
            emptyBody="Register a device to start tracking its assignments and vitals."
            emptyIcon="devices"
          />

          {devices.length > 0 && (
            <>
              <FilterPills
                tabs={FILTER_TABS}
                activeKey={filter}
                onSelect={setFilter}
              />

              <SectionCard bodyClassName="p-0">
                {filtered.length === 0 ? (
                  <div className="text-center py-12">
                    <span className="material-symbols-outlined text-slate-300 text-5xl">filter_alt_off</span>
                    <h3 className="font-bold text-slate-900 mt-3">No devices match this filter</h3>
                    <p className="text-sm text-slate-500 mt-1">Try a different filter to see more devices.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
                    {filtered.map((device) => {
                      const onlineNow = isRecentlyOnline(device.last_seen_at);
                      const isAssigned = device.active_assignment !== null;
                      return (
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
                            <Badge tone={stateTone(device.state)}>
                              {onlineNow ? 'Online' : humaniseCode(device.state)}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-slate-400 text-base">person</span>
                              {isAssigned ? (
                                <code>{shortId(device.active_assignment!.patient_profile_id)}</code>
                              ) : (
                                <span className="text-slate-400">Unassigned</span>
                              )}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-slate-400 text-base">schedule</span>
                              {relativeLastSeen(device.last_seen_at)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-slate-400 text-base">history</span>
                              v{device.version}
                            </span>
                          </div>

                          {device.firmware_version && (
                            <p className="text-xs text-slate-400">
                              Firmware {device.firmware_version}
                              {device.hardware_revision ? ` · HW ${device.hardware_revision}` : ''}
                            </p>
                          )}

                          {/* Per-device actions */}
                          <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
                            {isAssigned ? (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => {
                                  setActiveDevice(device);
                                  setWriteError(null);
                                  setModal('release');
                                }}
                                className="inline-flex items-center gap-1.5 text-sm font-bold text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
                              >
                                <span className="material-symbols-outlined text-base">link_off</span>
                                Release
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isSaving || device.state === 'retired'}
                                onClick={() => {
                                  setActiveDevice(device);
                                  setWriteError(null);
                                  setModal('assign');
                                }}
                                className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1e3fae] hover:text-[#1a3695] transition-colors disabled:opacity-50"
                              >
                                <span className="material-symbols-outlined text-base">link</span>
                                Assign
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isSaving || device.state === 'retired'}
                              onClick={() => {
                                setActiveDevice(device);
                                setWriteError(null);
                                setModal('submit-readings');
                              }}
                              className="inline-flex items-center gap-1.5 text-sm font-bold text-teal-600 hover:text-teal-700 transition-colors disabled:opacity-50"
                              title="Admin / simulator: submit a vital reading on behalf of this device"
                            >
                              <span className="material-symbols-outlined text-base">monitor_heart</span>
                              Submit reading
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* Inline conflict / error message from the last write */}
          {writeError && !modal && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4" role="alert">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600">error</span>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900">
                    {writeError.isConflict ? 'Conflict — the device changed' : writeError.title}
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">{writeError.message}</p>
                  {writeError.correlationId && (
                    <p className="text-xs text-slate-400 mt-2">
                      Reference: <code>{writeError.correlationId}</code>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Register device modal */}
      {modal === 'register' && (
        <RegisterDeviceModal
          organizationId={organizationId}
          isSaving={isSaving}
          error={writeError}
          onClose={() => { setModal(null); setWriteError(null); }}
          onSubmit={(body, idempotencyKey) => runWrite(() => registerDevice(organizationId, body, idempotencyKey))}
        />
      )}

      {/* Assign device modal */}
      {modal === 'assign' && activeDevice && (
        <AssignDeviceModal
          organizationId={organizationId}
          device={activeDevice}
          isSaving={isSaving}
          error={writeError}
          onClose={() => { setModal(null); setActiveDevice(null); setWriteError(null); }}
          onSubmit={(patientProfileId) =>
            runWrite(() =>
              assignDevice(organizationId, activeDevice.id, {
                patient_profile_id: patientProfileId,
                expected_version: activeDevice.version,
              }),
            )
          }
        />
      )}

      {/* Release device modal */}
      {modal === 'release' && activeDevice && (
        <ReleaseDeviceModal
          device={activeDevice}
          isSaving={isSaving}
          error={writeError}
          onClose={() => { setModal(null); setActiveDevice(null); setWriteError(null); }}
          onSubmit={(reasonCode) =>
            runWrite(() =>
              releaseDevice(organizationId, activeDevice.id, {
                expected_version: activeDevice.version,
                reason_code: reasonCode,
              }),
            )
          }
        />
      )}

      {/* Submit readings modal (admin / simulator) */}
      {modal === 'submit-readings' && activeDevice && (
        <SubmitReadingsModal
          device={activeDevice}
          isSaving={isSaving}
          error={writeError}
          onClose={() => { setModal(null); setActiveDevice(null); setWriteError(null); }}
          onSubmit={(sample, idempotencyKey) =>
            runWrite(() =>
              submitDeviceVitalReadings(
                organizationId,
                activeDevice.id,
                { readings: [sample] },
                idempotencyKey,
              ),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
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
                {error.isConflict ? 'Conflict — the device changed' : error.title}
              </p>
              <p className="text-xs text-red-600 mt-1">{error.message}</p>
            </div>
          )}
          {footer}
        </div>
      </div>
    </div>
  );
}

interface RegisterDeviceModalProps {
  organizationId: string;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (body: RegisterDeviceRequest, idempotencyKey: string) => void;
}

function RegisterDeviceModal({ isSaving, error, onClose, onSubmit }: RegisterDeviceModalProps) {
  const [deviceType, setDeviceType] = useState<DeviceType>('vitals_monitor');
  const [serialNumber, setSerialNumber] = useState('');
  const [hardwareRevision, setHardwareRevision] = useState('');
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [credentialType, setCredentialType] = useState<DeviceCredentialType>('mqtt_password');
  const [provisioningSecret, setProvisioningSecret] = useState('');

  const canSubmit = serialNumber.trim() !== '' && provisioningSecret.trim() !== '' && !isSaving;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const body: RegisterDeviceRequest = {
      device_type: deviceType,
      serial_number: serialNumber.trim(),
      hardware_revision: hardwareRevision.trim() || undefined,
      firmware_version: firmwareVersion.trim() || undefined,
      credential_type: credentialType,
      provisioning_secret: provisioningSecret,
    };
    // A fresh key per submit so a replayed double-click cannot create a second device.
    onSubmit(body, crypto.randomUUID());
  };

  return (
    <ModalShell
      title="Register Device"
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            form="register-device-form"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#1a3694] disabled:opacity-50"
          >
            {isSaving ? 'Registering...' : 'Register'}
          </button>
        </div>
      }
    >
      <form id="register-device-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Device type</span>
          <select
            value={deviceType}
            onChange={(e) => setDeviceType(e.target.value as DeviceType)}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
          >
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>{humaniseCode(t)}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Serial number <span className="text-red-500">*</span></span>
          <input
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            placeholder="e.g. MAX30102-SN001"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            required
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-slate-700">Hardware revision</span>
            <input
              value={hardwareRevision}
              onChange={(e) => setHardwareRevision(e.target.value)}
              placeholder="Optional"
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-slate-700">Firmware version</span>
            <input
              value={firmwareVersion}
              onChange={(e) => setFirmwareVersion(e.target.value)}
              placeholder="Optional"
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Credential type</span>
          <select
            value={credentialType}
            onChange={(e) => setCredentialType(e.target.value as DeviceCredentialType)}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
          >
            {DEVICE_CREDENTIAL_TYPES.map((t) => (
              <option key={t} value={t}>{humaniseCode(t)}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Provisioning secret <span className="text-red-500">*</span></span>
          <input
            type="password"
            value={provisioningSecret}
            onChange={(e) => setProvisioningSecret(e.target.value)}
            placeholder="Secret shared with the device for first authentication"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            required
          />
          <span className="text-xs text-amber-600 inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">warning</span>
            Store this secret securely. It is shown once and cannot be retrieved later.
          </span>
        </label>
      </form>
    </ModalShell>
  );
}

interface AssignDeviceModalProps {
  organizationId: string;
  device: Device;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (patientProfileId: string) => void;
}

function AssignDeviceModal({ organizationId, device, isSaving, error, onClose, onSubmit }: AssignDeviceModalProps) {
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);

  const patientResource = useApiResource(
    (signal) =>
      listOrganizationPatients(organizationId, {
        search: submittedSearch || undefined,
        limit: 50,
        signal,
      }),
    [organizationId, submittedSearch],
  );

  const patients = useMemo(() => patientResource.data?.data ?? [], [patientResource.data]);

  return (
    <ModalShell
      title={`Assign ${device.serial_number}`}
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedPatient || isSaving}
            onClick={() => selectedPatient && onSubmit(selectedPatient)}
            className="px-4 py-2 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#1a3694] disabled:opacity-50"
          >
            {isSaving ? 'Assigning...' : 'Assign'}
          </button>
        </div>
      }
    >
      <p className="text-xs text-slate-500">
        Select a patient to assign this {humaniseCode(device.device_type)} device to.
        The device must be unassigned and in a provisioned or active state.
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
    </ModalShell>
  );
}

interface ReleaseDeviceModalProps {
  device: Device;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (reasonCode: DeviceReleaseReasonCode) => void;
}

function ReleaseDeviceModal({ device, isSaving, error, onClose, onSubmit }: ReleaseDeviceModalProps) {
  const [reasonCode, setReasonCode] = useState<DeviceReleaseReasonCode>('patient_discharged');
  const assignedPatient = device.active_assignment?.patient_profile_id ?? null;

  return (
    <ModalShell
      title={`Release ${device.serial_number}`}
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onSubmit(reasonCode)}
            className="px-4 py-2 rounded-lg bg-red-600 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isSaving ? 'Releasing...' : 'Release'}
          </button>
        </div>
      }
    >
      <p className="text-sm text-slate-600">
        This will release the device from patient{' '}
        <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">{shortId(assignedPatient)}</code>.
        Select a reason for the release.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-slate-700">Reason code</span>
        <select
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value as DeviceReleaseReasonCode)}
          className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
        >
          {DEVICE_RELEASE_REASONS.map((r) => (
            <option key={r} value={r}>{humaniseCode(r)}</option>
          ))}
        </select>
      </label>
    </ModalShell>
  );
}

interface SubmitReadingsModalProps {
  device: Device;
  isSaving: boolean;
  error: ApiError | null;
  onClose: () => void;
  onSubmit: (
    sample: {
      boot_id: number;
      sequence_number: number;
      metric: VitalMetric;
      value: number;
      unit: VitalUnit;
      recorded_at: string;
      quality: VitalReadingQuality;
    },
    idempotencyKey: string,
  ) => void;
}

function SubmitReadingsModal({ device, isSaving, error, onClose, onSubmit }: SubmitReadingsModalProps) {
  const [metric, setMetric] = useState<Known<VitalMetric>>(VITAL_METRICS[0]);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<VitalUnit>(VITAL_UNITS[0]);
  const [recordedAt, setRecordedAt] = useState('');
  const [quality, setQuality] = useState<Known<VitalReadingQuality>>(VITAL_QUALITIES[0]);
  const [bootId, setBootId] = useState('1');
  const [sequenceNumber, setSequenceNumber] = useState('1');

  const canSubmit =
    value.trim() !== '' &&
    !Number.isNaN(Number(value)) &&
    bootId.trim() !== '' &&
    !Number.isNaN(Number(bootId)) &&
    sequenceNumber.trim() !== '' &&
    !Number.isNaN(Number(sequenceNumber)) &&
    !isSaving;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    // Default recorded_at to now if the submitter left it blank, so a quick
    // simulator probe does not require typing a timestamp.
    const timestamp = recordedAt.trim() === '' ? new Date().toISOString() : recordedAt;
    onSubmit(
      {
        boot_id: Number(bootId),
        sequence_number: Number(sequenceNumber),
        metric,
        value: Number(value),
        unit,
        recorded_at: timestamp,
        quality,
      },
      crypto.randomUUID(),
    );
  };

  return (
    <ModalShell
      title={`Submit reading · ${device.serial_number}`}
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            form="submit-readings-form"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-teal-600 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {isSaving ? 'Submitting…' : 'Submit reading'}
          </button>
        </div>
      }
    >
      <p className="text-xs text-slate-500">
        Admin / simulator: submit one vital reading on behalf of this{' '}
        {humaniseCode(device.device_type)} device. A replayed submit is deduplicated on the
        idempotency key.
      </p>
      <form id="submit-readings-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Metric</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as Known<VitalMetric>)}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
          >
            {VITAL_METRICS.map((m) => (
              <option key={m} value={m}>{humaniseCode(m)}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-slate-700">Value <span className="text-red-500">*</span></span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 72"
              type="number"
              step="any"
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-slate-700">Unit</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as VitalUnit)}
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
            >
              {VITAL_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Quality</span>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as Known<VitalReadingQuality>)}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white"
          >
            {VITAL_QUALITIES.map((q) => (
              <option key={q} value={q}>{humaniseCode(q)}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-slate-700">Boot id</span>
            <input
              value={bootId}
              onChange={(e) => setBootId(e.target.value)}
              type="number"
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold text-slate-700">Sequence</span>
            <input
              value={sequenceNumber}
              onChange={(e) => setSequenceNumber(e.target.value)}
              type="number"
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-slate-700">Recorded at</span>
          <input
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            placeholder="ISO-8601, defaults to now"
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono"
          />
        </label>
      </form>
    </ModalShell>
  );
}
