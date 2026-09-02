/**
 * Doctor-scoped device assignment surface.
 *
 * SCOPE IS THE CALLER'S ACTIVE DOCTOR MEMBERSHIP, never a parameter. The backend
 * resolves the doctor from the session, so every function below is `/doctor/*`
 * and takes no organization or site id. A doctor may only assign available
 * devices to patients they are assigned to, and may only release devices that
 * are assigned to their own patients — the backend enforces both, so this
 * client does not repeat the check.
 *
 * `listAvailableDevices` returns devices with no active assignment that the
 * doctor's membership is entitled to assign. `listDoctorDevices` (in
 * `./doctor-api.ts`) returns devices already assigned to the doctor's patients;
 * this file adds the assign/release mutations the doctor IoT page needs.
 */

import type {
  AssignDeviceRequest,
  Device,
  DeviceListResponse,
  ReleaseDeviceRequest,
} from '@/types/contracts';
import { apiRequest } from './client';

/**
 * Devices with no active assignment that the doctor may assign to a patient.
 * GET /doctor/available-devices.
 */
export function listAvailableDevices(
  options: {
    cursor?: string;
    pageSize?: number;
    signal?: AbortSignal;
  } = {},
): Promise<DeviceListResponse> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const encoded = params.toString();
  return apiRequest<DeviceListResponse>({
    method: 'GET',
    path: `/doctor/available-devices${encoded === '' ? '' : `?${encoded}`}`,
    signal: options.signal,
  });
}

/**
 * Assign a device to one of the doctor's patients.
 * POST /doctor/devices/{deviceId}/assignments.
 */
export function assignDoctorDevice(deviceId: string, body: AssignDeviceRequest): Promise<Device> {
  return apiRequest<Device>({
    method: 'POST',
    path: `/doctor/devices/${encodeURIComponent(deviceId)}/assignments`,
    body,
    csrf: true,
  });
}

/**
 * Release a device from a patient the doctor is assigned to.
 * POST /doctor/devices/{deviceId}/assignments/release.
 */
export function releaseDoctorDevice(deviceId: string, body: ReleaseDeviceRequest): Promise<Device> {
  return apiRequest<Device>({
    method: 'POST',
    path: `/doctor/devices/${encodeURIComponent(deviceId)}/assignments/release`,
    body,
    csrf: true,
  });
}
