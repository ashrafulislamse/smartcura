import type {
  AvailabilityExceptionResponse,
  AvailabilityRuleSetResponse,
  AvailabilitySlotGenerationResponse,
  AvailabilitySlotListResponse,
  GenerateAvailabilitySlotsRequest,
  RecordAvailabilityExceptionRequest,
  ReplaceAvailabilityRulesRequest,
} from '@/types/contracts';
import { apiRequest } from './client';

export function getAvailabilityRules(membershipId: string, signal?: AbortSignal): Promise<AvailabilityRuleSetResponse> {
  return apiRequest<AvailabilityRuleSetResponse>({ method: 'GET', path: `/memberships/${encodeURIComponent(membershipId)}/availability-rules`, signal });
}

/**
 * Replaces the acting doctor's entire weekly availability rule set. Regenerates the slot
 * horizon. `expected_version` must match the version from the last read — a stale version
 * is refused with 409.
 */
export function replaceAvailabilityRules(
  membershipId: string,
  body: ReplaceAvailabilityRulesRequest,
): Promise<AvailabilityRuleSetResponse> {
  return apiRequest<AvailabilityRuleSetResponse>({
    method: 'PUT',
    path: `/memberships/${encodeURIComponent(membershipId)}/availability-rules`,
    body,
    csrf: true,
  });
}

/** Records a per-date availability exception (closes or regenerates slots for that date). */
export function recordAvailabilityException(
  membershipId: string,
  body: RecordAvailabilityExceptionRequest,
  idempotencyKey: string,
): Promise<AvailabilityExceptionResponse> {
  return apiRequest<AvailabilityExceptionResponse>({
    method: 'POST',
    path: `/memberships/${encodeURIComponent(membershipId)}/availability-exceptions`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Generates bookable slots over a date range from the current rule set. Idempotent. */
export function generateAvailabilitySlots(
  membershipId: string,
  body: GenerateAvailabilitySlotsRequest,
  idempotencyKey: string,
): Promise<AvailabilitySlotGenerationResponse> {
  return apiRequest<AvailabilitySlotGenerationResponse>({
    method: 'POST',
    path: `/memberships/${encodeURIComponent(membershipId)}/availability-slots`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Reads already-generated bookable slots for the acting doctor's own schedule. */
export function listAvailabilitySlots(
  membershipId: string,
  options: { cursor?: string; pageSize?: number; signal?: AbortSignal } = {},
): Promise<AvailabilitySlotListResponse> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  return apiRequest<AvailabilitySlotListResponse>({
    method: 'GET',
    path: `/memberships/${encodeURIComponent(membershipId)}/availability-slots${suffix}`,
    signal: options.signal,
  });
}
