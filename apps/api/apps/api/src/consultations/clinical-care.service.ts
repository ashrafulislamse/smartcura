import { createHash } from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import {
  ConsultationRepository,
  MessagingRepository,
  NotificationRepository,
  PrescriptionRepository,
  serializeClinicalNote,
  serializeConsultation,
  serializeMessage,
  serializeNotification,
  serializePrescription,
  type ClinicalActorContext,
  type PrescriptionCommandResult,
  type PrescriptionIdempotency,
  type PrescriptionItemInput,
  type PrescriptionPdfWork,
} from '@smartcura/database/consultations';
import type { ZodType } from 'zod';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  clinicalNoteAmendSchema,
  clinicalNoteCreateSchema,
  clinicalNoteTransitionSchema,
  clinicalNoteUpdateSchema,
  collectionListSchema,
  consultationTransitionSchema,
  messageCreateSchema,
  messageListSchema,
  messageReadSchema,
  notificationListSchema,
  notificationPreferenceSchema,
  prescriptionCancelSchema,
  prescriptionCreateSchema,
  prescriptionSignSchema,
  prescriptionSupersedeSchema,
  prescriptionUpdateSchema,
  registerPushDeviceSchema,
  type PrescriptionItemRequest,
} from './consultation-request.schemas.js';
import { LiveKitTokenService } from './livekit-token.service.js';
import { PushTokenCipher } from '@smartcura/database';
import { renderPrescriptionPdf as buildPrescriptionPdf } from './prescription-pdf.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ClinicalCareService {
  constructor(
    private readonly consultations: ConsultationRepository,
    private readonly messaging: MessagingRepository,
    private readonly prescriptions: PrescriptionRepository,
    private readonly notifications: NotificationRepository,
    private readonly roomTokens: LiveKitTokenService,
    private readonly pushTokens: PushTokenCipher,
  ) {}

  async createConsultation(current: AuthenticatedSession, appointmentIdValue: string) {
    const appointmentId = id(appointmentIdValue);
    const actor = this.actor(current, 'doctor', 'consultation:manage:assigned');
    const result = await this.consultations.createForAppointment({
      appointmentId, actor, now: new Date(), correlationId: correlationId(),
    });
    return typeof result === 'string' ? this.failure(result) : serializeConsultation(result);
  }

  async getConsultation(current: AuthenticatedSession, consultationIdValue: string) {
    const consultationId = id(consultationIdValue);
    const active = this.active(current);
    this.requirePermission(active.permissions,
      active.roleId === 'patient' ? 'consultation:read:own' : 'consultation:manage:assigned');
    const record = await this.consultations.findAuthorized(
      consultationId, current.aggregate.profile.profileId, active.membershipId,
    );
    if (record === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Consultation was not found');
    return serializeConsultation(record);
  }

  async transitionConsultation(current: AuthenticatedSession, consultationIdValue: string, value: unknown) {
    const consultationId = id(consultationIdValue);
    const request = parse(consultationTransitionSchema, value);
    const active = this.active(current);
    const role = request.status === 'ready' && active.roleId === 'patient' ? 'patient' : 'doctor';
    const permission = role === 'patient' ? 'consultation:join:own' : 'consultation:manage:assigned';
    const actor = this.actor(current, role, permission);
    const result = await this.consultations.transition({
      consultationId, nextStatus: request.status, outcomeCode: request.outcome_code,
      expectedVersion: request.expected_version, actor, now: new Date(), correlationId: correlationId(),
    });
    return typeof result === 'string' ? this.failure(result) : serializeConsultation(result);
  }

  async roomToken(current: AuthenticatedSession, consultationIdValue: string) {
    const consultationId = id(consultationIdValue);
    const active = this.active(current);
    this.requirePermission(active.permissions,
      active.roleId === 'patient' ? 'consultation:join:own' : 'consultation:manage:assigned');
    if (active.roleId !== 'patient' && active.roleId !== 'doctor') {
      throw problem(403, 'PERMISSION_DENIED', 'Consultation access is not permitted');
    }
    const grant = await this.consultations.roomAccess(
      consultationId, current.aggregate.profile.profileId,
    );
    if (grant === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Consultation was not found');
    return this.roomTokens.mint(grant);
  }

  async listDoctorNotes(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(collectionListSchema, queryValue);
    const active = this.actor(current, 'doctor', 'clinical_note:read:assigned');
    const cursor = query.cursor === undefined ? undefined : decodeCollectionCursor(query.cursor);
    const records = await this.consultations.listDoctorNotes({
      membershipId: active.membershipId,
      ...(cursor === undefined ? {} : { afterCreatedAt: cursor.createdAt, afterId: cursor.id }),
      limit: query.page_size + 1,
    });
    const more = records.length > query.page_size;
    const page = more ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return { data: page.map(serializeClinicalNote), page: { has_more: more,
      next_cursor: more && last ? encode({ createdAt: last.createdAt.toISOString(), id: last.noteId }) : null } };
  }

  async listNotes(current: AuthenticatedSession, consultationIdValue: string) {
    const consultationId = id(consultationIdValue);
    const active = this.active(current);
    this.requirePermission(active.permissions,
      active.roleId === 'patient' ? 'consultation:read:own' : 'clinical_note:read:assigned');
    return { data: (await this.consultations.listNotes(
      consultationId, current.aggregate.profile.profileId, active.membershipId,
    )).map(serializeClinicalNote) };
  }

  async createNote(current: AuthenticatedSession, consultationIdValue: string, value: unknown) {
    const consultationId = id(consultationIdValue);
    const request = parse(clinicalNoteCreateSchema, value);
    const actor = this.actor(current, 'doctor', 'clinical_note:manage:assigned');
    const result = await this.consultations.createNote({
      consultationId, content: request.content, actor,
      now: new Date(), correlationId: correlationId(),
    });
    return typeof result === 'string' ? this.failure(result) : serializeClinicalNote(result);
  }

  async updateNote(current: AuthenticatedSession, noteIdValue: string, value: unknown) {
    const request = parse(clinicalNoteUpdateSchema, value);
    const result = await this.consultations.updateNote({
      noteId: id(noteIdValue), content: request.content, expectedVersion: request.expected_version,
      actor: this.actor(current, 'doctor', 'clinical_note:manage:assigned'),
      now: new Date(), correlationId: correlationId(),
    });
    return typeof result === 'string' ? this.failure(result) : serializeClinicalNote(result);
  }

  async transitionNote(current: AuthenticatedSession, noteIdValue: string, value: unknown) {
    const request = parse(clinicalNoteTransitionSchema, value);
    const result = await this.consultations.transitionNote({
      noteId: id(noteIdValue), nextStatus: request.status,
      expectedVersion: request.expected_version,
      actor: this.actor(current, 'doctor', 'clinical_note:manage:assigned'),
      now: new Date(), correlationId: correlationId(),
    });
    return typeof result === 'string' ? this.failure(result) : serializeClinicalNote(result);
  }

  async amendNote(current: AuthenticatedSession, noteIdValue: string, value: unknown) {
    const request = parse(clinicalNoteAmendSchema, value);
    const result = await this.consultations.amendSignedNote({
      noteId: id(noteIdValue), content: request.content, expectedVersion: request.expected_version,
      actor: this.actor(current, 'doctor', 'clinical_note:manage:assigned'),
      now: new Date(), correlationId: correlationId(),
    });
    return typeof result === 'string' ? this.failure(result) : serializeClinicalNote(result);
  }

  async conversation(current: AuthenticatedSession, consultationIdValue: string) {
    const consultationId = id(consultationIdValue);
    const active = this.active(current);
    this.requirePermission(active.permissions,
      active.roleId === 'patient' ? 'conversation:read:own' : 'conversation:read:assigned');
    const result = await this.messaging.conversationForConsultation(
      consultationId, current.aggregate.profile.profileId,
    );
    if (result === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Conversation was not found');
    return { conversation_id: result.conversationId, consultation_id: consultationId, status: result.status };
  }

  async listInbox(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(collectionListSchema, queryValue);
    const active = this.actor(current, 'doctor', 'conversation:read:assigned');
    const cursor = query.cursor === undefined ? undefined : decodeCollectionCursor(query.cursor);
    const records = await this.messaging.listDoctorInbox({
      profileId: current.aggregate.profile.profileId, membershipId: active.membershipId,
      ...(cursor === undefined ? {} : { afterUpdatedAt: cursor.createdAt, afterId: cursor.id }),
      limit: query.page_size + 1,
    });
    const more = records.length > query.page_size;
    const page = more ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return { data: page, page: { has_more: more,
      next_cursor: more && last ? encode({ createdAt: last.updatedAt.toISOString(), id: last.conversationId }) : null } };
  }

  async listMessages(current: AuthenticatedSession, conversationIdValue: string, queryValue: unknown) {
    const conversationId = id(conversationIdValue);
    const query = parse(messageListSchema, queryValue);
    const active = this.active(current);
    this.requirePermission(active.permissions,
      active.roleId === 'patient' ? 'conversation:read:own' : 'conversation:read:assigned');
    const cursor = query.cursor === undefined ? undefined : decodeMessageCursor(query.cursor);
    const records = await this.messaging.list({
      conversationId, profileId: current.aggregate.profile.profileId,
      ...(cursor === undefined ? {} : { afterSequenceNo: cursor.sequenceNo, afterId: cursor.id }),
      limit: query.page_size + 1,
    });
    if (records === 'not_participant') throw problem(404, 'RESOURCE_NOT_FOUND', 'Conversation was not found');
    const more = records.length > query.page_size;
    const page = more ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map((record) => serializeMessage(record, current.aggregate.profile.profileId)),
      page: { has_more: more, next_cursor: more && last !== undefined
        ? encode({ sequenceNo: last.sequenceNo, id: last.messageId }) : null },
    };
  }

  async sendMessage(current: AuthenticatedSession, conversationIdValue: string, key: string, value: unknown) {
    const conversationId = id(conversationIdValue);
    const request = parse(messageCreateSchema, value);
    if (key !== request.client_correlation_id) throw validationFailed();
    const active = this.active(current);
    const permission = active.roleId === 'patient'
      ? 'conversation.message:create:own' : 'conversation.message:create:assigned';
    const actor = this.actor(current, active.roleId === 'patient' ? 'patient' : 'doctor', permission);
    const result = await this.messaging.send({
      conversationId, messageType: request.message_type,
      textContent: request.message_type === 'text' ? request.text_content : null,
      fileObjectId: request.message_type === 'file' ? request.file_object_id : null,
      clientCorrelationId: request.client_correlation_id, actor,
      now: new Date(), correlationId: correlationId(),
    });
    return typeof result === 'string'
      ? this.failure(result)
      : serializeMessage(result, current.aggregate.profile.profileId);
  }

  async markMessagesRead(current: AuthenticatedSession, conversationIdValue: string, value: unknown) {
    const request = parse(messageReadSchema, value);
    const active = this.active(current);
    const permission = active.roleId === 'patient' ? 'conversation:read:own' : 'conversation:read:assigned';
    this.requirePermission(active.permissions, permission);
    const result = await this.messaging.markRead({
      conversationId: id(conversationIdValue), throughSequenceNo: request.through_sequence_no,
      actor: this.actor(current, active.roleId === 'patient' ? 'patient' : 'doctor', permission),
      now: new Date(), correlationId: correlationId(),
    });
    if (typeof result === 'string') return this.failure(result);
    return { updated_receipts: result, through_sequence_no: request.through_sequence_no };
  }

  async listPrescriptions(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(collectionListSchema, queryValue);
    const active = this.active(current);
    const isPatient = active.roleId === 'patient';
    this.requirePermission(active.permissions,
      isPatient ? 'prescription:read:own' : 'prescription:read:assigned');
    const cursor = query.cursor === undefined ? undefined : decodeCollectionCursor(query.cursor);
    const records = isPatient
      ? await this.prescriptions.listOwn({
          patientProfileId: current.aggregate.profile.profileId,
          ...(cursor === undefined ? {} : { afterCreatedAt: cursor.createdAt, afterId: cursor.id }),
          limit: query.page_size + 1,
        })
      : await this.prescriptions.listIssued({
          membershipId: active.membershipId,
          ...(cursor === undefined ? {} : { afterCreatedAt: cursor.createdAt, afterId: cursor.id }),
          limit: query.page_size + 1,
        });
    const more = records.length > query.page_size;
    const page = more ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return { data: page.map(serializePrescription), page: { has_more: more,
      next_cursor: more && last ? encode({ createdAt: last.createdAt.toISOString(), id: last.prescriptionId }) : null } };
  }

  async getPrescription(current: AuthenticatedSession, prescriptionIdValue: string) {
    const prescriptionId = id(prescriptionIdValue);
    const active = this.active(current);
    this.requirePermission(active.permissions,
      active.roleId === 'patient' ? 'prescription:read:own' : 'prescription:read:assigned');
    const record = await this.prescriptions.findAuthorized(
      prescriptionId, current.aggregate.profile.profileId, active.membershipId,
    );
    if (record === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Prescription was not found');
    return serializePrescription(record);
  }

  async getPrescriptionPdf(current: AuthenticatedSession, prescriptionIdValue: string) {
    const prescriptionId = id(prescriptionIdValue);
    const active = this.active(current);
    const record = await this.prescriptions.findById(prescriptionId);
    if (record === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Prescription was not found');

    const isAdmin = active.roleId === 'admin' || active.roleId === 'super_admin';
    const allowed = isAdmin
      ? active.organizationId === record.organizationId
      : active.roleId === 'patient'
        ? active.permissions.includes('prescription:read:own') &&
          current.aggregate.profile.profileId === record.patientProfileId
        : active.roleId === 'doctor' &&
          active.permissions.includes('prescription:read:assigned') &&
          active.membershipId === record.doctorMembershipId;
    if (!allowed) throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    if (record.status === 'draft' || record.status === 'discarded') {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Prescription is not available for download');
    }
    if (record.signedAt === null) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Prescription is not available for download');
    }

    let bytes: Uint8Array;
    let mediaType: string;
    if (record.documentBytes === null || record.documentMediaType === null) {
      const pdf = buildPrescriptionPdf({
        prescriptionId: record.prescriptionId,
        status: record.status,
        patientProfileId: record.patientProfileId,
        doctorMembershipId: record.doctorMembershipId,
        signedAt: record.signedAt,
        expiresAt: record.expiresAt,
        diagnosis: record.diagnosis,
        items: record.items,
      });
      const now = new Date();
      await this.prescriptions.attachDocumentBytes({
        prescriptionId,
        bytes: pdf,
        mediaType: 'application/pdf',
        now,
      });
      bytes = pdf;
      mediaType = 'application/pdf';
    } else {
      bytes = record.documentBytes;
      mediaType = record.documentMediaType;
    }
    const dataUri = `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
    return { download_url: dataUri, expires_at: null };
  }

  async listPrescriptionsForConsultation(current: AuthenticatedSession, consultationIdValue: string) {
    const consultationId = id(consultationIdValue);
    const active = this.active(current);
    this.requirePermission(active.permissions,
      active.roleId === 'patient' ? 'consultation:read:own' : 'consultation:manage:assigned');
    const consultation = await this.consultations.findAuthorized(
      consultationId, current.aggregate.profile.profileId, active.membershipId,
    );
    if (consultation === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Consultation was not found');
    const records = await this.prescriptions.listForConsultation({
      consultationId,
      profileId: current.aggregate.profile.profileId,
      membershipId: active.membershipId,
      excludeDrafts: active.roleId === 'patient',
    });
    return { data: records.map(serializePrescription), page: { has_more: false, next_cursor: null } };
  }

  /**
   * Reads one clinical note by id. A patient reads through `consultation:read:own`
   * (the note is reached through its consultation, and that is the permission
   * `listNotes` already requires of a patient — there is no `clinical_note:read:own`
   * in the seeded vocabulary), while a doctor reads through
   * `clinical_note:read:assigned`. Out-of-scope or absent is 404, never 403.
   */
  async getNote(current: AuthenticatedSession, noteIdValue: string) {
    const noteId = id(noteIdValue);
    const active = this.active(current);
    this.requirePermission(active.permissions,
      active.roleId === 'patient' ? 'consultation:read:own' : 'clinical_note:read:assigned');
    const record = await this.consultations.findAuthorizedNote(
      noteId, current.aggregate.profile.profileId, active.membershipId,
    );
    if (record === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Clinical note was not found');
    return serializeClinicalNote(record);
  }

  async createPrescription(current: AuthenticatedSession, consultationIdValue: string, key: string, value: unknown) {
    const request = parse(prescriptionCreateSchema, value);
    const consultationId = id(consultationIdValue);
    const result = await this.prescriptions.createDraft({
      consultationId, items: items(request.items), diagnosis: request.diagnosis,
      actor: this.actor(current, 'doctor', 'prescription:create:assigned'),
      now: new Date(), correlationId: correlationId(),
      idempotency: commandIdempotency(key, 'prescription.create', { consultationId, request }),
    });
    return this.prescriptionResult(result);
  }

  async updatePrescription(current: AuthenticatedSession, prescriptionIdValue: string, value: unknown) {
    const request = parse(prescriptionUpdateSchema, value);
    const result = await this.prescriptions.updateDraft({
      prescriptionId: id(prescriptionIdValue), items: items(request.items),
      expectedVersion: request.expected_version, diagnosis: request.diagnosis,
      actor: this.actor(current, 'doctor', 'prescription:create:assigned'),
      now: new Date(), correlationId: correlationId(),
    });
    return typeof result === 'string' ? this.failure(result) : serializePrescription(result);
  }

  async signPrescription(current: AuthenticatedSession, prescriptionIdValue: string, key: string, value: unknown) {
    const request = parse(prescriptionSignSchema, value);
    const prescriptionId = id(prescriptionIdValue);
    const result = await this.prescriptions.transitionDraft({
      prescriptionId, nextStatus: request.status,
      expectedVersion: request.expected_version,
      expiresAt: request.expires_at === null ? null : new Date(request.expires_at),
      actor: this.actor(current, 'doctor',
        request.status === 'signed' ? 'prescription.sign:assigned' : 'prescription:create:assigned',
        request.status === 'signed'),
      now: new Date(), correlationId: correlationId(),
      idempotency: commandIdempotency(key, 'prescription.transition', { prescriptionId, request }),
    });
    return this.prescriptionResult(result);
  }

  async supersedePrescription(current: AuthenticatedSession, prescriptionIdValue: string, key: string, value: unknown) {
    const request = parse(prescriptionSupersedeSchema, value);
    const prescriptionId = id(prescriptionIdValue);
    const result = await this.prescriptions.supersede({
      prescriptionId, items: items(request.items), diagnosis: request.diagnosis,
      expectedVersion: request.expected_version,
      expiresAt: request.expires_at === null ? null : new Date(request.expires_at),
      actor: this.actor(current, 'doctor', 'prescription.sign:assigned', true),
      now: new Date(), correlationId: correlationId(),
      idempotency: commandIdempotency(key, 'prescription.supersede', { prescriptionId, request }),
    });
    return this.prescriptionResult(result);
  }

  async cancelPrescription(current: AuthenticatedSession, prescriptionIdValue: string, key: string, value: unknown) {
    const request = parse(prescriptionCancelSchema, value);
    const prescriptionId = id(prescriptionIdValue);
    const result = await this.prescriptions.cancel({
      prescriptionId, reasonCode: request.reason_code,
      expectedVersion: request.expected_version,
      actor: this.actor(current, 'doctor', 'prescription.sign:assigned', true),
      now: new Date(), correlationId: correlationId(),
      idempotency: commandIdempotency(key, 'prescription.cancel', { prescriptionId, request }),
    });
    return this.prescriptionResult(result);
  }

  async listNotifications(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(notificationListSchema, queryValue);
    const active = this.active(current);
    this.requirePermission(active.permissions, 'notification:read:own');
    const cursor = query.cursor === undefined ? undefined : decodeNotificationCursor(query.cursor);
    const records = await this.notifications.list({
      profileId: current.aggregate.profile.profileId,
      ...(cursor === undefined ? {} : { beforeCreatedAt: cursor.createdAt, beforeId: cursor.id }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.unread === undefined ? {} : { unread: query.unread === 'true' }),
      limit: query.page_size + 1,
    });
    const more = records.length > query.page_size;
    const page = more ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(serializeNotification),
      page: { has_more: more, next_cursor: more && last !== undefined
        ? encode({ createdAt: last.createdAt.toISOString(), id: last.notificationId }) : null },
    };
  }

  async markNotificationRead(current: AuthenticatedSession, notificationIdValue: string) {
    const active = this.active(current);
    this.requirePermission(active.permissions, 'notification:read:own');
    const record = await this.notifications.markRead(
      id(notificationIdValue), current.aggregate.profile.profileId, new Date(),
    );
    if (record === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Notification was not found');
    return serializeNotification(record);
  }

  /**
   * Marks every unread notification of the calling profile as read. The update is
   * scoped by profile_id inside the repository, so one account can never clear
   * another's badge, exactly as the single-notification read cannot.
   */
  async markAllNotificationsRead(current: AuthenticatedSession) {
    const active = this.active(current);
    this.requirePermission(active.permissions, 'notification:read:own');
    const updated = await this.notifications.markAllRead(
      current.aggregate.profile.profileId, new Date(),
    );
    return { updated };
  }

  async listPreferences(current: AuthenticatedSession) {
    const active = this.active(current);
    this.requirePermission(active.permissions, 'notification.preference:manage:own');
    return { data: await this.notifications.listPreferences(current.aggregate.profile.profileId) };
  }

  async savePreference(current: AuthenticatedSession, value: unknown) {
    const request = parse(notificationPreferenceSchema, value);
    const active = this.active(current);
    this.requirePermission(active.permissions, 'notification.preference:manage:own');
    const result = await this.notifications.savePreference({
      profileId: current.aggregate.profile.profileId, category: request.category,
      channel: request.channel, enabled: request.enabled,
      quietHoursStart: request.quiet_hours_start, quietHoursEnd: request.quiet_hours_end,
      timezone: request.timezone, now: new Date(),
    });
    if (result === 'in_app_required') throw problem(409, 'NOTIFICATION_IN_APP_REQUIRED', 'In-app notifications cannot be disabled');
    return {
      category: result.category, channel: result.channel, enabled: result.enabled,
      quiet_hours_start: result.quietHoursStart, quiet_hours_end: result.quietHoursEnd,
      timezone: result.timezone,
    };
  }

  async registerPushDevice(current: AuthenticatedSession, value: unknown) {
    const request = parse(registerPushDeviceSchema, value);
    const active = this.active(current);
    this.requirePermission(active.permissions, 'notification.preference:manage:own');
    // The registration token is a provider credential, never a business record: it is
    // stored encrypted, indexed only by hash, and never returned or published.
    const result = await this.notifications.registerPushDevice({
      profileId: current.aggregate.profile.profileId,
      platform: request.platform,
      tokenCiphertext: this.pushTokens.seal(request.token),
      tokenHash: createHash('sha256').update(request.token).digest('hex'),
      now: new Date(),
    });
    return {
      push_device_id: result.pushDeviceId, platform: result.platform, enabled: result.enabled,
    };
  }

  async revokePushDevice(current: AuthenticatedSession, pushDeviceIdValue: string) {
    const active = this.active(current);
    this.requirePermission(active.permissions, 'notification.preference:manage:own');
    const result = await this.notifications.disablePushDevice(
      id(pushDeviceIdValue), current.aggregate.profile.profileId, new Date(),
    );
    if (result === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Push device was not found');
    return {
      push_device_id: result.pushDeviceId, platform: result.platform, enabled: result.enabled,
    };
  }

  private active(current: AuthenticatedSession) {
    const active = current.aggregate.memberships.find(
      (entry) => entry.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    if (current.aggregate.profile.status !== 'active' || current.aggregate.profile.onboardingCompletedAt === null) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    return active;
  }

  private requirePermission(permissions: readonly string[], permission: string) {
    if (!permissions.includes(permission)) throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
  }

  private actor(
    current: AuthenticatedSession, roleId: 'patient' | 'doctor',
    permission: string, requireStepUp = false,
  ): ClinicalActorContext {
    const active = this.active(current);
    if (active.roleId !== roleId) throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    this.requirePermission(active.permissions, permission);
    if (requireStepUp &&
      (current.aggregate.session.stepUpValidUntil === null || current.aggregate.session.stepUpValidUntil <= new Date())) {
      throw problem(403, 'STEP_UP_REQUIRED', 'Fresh authentication is required');
    }
    return {
      sessionId: current.aggregate.session.sessionId,
      tokenHash: current.tokenHash,
      profileId: current.aggregate.profile.profileId,
      membershipId: active.membershipId,
      roleId,
      requiredPermission: permission,
      ...(requireStepUp ? { requireStepUp: true } : {}),
    };
  }

  private prescriptionResult(result: PrescriptionCommandResult): Record<string, unknown> {
    if (typeof result === 'string') return this.failure(result);
    if ('replayed' in result) return result.body;
    return serializePrescription(result);
  }

  private failure(value: string): never {
    if (value === 'not_found' || value === 'not_participant' || value === 'not_issuer') {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Clinical resource was not found');
    }
    if (value === 'actor_session_invalid') throw problem(401, 'APP_SESSION_INVALID', 'Application session is invalid');
    if (value === 'actor_permission_denied') throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    if (value === 'actor_step_up_required') throw problem(403, 'STEP_UP_REQUIRED', 'Fresh authentication is required');
    if (value === 'idempotency_reused') throw problem(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused');
    if (value === 'idempotency_in_progress') throw problem(409, 'IDEMPOTENCY_IN_PROGRESS', 'Idempotent command is still processing');
    if (value === 'version_conflict') throw problem(409, 'CLINICAL_VERSION_CONFLICT', 'The clinical record changed');
    if (value === 'correlation_reused') throw problem(409, 'MESSAGE_CORRELATION_REUSED', 'Client correlation ID was reused');
    if (value === 'file_not_clean') throw problem(409, 'FILE_NOT_DOWNLOADABLE', 'File is not clean and finalized');
    if (value === 'not_mutable' || value === 'note_not_mutable') throw problem(409, 'SIGNED_RECORD_IMMUTABLE', 'Signed clinical content is immutable');
    throw problem(409, 'CLINICAL_TRANSITION_INVALID', 'Clinical transition is not allowed');
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}
function id(value: string): string {
  if (!UUID_V7.test(value)) throw validationFailed();
  return value;
}
function items(values: readonly PrescriptionItemRequest[]): PrescriptionItemInput[] {
  return values.map((value) => ({
    medicationReference: value.medication_reference,
    medicationText: value.medication_text,
    doseValue: value.dose_value,
    doseUnit: value.dose_unit,
    routeCode: value.route_code,
    frequencyCode: value.frequency_code,
    frequencyText: value.frequency_text,
    durationDays: value.duration_days,
    patientInstructions: value.patient_instructions,
  }));
}
function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function decodeCollectionCursor(value: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || !UUID_V7.test(parsed.id)) throw new Error();
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error();
    return { createdAt, id: parsed.id };
  } catch { throw validationFailed(); }
}
function decodeMessageCursor(value: string): { sequenceNo: number; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (!Number.isInteger(parsed.sequenceNo) || Number(parsed.sequenceNo) < 1 || typeof parsed.id !== 'string' || !UUID_V7.test(parsed.id)) throw new Error();
    return { sequenceNo: Number(parsed.sequenceNo), id: parsed.id };
  } catch { throw validationFailed(); }
}
function decodeNotificationCursor(value: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || !UUID_V7.test(parsed.id)) throw new Error();
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error();
    return { createdAt, id: parsed.id };
  } catch { throw validationFailed(); }
}


function commandIdempotency(
  key: string,
  operationId: string,
  value: Record<string, unknown>,
): PrescriptionIdempotency {
  return {
    key,
    operationId,
    requestHash: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    ttlMs: 86_400_000,
  };
}

function renderPrescriptionPdf(work: PrescriptionPdfWork): Uint8Array {
  const lines = [
    'SmartCura Signed Prescription',
    `Prescription: ${work.prescriptionId}`,
    `Signed: ${work.signedAt.toISOString()}`,
    ...(work.expiresAt === null ? [] : [`Expires: ${work.expiresAt.toISOString()}`]),
    ...work.items.map((item) =>
      `${item.position}. ${item.medicationReference ?? item.medicationText ?? 'Medication'} ` +
      `${item.doseValue} ${item.doseUnit}; ${item.routeCode}; ` +
      `${item.frequencyCode ?? item.frequencyText}; ${item.durationDays} days`,
    ),
  ];
  const stream = lines.map((line, index) =>
    `BT /F1 10 Tf 50 ${780 - index * 16} Td (${escapePdf(line)}) Tj ET`,
  ).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(pdf, 'utf8'));
}

function escapePdf(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}
