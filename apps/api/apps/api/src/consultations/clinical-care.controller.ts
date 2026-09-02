import {
  Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Put, Query,
} from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession, RequireCsrf, RequirePermission, type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { problem, validationFailed } from '../platform/problems.js';
import { ClinicalCareService } from './clinical-care.service.js';

@AuthenticatedOnly()
@Controller('appointments/:appointmentId/consultation')
export class AppointmentConsultationController {
  constructor(private readonly care: ClinicalCareService) {}
  @Post()
  @RequireCsrf('consultation.create')
  create(@CurrentSession() current: AuthenticatedSession, @Param('appointmentId') appointmentId: string) {
    return this.care.createConsultation(current, appointmentId);
  }
}

@AuthenticatedOnly()
@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly care: ClinicalCareService) {}
  @Get(':consultationId')
  get(@CurrentSession() current: AuthenticatedSession, @Param('consultationId') id: string) {
    return this.care.getConsultation(current, id);
  }
  @Put(':consultationId/status')
  @RequireCsrf('consultation.transition')
  transition(@CurrentSession() current: AuthenticatedSession, @Param('consultationId') id: string,
    @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    requireJson(contentType); return this.care.transitionConsultation(current, id, body);
  }
  @Post(':consultationId/room-token')
  @HttpCode(200)
  @RequireCsrf('consultation.room_token')
  roomToken(@CurrentSession() current: AuthenticatedSession, @Param('consultationId') id: string) {
    return this.care.roomToken(current, id);
  }
  @Get(':consultationId/notes')
  notes(@CurrentSession() current: AuthenticatedSession, @Param('consultationId') id: string) {
    return this.care.listNotes(current, id);
  }
  @Post(':consultationId/notes')
  @RequireCsrf('clinical_note.create')
  createNote(@CurrentSession() current: AuthenticatedSession, @Param('consultationId') id: string,
    @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    requireJson(contentType); return this.care.createNote(current, id, body);
  }
  @Get(':consultationId/conversation')
  conversation(@CurrentSession() current: AuthenticatedSession, @Param('consultationId') id: string) {
    return this.care.conversation(current, id);
  }
  @Get(':consultationId/prescriptions')
  listPrescriptions(@CurrentSession() current: AuthenticatedSession, @Param('consultationId') id: string) {
    return this.care.listPrescriptionsForConsultation(current, id);
  }

  @Post(':consultationId/prescriptions')
  @RequireCsrf('prescription.create')
  createPrescription(@CurrentSession() current: AuthenticatedSession,
    @Param('consultationId') id: string, @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    requireJson(contentType);
    return this.care.createPrescription(current, id, requireIdempotencyKey(key), body);
  }
}

@AuthenticatedOnly()
@Controller('clinical-notes')
export class ClinicalNotesController {
  constructor(private readonly care: ClinicalCareService) {}
  @Get()
  list(@CurrentSession() current: AuthenticatedSession, @Query() query: unknown) {
    return this.care.listDoctorNotes(current, query);
  }
  @Get(':noteId')
  get(@CurrentSession() current: AuthenticatedSession, @Param('noteId') id: string) {
    return this.care.getNote(current, id);
  }
  @Put(':noteId')
  @RequireCsrf('clinical_note.update')
  update(@CurrentSession() current: AuthenticatedSession, @Param('noteId') id: string,
    @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    requireJson(contentType); return this.care.updateNote(current, id, body);
  }
  @Put(':noteId/status')
  @RequireCsrf('clinical_note.transition')
  transition(@CurrentSession() current: AuthenticatedSession, @Param('noteId') id: string,
    @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    requireJson(contentType); return this.care.transitionNote(current, id, body);
  }
  @Post(':noteId/amendments')
  @RequireCsrf('clinical_note.amend')
  amend(@CurrentSession() current: AuthenticatedSession, @Param('noteId') id: string,
    @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    requireJson(contentType);
    return this.care.amendNote(current, id, body);
  }
}

@AuthenticatedOnly()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly care: ClinicalCareService) {}
  @Get()
  inbox(@CurrentSession() current: AuthenticatedSession, @Query() query: unknown) {
    return this.care.listInbox(current, query);
  }
  @Get(':conversationId/messages')
  messages(@CurrentSession() current: AuthenticatedSession, @Param('conversationId') id: string,
    @Query() query: unknown) { return this.care.listMessages(current, id, query); }
  @Post(':conversationId/messages')
  @RequireCsrf('conversation.message.create')
  send(@CurrentSession() current: AuthenticatedSession, @Param('conversationId') id: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    requireJson(contentType);
    return this.care.sendMessage(current, id, requireIdempotencyKey(key), body);
  }
  @Put(':conversationId/read')
  @RequireCsrf('conversation.read')
  read(@CurrentSession() current: AuthenticatedSession, @Param('conversationId') id: string,
    @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    requireJson(contentType); return this.care.markMessagesRead(current, id, body);
  }
}

