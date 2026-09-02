import { apiRequest } from './client';

export interface DoctorAssignedPatient {
  readonly profile_id: string;
  readonly display_name: string;
  readonly email: string;
  readonly phone_e164: string | null;
  readonly preferred_locale: string;
  readonly timezone: string;
  readonly status: string;
  readonly assigned_at: string;
}

export interface DoctorAssignedPatientPage {
  readonly data: ReadonlyArray<DoctorAssignedPatient>;
  readonly page: { readonly has_more: boolean; readonly next_cursor: string | null };
}

export function listDoctorPatients(options: { search?: string; cursor?: string; pageSize?: number; signal?: AbortSignal } = {}): Promise<DoctorAssignedPatientPage> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const query = params.toString();
  return apiRequest<DoctorAssignedPatientPage>({ method: 'GET', path: `/doctor/patients${query ? `?${query}` : ''}`, signal: options.signal });
}

export function getDoctorPatient(patientProfileId: string, signal?: AbortSignal): Promise<DoctorAssignedPatient> {
  return apiRequest<DoctorAssignedPatient>({ method: 'GET', path: `/doctor/patients/${encodeURIComponent(patientProfileId)}`, signal });
}
