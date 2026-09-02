/**
 * AI surface: the doctor's synchronous clinical decision-support assistant, the AI artifacts
 * for the doctor's assigned patients, and the patient-owned async symptom conversation.
 *
 * THE DOCTOR ASSISTANT IS SYNCHRONOUS. `POST /doctor/ai/assistant` blocks until the provider
 * returns and answers 200 with the response in the same request — unlike the symptom
 * conversation below, which is async and only acknowledges a queued generation. Idempotency-Key
 * is mandatory on the assistant call: a retry with the same key and body returns the stored
 * response verbatim, so a network retry never produces a second billable inference.
 *
 * 501 MEANS NOT CONFIGURED. If the deployment has no AI provider configured the service
 * answers 501 NOT_IMPLEMENTED rather than fabricating a response, and the page must show that
 * as a distinct state, not a generic error. 503 means the provider is configured but currently
 * unavailable.
 */

import type {
  AiArtifactList,
  DoctorAiAssistantRequest,
  DoctorAiAssistantResponse,
  AiConversation,
  AiGenerationAccepted,
  SubmitAiTurnRequest,
} from '@/types/contracts';
import { apiRequest } from './client';

export function startAiConversation(signal?: AbortSignal): Promise<AiConversation> {
  return apiRequest<AiConversation>({ method: 'POST', path: '/ai/conversations', csrf: true, signal });
}

export function submitAiTurn(conversationId: string, body: SubmitAiTurnRequest): Promise<AiGenerationAccepted> {
  return apiRequest<AiGenerationAccepted>({ method: 'POST', path: `/ai/conversations/${encodeURIComponent(conversationId)}/turns`, body, csrf: true });
}

/**
 * Synchronous clinical decision-support call for the active doctor. Returns the provider's
 * response in the same request. A 501 status (ApiError) means the AI assistant is not
 * configured for this deployment; the page must surface that distinctly.
 */
export function callDoctorAiAssistant(
  body: DoctorAiAssistantRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<DoctorAiAssistantResponse> {
  return apiRequest<DoctorAiAssistantResponse>({
    method: 'POST',
    path: '/doctor/ai/assistant',
    body,
    csrf: true,
    idempotencyKey,
    signal,
  });
}

/**
 * Lists AI artifacts for the doctor's actively-assigned patients. Optional `patientProfileId`
 * narrows to one patient; the backend refuses an id outside the doctor's assignment scope.
 */
export function listDoctorAiArtifacts(
  options: { patientProfileId?: string; cursor?: string; pageSize?: number; signal?: AbortSignal } = {},
): Promise<AiArtifactList> {
  const params = new URLSearchParams();
  if (options.patientProfileId) params.set('patient_profile_id', options.patientProfileId);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  return apiRequest<AiArtifactList>({
    method: 'GET',
    path: `/doctor/ai/artifacts${suffix}`,
    signal: options.signal,
  });
}
