import type {
  CareAssignment,
  CareAssignmentPage,
  CareAssignmentStatus,
  CreateCareAssignmentRequest,
  EndCareAssignmentRequest,
} from '@/types/contracts';
import { apiRequest } from './client';

export function listCareAssignments(options: { status?: CareAssignmentStatus; pageSize?: number; cursor?: string; signal?: AbortSignal } = {}): Promise<CareAssignmentPage> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.toString();
  return apiRequest<CareAssignmentPage>({ method: 'GET', path: `/care-assignments${query ? `?${query}` : ''}`, signal: options.signal });
}

/** Assigns an approved doctor to an active patient. Admin, step-up required. */
export function createCareAssignment(
  organizationId: string,
  body: CreateCareAssignmentRequest,
  idempotencyKey: string,
): Promise<CareAssignment> {
  return apiRequest<CareAssignment>({
    method: 'POST',
    path: `/organizations/${organizationId}/care-assignments`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Completes or revokes an active care assignment. Admin, step-up, optimistic concurrency. */
export function endCareAssignment(
  organizationId: string,
  assignmentId: string,
  body: EndCareAssignmentRequest,
): Promise<CareAssignment> {
  return apiRequest<CareAssignment>({
    method: 'POST',
    path: `/organizations/${organizationId}/care-assignments/${assignmentId}/end`,
    body,
    csrf: true,
  });
}

