import type {
  AiArtifactList,
  AiArtifact,
  ClinicalNote,
  ClinicalNoteList,
  Conversation,
  ConversationInboxList,
  CreateClinicalNoteRequest,
  CreateMessageRequest,
  CreatePrescriptionRequest,
  DoctorNoteList,
  MarkConversationReadRequest,
  MarkConversationReadResult,
  MessageList,
  Prescription,
  PrescriptionList,
  ReviewAiArtifactRequest,
  UpdateClinicalNoteRequest,
  UpdatePrescriptionRequest,
  TransitionClinicalNoteRequest,
  TransitionPrescriptionRequest,
  AmendClinicalNoteRequest,
  CancelPrescriptionRequest,
  SupersedePrescriptionRequest,
  UnknownEnumValue,
} from '@/types/contracts';
import { apiRequest } from './client';

/** Response shape for `GET /prescriptions/{id}/pdf` — a base64 data URI or null. */
export interface PrescriptionPdfResponse {
  readonly download_url: string;
  readonly expires_at: string | null;
}

/**
 * Builds a `?key=value` query string from defined options, used by the doctor collection
 * endpoints which share the same cursor + page_size shape.
 */
function collectionQuery(params: { cursor?: string; pageSize?: number }): string {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.pageSize !== undefined) search.set('page_size', String(params.pageSize));
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

/**
 * The signed-in doctor's own clinical notes across all their consultations.
 *
 * SCOPE IS DERIVED FROM THE CALLER'S MEMBERSHIP, not from a parameter — the repository
 * returns only the notes authored by or belonging to this doctor, so no `doctor_id` is
 * supplied or accepted. Use `listConsultationNotes` for the notes of one consultation.
 */