@AuthenticatedOnly()
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly care: ClinicalCareService) {}
  @Get()
  list(@CurrentSession() current: AuthenticatedSession, @Query() query: unknown) {
    return this.care.listPrescriptions(current, query);
  }
  @Get(':prescriptionId')
  get(@CurrentSession() current: AuthenticatedSession, @Param('prescriptionId') id: string) {
    return this.care.getPrescription(current, id);
  }
  @Get(':prescriptionId/pdf')
  @Header('Cache-Control', 'no-store')
  getPdf(@CurrentSession() current: AuthenticatedSession, @Param('prescriptionId') id: string) {
    return this.care.getPrescriptionPdf(current, id);
  }
  @Put(':prescriptionId')
  @RequireCsrf('prescription.update')
  update(@CurrentSession() current: AuthenticatedSession, @Param('prescriptionId') id: string,
    @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    requireJson(contentType); return this.care.updatePrescription(current, id, body);
  }
  @Put(':prescriptionId/status')
  @RequireCsrf('prescription.transition')
  status(@CurrentSession() current: AuthenticatedSession, @Param('prescriptionId') id: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    requireJson(contentType);
    return this.care.signPrescription(current, id, requireIdempotencyKey(key), body);
  }
  @Post(':prescriptionId/replacements')
  @RequireCsrf('prescription.supersede')
  supersede(@CurrentSession() current: AuthenticatedSession, @Param('prescriptionId') id: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    requireJson(contentType);
    return this.care.supersedePrescription(current, id, requireIdempotencyKey(key), body);
  }
  @Post(':prescriptionId/cancellation')
  @HttpCode(200)
  @RequireCsrf('prescription.cancel')
  cancel(@CurrentSession() current: AuthenticatedSession, @Param('prescriptionId') id: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    requireJson(contentType);
    return this.care.cancelPrescription(current, id, requireIdempotencyKey(key), body);
  }
}

@AuthenticatedOnly()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly care: ClinicalCareService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentSession() current: AuthenticatedSession, @Query() query: unknown) {
    return this.care.listNotifications(current, query);
  }
  @Put('read-all')
  @RequirePermission('notification:read:own', 'notification.read_all')
  @RequireCsrf('notification.read_all')
  readAll(@CurrentSession() current: AuthenticatedSession) {
    return this.care.markAllNotificationsRead(current);
  }
  @Put(':notificationId/read')
  @RequirePermission('notification:read:own', 'notification.read')
  @RequireCsrf('notification.read')
  read(@CurrentSession() current: AuthenticatedSession, @Param('notificationId') id: string) {
    return this.care.markNotificationRead(current, id);
  }
  @Get('preferences/me')
  preferences(@CurrentSession() current: AuthenticatedSession) {
    return this.care.listPreferences(current);
  }
  @Put('preferences/me')
  @RequirePermission('notification.preference:manage:own', 'notification.preference.update')
  @RequireCsrf('notification.preference.update')
  savePreference(@CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    requireJson(contentType); return this.care.savePreference(current, body);
  }
  @Post('push-devices')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('notification.preference:manage:own', 'notification.push_device.register')
  @RequireCsrf('notification.push_device.register')
  registerPushDevice(@CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    requireJson(contentType); return this.care.registerPushDevice(current, body);
  }
  @Put('push-devices/:pushDeviceId/revocation')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('notification.preference:manage:own', 'notification.push_device.revoke')
  @RequireCsrf('notification.push_device.revoke')
  revokePushDevice(@CurrentSession() current: AuthenticatedSession,
    @Param('pushDeviceId') pushDeviceId: string) {
    return this.care.revokePushDevice(current, pushDeviceId);
  }
}

// Doctor-workspace list endpoints. These are read-only GET views that project
// the same data the resource-scoped controllers above expose, grouped under
// /doctor for the portal doctor workspace. They carry no CSRF requirement
// (read-only) and send Cache-Control: no-store so paginated lists are never
// cached. Registration in app.module.ts is required for these to be reachable.
@AuthenticatedOnly()
@Controller('doctor/notes')
export class DoctorNotesController {
  constructor(private readonly care: ClinicalCareService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentSession() current: AuthenticatedSession, @Query() query: unknown) {
    return this.care.listDoctorNotes(current, query);
  }
}

@AuthenticatedOnly()
@Controller('doctor/prescriptions')
export class DoctorPrescriptionsController {
  constructor(private readonly care: ClinicalCareService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentSession() current: AuthenticatedSession, @Query() query: unknown) {
    return this.care.listPrescriptions(current, query);
  }
}

@AuthenticatedOnly()
@Controller('doctor/inbox')
export class DoctorInboxController {
  constructor(private readonly care: ClinicalCareService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentSession() current: AuthenticatedSession, @Query() query: unknown) {
    return this.care.listInbox(current, query);
  }
}

function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
}
function requireIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9._~-]{16,128}$/.test(value)) throw validationFailed();
  return value;
}
