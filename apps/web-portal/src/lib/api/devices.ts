/**
 * Admin device management surface: register, list, assign and release devices.
 *
 * SCOPE IS THE CALLER'S ACTIVE ORGANIZATION, taken from the caller's own
 * membership rather than chosen in the UI. A supplied id could only ever be
 * the one they already reach.
 *
 * The admin endpoints use the path prefix `/organizations/{org}/devices`, with
 * assignment sub-paths `/organizations/{org}/devices/{deviceId}/assignments`
 * and `/organizations/{org}/devices/{deviceId}/assignments/release`. These are
 * NOT the doctor-scoped `/doctor/devices` paths, which are handled separately
 * in `./doctor-devices.ts`.
 *
 * Register carries an idempotency key so a replayed submit does not create a
 * second device with the same serial number. Assign and release carry
 * `expected_version` in the body; a concurrent write is refused with
 * `409 DEVICE_VERSION_CONFLICT` and the caller must re-read.
 */

import type {
  AssignDeviceRequest,
  Device,
  DeviceCredentialType,
  DeviceListResponse,
  DeviceReleaseReasonCode,
  DeviceState,
  DeviceType,
  RegisterDeviceRequest,
  ReleaseDeviceRequest,
  UnknownEnumValue,
} from '@/types/contracts';
import { apiRequest } from './client';

/** The known members of an enum, excluding the forward-compatibility escape hatch. */
type Known<T> = Exclude<T, UnknownEnumValue>;

export function registerDevice(
  organizationId: string,
  body: RegisterDeviceRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Device> {
  return apiRequest<Device>({
    method: 'POST',
    path: `/organizations/${encodeURIComponent(organizationId)}/devices`,
    body,
    csrf: true,
    idempotencyKey,
    signal,
  });
}

export function listOrgDevices(
  organizationId: string,
  options: {
    state?: DeviceState;
    deviceType?: DeviceType;
    cursor?: string;
    pageSize?: number;
    signal?: AbortSignal;
  } = {},
): Promise<DeviceListResponse> {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.deviceType) params.set('device_type', options.deviceType);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const encoded = params.toString();
  return apiRequest<DeviceListResponse>({
    method: 'GET',
    path: `/organizations/${encodeURIComponent(organizationId)}/devices${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

export function assignDevice(
  organizationId: string,
  deviceId: string,
  body: AssignDeviceRequest,
): Promise<Device> {
  return apiRequest<Device>({
    method: 'POST',
    path: `/organizations/${encodeURIComponent(organizationId)}/devices/${encodeURIComponent(deviceId)}/assignments`,
    body,
    csrf: true,
  });
}

export function releaseDevice(
  organizationId: string,
  deviceId: string,
  body: ReleaseDeviceRequest,
): Promise<Device> {
  return apiRequest<Device>({
    method: 'POST',
    path: `/organizations/${encodeURIComponent(organizationId)}/devices/${encodeURIComponent(deviceId)}/assignments/release`,
    body,
    csrf: true,
  });
}

export function getDevice(
  organizationId: string,
  deviceId: string,
  signal?: AbortSignal,
): Promise<Device> {
  return apiRequest<Device>({
    method: 'GET',
    path: `/organizations/${encodeURIComponent(organizationId)}/devices/${encodeURIComponent(deviceId)}`,
    signal,
  });
}

/**
 * The device vocabularies, declared once as `as const` arrays so a dropdown or
 * exhaustive map cannot name a value the backend will never return. The generated
 * union includes the `UnknownEnumValue` forward-compatibility escape hatch, which
 * is excluded here because a UI picker must only offer the known values.
 */
export const DEVICE_TYPES: ReadonlyArray<Known<DeviceType>> = [
  'vitals_monitor',
  'ecg',
  'thermometer',
  'pulse_oximeter',
  'simulator',
];

export const DEVICE_CREDENTIAL_TYPES: ReadonlyArray<Known<DeviceCredentialType>> = [
  'mqtt_password',
  'client_certificate',
];

export const DEVICE_RELEASE_REASONS: ReadonlyArray<Known<DeviceReleaseReasonCode>> = [
  'administrative_request',
  'device_replaced',
  'device_fault',
  'patient_discharged',
  'assignment_correction',
  'security_incident',
  'offboarding',
];