export function listDoctorNotes(
  options: { pageSize?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<DoctorNoteList> {
  return apiRequest<DoctorNoteList>({
    method: 'GET',
    path: `/doctor/notes${collectionQuery({ cursor: options.cursor, pageSize: options.pageSize })}`,
    signal: options.signal,
  });
}

/**
 * The signed-in doctor's own prescriptions across all their consultations.
 *
 * SCOPE IS DERIVED FROM THE CALLER'S MEMBERSHIP, as with notes. Use
 * `createConsultationPrescription` / `getPrescription` for a single record.
 */
export function listDoctorPrescriptions(
  options: { pageSize?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<PrescriptionList> {
  return apiRequest<PrescriptionList>({
    method: 'GET',
    path: `/doctor/prescriptions${collectionQuery({ cursor: options.cursor, pageSize: options.pageSize })}`,
    signal: options.signal,
  });
}

export function listConsultationNotes(consultationId: string, signal?: AbortSignal) {
  return apiRequest<ClinicalNoteList>({ method: 'GET', path: `/consultations/${encodeURIComponent(consultationId)}/notes`, signal });
}
export function createConsultationNote(consultationId: string, body: CreateClinicalNoteRequest, idempotencyKey: string, signal?: AbortSignal) {
  return apiRequest<ClinicalNote>({ method: 'POST', path: `/consultations/${encodeURIComponent(consultationId)}/notes`, body, csrf: true, idempotencyKey, signal });
}
export function updateClinicalNote(noteId: string, body: UpdateClinicalNoteRequest, idempotencyKey: string, signal?: AbortSignal) {
  return apiRequest<ClinicalNote>({ method: 'PUT', path: `/clinical-notes/${encodeURIComponent(noteId)}`, body, csrf: true, idempotencyKey, signal });
}
export function transitionClinicalNote(noteId: string, body: TransitionClinicalNoteRequest, idempotencyKey: string, signal?: AbortSignal) {
  return apiRequest<ClinicalNote>({ method: 'PUT', path: `/clinical-notes/${encodeURIComponent(noteId)}/status`, body, csrf: true, idempotencyKey, signal });
}
export function createConsultationPrescription(consultationId: string, body: CreatePrescriptionRequest, idempotencyKey: string, signal?: AbortSignal) {
  return apiRequest<Prescription>({ method: 'POST', path: `/consultations/${encodeURIComponent(consultationId)}/prescriptions`, body, csrf: true, idempotencyKey, signal });
}
export function getPrescription(prescriptionId: string, signal?: AbortSignal) {
  return apiRequest<Prescription>({ method: 'GET', path: `/prescriptions/${encodeURIComponent(prescriptionId)}`, signal });
}
export function getClinicalNote(noteId: string, signal?: AbortSignal) {
  return apiRequest<ClinicalNote>({ method: 'GET', path: `/clinical-notes/${encodeURIComponent(noteId)}`, signal });
}
export function updatePrescription(prescriptionId: string, body: UpdatePrescriptionRequest, idempotencyKey: string, signal?: AbortSignal) {
  return apiRequest<Prescription>({ method: 'PUT', path: `/prescriptions/${encodeURIComponent(prescriptionId)}`, body, csrf: true, idempotencyKey, signal });
}
export function transitionPrescription(prescriptionId: string, body: TransitionPrescriptionRequest, idempotencyKey: string, signal?: AbortSignal) {
  return apiRequest<Prescription>({ method: 'PUT', path: `/prescriptions/${encodeURIComponent(prescriptionId)}/status`, body, csrf: true, idempotencyKey, signal });
}

// -------------------------------------------------- prescription mutations

/** Step-up cancels a signed prescription with a structured reason code. */
export function cancelPrescription(
  prescriptionId: string,
  body: CancelPrescriptionRequest,
  idempotencyKey: string,
): Promise<Prescription> {
  return apiRequest<Prescription>({
    method: 'POST',
    path: `/prescriptions/${encodeURIComponent(prescriptionId)}/cancellation`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Atomically signs a correction and supersedes the immutable prior prescription. */
export function supersedePrescription(
  prescriptionId: string,
  body: SupersedePrescriptionRequest,
  idempotencyKey: string,
): Promise<Prescription> {
  return apiRequest<Prescription>({
    method: 'POST',
    path: `/prescriptions/${encodeURIComponent(prescriptionId)}/replacements`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Downloads a prescription PDF as a base64 data URI. Generated on first request and cached. */
export function downloadPrescriptionPdf(
  prescriptionId: string,
  signal?: AbortSignal,
): Promise<PrescriptionPdfResponse> {
  return apiRequest<PrescriptionPdfResponse>({
    method: 'GET',
    path: `/prescriptions/${encodeURIComponent(prescriptionId)}/pdf`,
    signal,
  });
}

// -------------------------------------------------- clinical note amendment

/** Creates a signed replacement and supersedes the prior signed note. */
export function amendClinicalNote(
  noteId: string,
  body: AmendClinicalNoteRequest,
  idempotencyKey: string,
): Promise<ClinicalNote> {
  return apiRequest<ClinicalNote>({
    method: 'POST',
    path: `/clinical-notes/${encodeURIComponent(noteId)}/amendments`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

// -------------------------------------------------- consultation conversation

/** Resolves the participant conversation for a consultation. */
export function readConsultationConversation(
  consultationId: string,
  signal?: AbortSignal,
): Promise<Conversation> {
  return apiRequest<Conversation>({
    method: 'GET',
    path: `/consultations/${encodeURIComponent(consultationId)}/conversation`,
    signal,
  });
}

/** Lists prescriptions created for a consultation. */
export function listConsultationPrescriptions(
  consultationId: string,
  signal?: AbortSignal,
): Promise<PrescriptionList> {
  return apiRequest<PrescriptionList>({
    method: 'GET',
    path: `/consultations/${encodeURIComponent(consultationId)}/prescriptions`,
    signal,
  });
}

// -------------------------------------------------- conversation messaging

/** Resumes the persistent server-sequenced message feed for a conversation. */
export function listConversationMessages(
  conversationId: string,
  options: { cursor?: string; pageSize?: number; signal?: AbortSignal } = {},
): Promise<MessageList> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  return apiRequest<MessageList>({
    method: 'GET',
    path: `/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
    signal: options.signal,
  });
}

/** Creates a correlation-deduplicated participant message. */
export function sendConversationMessage(
  conversationId: string,
  body: CreateMessageRequest,
  idempotencyKey: string,
): Promise<import('@/types/contracts').Message> {
  return apiRequest({
    method: 'POST',
    path: `/conversations/${encodeURIComponent(conversationId)}/messages`,
    body,
    csrf: true,
    idempotencyKey,
  });
}

/** Persists participant read receipts through a server sequence. */
export function markConversationRead(
  conversationId: string,
  body: MarkConversationReadRequest,
): Promise<MarkConversationReadResult> {
  return apiRequest<MarkConversationReadResult>({
    method: 'PUT',
    path: `/conversations/${encodeURIComponent(conversationId)}/read`,
    body,
    csrf: true,
  });
}

/** Lists conversations in the assigned doctor inbox. */
export function listDoctorInbox(
  options: { cursor?: string; pageSize?: number; signal?: AbortSignal } = {},
): Promise<ConversationInboxList> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.pageSize !== undefined) params.set('page_size', String(options.pageSize));
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  return apiRequest<ConversationInboxList>({
    method: 'GET',
    path: `/conversations${suffix}`,
    signal: options.signal,
  });
}

// -------------------------------------------------- AI artifact review

/** Reads a single AI artifact by id (own or assigned-patient). */
export function readAiArtifact(artifactId: string, signal?: AbortSignal): Promise<AiArtifact> {
  return apiRequest<AiArtifact>({
    method: 'GET',
    path: `/ai/artifacts/${encodeURIComponent(artifactId)}`,
    signal,
  });
}

/** Records an immutable doctor review decision on an AI artifact. */
export function reviewAiArtifact(
  artifactId: string,
  body: ReviewAiArtifactRequest,
): Promise<AiArtifact> {
  return apiRequest<AiArtifact>({
    method: 'PUT',
    path: `/ai/artifacts/${encodeURIComponent(artifactId)}/review`,
    body,
    csrf: true,
  });
}

type KnownClinicalNoteStatus = Exclude<ClinicalNote['status'], UnknownEnumValue>;
type KnownPrescriptionStatus = Exclude<Prescription['status'], UnknownEnumValue>;

/**
 * Style maps keyed EXHAUSTIVELY over the generated enums, never over a hand-typed string,
 * so an invented status cannot compile silently and a badge never renders a default style
 * forever while looking like a real one.
 */
export const CLINICAL_NOTE_STATUS_STYLE: Record<KnownClinicalNoteStatus, string> = {
  draft: 'bg-amber-50 text-amber-700 border-amber-100',
  signed: 'bg-green-50 text-green-700 border-green-100',
  superseded: 'bg-slate-100 text-slate-600 border-slate-200',
  discarded: 'bg-red-50 text-red-700 border-red-100',
};

export const PRESCRIPTION_STATUS_STYLE: Record<KnownPrescriptionStatus, string> = {
  draft: 'bg-amber-50 text-amber-700 border-amber-100',
  signed: 'bg-green-50 text-green-700 border-green-100',
  superseded: 'bg-slate-100 text-slate-600 border-slate-200',
  cancelled: 'bg-red-50 text-red-700 border-red-100',
  expired: 'bg-orange-50 text-orange-700 border-orange-100',
  discarded: 'bg-slate-100 text-slate-600 border-slate-200',
};
