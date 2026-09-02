import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AppointmentRepository,
  serializeAppointment,
  type AppointmentMode,
  type AppointmentRecord,
  type BookAppointmentResult,
  type HoldSlotResult,
  type RescheduleAppointmentResult,
  type SchedulingActorContext,
  type UpdateAppointmentStatusResult,
} from '@smartcura/database/appointments';
import { evaluatePermission } from '@smartcura/policy';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  appointmentPathSchema,
  bookAppointmentSchema,
  idempotencyKeySchema,
  listAppointmentsQuerySchema,
  organizationPathSchema,
  rescheduleAppointmentSchema,
  slotPathSchema,
  updateAppointmentStatusSchema,
  type ListAppointmentsQuery,
} from './appointment-request.schemas.js';

/** Replay window for an appointment `Idempotency-Key`. */
const IDEMPOTENCY_TTL_MS = 86_400_000;

/**
 * How long a hold reserves a slot. Long enough to complete a checkout, short
 * enough that an abandoned one returns capacity while the day is still bookable.
 */
const HOLD_TTL_MS = 300_000;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  /**
   * Takes a short-lived hold so a patient can complete a booking without losing
   * the slot. A hold is not a booking: it creates no appointment, and it expires
   * on its own.
   */
  async hold(
    current: AuthenticatedSession,
    slotIdValue: string,
  ): Promise<Record<string, unknown>> {
    const slotId = parseSlotId(slotIdValue);
    const authorized = await this.authorizePatient(
      current, 'appointment:book:own', 'appointment.slot.hold', slotId,
    );
    const result = await this.appointments.holdSlot({
      slotId,
      actor: schedulingActor(authorized, 'appointment:book:own'),
      holdTtlMs: HOLD_TTL_MS,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') {
      return {
        slot_id: result.slotId,
        membership_id: result.membershipId,
        organization_id: result.organizationId,
        starts_at: result.startsAt.toISOString(),
        ends_at: result.endsAt.toISOString(),
        held_until: result.heldUntil.toISOString(),
        version: result.version,
      };
    }
    return this.slotFailure(authorized, slotId, 'appointment.slot.hold', result);
  }

  /**
   * Books an appointment from a held or open slot.
   *
   * `Idempotency-Key` is mandatory. A replay returns the stored response snapshot
   * of the original request verbatim and never books a second appointment, even if
   * the appointment has since been cancelled or rescheduled.
   */
  async book(
    current: AuthenticatedSession,
    organizationIdValue: string,
    idempotencyKeyValue: string | undefined,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const organizationId = parseOrganizationPath(organizationIdValue);
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyValue);
    const request = parseBook(bodyValue);
    const authorized = await this.authorizePatient(
      current, 'appointment:book:own', 'appointment.book', request.slot_id,
    );
    // The organization in the path must be the one the acting patient membership
    // belongs to. This is a routing assertion, not the authorization: the
    // authoritative organization binding is proved under lock inside the booking
    // transaction, which refuses a slot belonging to any other organization. A
    // mismatch is concealed as 404 so the route cannot be used to discover which
    // organizations exist.
    await this.requireActingOrganization(
      authorized, organizationId, 'appointment.book', request.slot_id,
    );
    // ASSERTION: no price reaches the repository from here. `bookAppointment`
    // accepts only `slot_id` and `mode` and is `.strict()`, so a client-supplied
    // `fee_sen` is rejected as VALIDATION_FAILED rather than honoured. The fee is
    // read from the doctor's own `consultation_fee_sen` under lock in the same
    // transaction as the insert. A client-controlled price would be a payment
    // vulnerability: the patient would choose what to pay.
    const result = await this.appointments.book({
      slotId: request.slot_id,
      mode: request.mode,
      actor: schedulingActor(authorized, 'appointment:book:own'),
      idempotencyKey,
      requestHash: requestHash({
        slot_id: request.slot_id,
        mode: request.mode,
        patient_profile_id: authorized.aggregate.profile.profileId,
      }),
      idempotencyTtlMs: IDEMPOTENCY_TTL_MS,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') {
      return result.replayed ? result.snapshot.body : serializeAppointment(result.record);
    }
    return this.bookingFailure(authorized, request.slot_id, result);
  }

  /**
   * Lists appointments in the only scope the acting membership has: a patient sees
   * their own, a doctor sees the ones assigned to them, an administrator sees the
   * organization's scheduling metadata. Pagination is deterministic on
   * `(created_at, appointment_id)`.
   */
  async list(
    current: AuthenticatedSession,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const query = parseList(queryValue);
    const view = await this.authorizeRead(current, null);
    const records = await this.appointments.list({
      scope: view.scope,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.cursor === undefined ? {} : decodeCursor(query.cursor)),
      limit: query.page_size + 1,
    });
    const hasMore = records.length > query.page_size;
    const page = hasMore ? records.slice(0, query.page_size) : records;
    const last = page.at(-1);
    return {
      data: page.map(serializeAppointment),
      page: {
        has_more: hasMore,
        next_cursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      },
    };
  }

  async get(
    current: AuthenticatedSession,
    appointmentIdValue: string,
  ): Promise<Record<string, unknown>> {
    const appointmentId = parseAppointmentId(appointmentIdValue);
    const view = await this.authorizeRead(current, appointmentId);
    const record = await this.appointments.findById(appointmentId);
    // Concealed as not found rather than forbidden: whether an appointment exists
    // between two other people is itself sensitive.
    if (record === undefined || !visibleTo(record, view)) {
      return this.deny(
        current, null, appointmentId, 'appointment.read', 404, 'RESOURCE_NOT_FOUND',
        'Appointment was not found',
      );
    }
    return serializeAppointment(record);
  }

  /**
   * Cancels, completes or records non-attendance.
   *
   * Cancellation belongs to the patient (`appointment:cancel:own`); completion and
   * non-attendance belong to the assigned doctor (`appointment:complete:assigned`).
   * No role holds both, so neither party can unilaterally rewrite the other's
   * outcome.
   */
  async updateStatus(
    current: AuthenticatedSession,
    appointmentIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const appointmentId = parseAppointmentId(appointmentIdValue);
    const request = parseStatus(bodyValue);
    const active = current.aggregate.memberships.find(
      (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
    );
    const doctorAction = request.status === 'in_progress' ||
      request.status === 'completed' || request.status === 'no_show' ||
      (request.status === 'cancelled' && active?.roleId === 'doctor');
    const permission = request.status === 'checked_in'
      ? 'appointment:check_in:own'
      : request.status === 'in_progress'
        ? 'appointment:start:assigned'
        : request.status === 'cancelled' && doctorAction
          ? 'appointment:cancel:assigned'
          : request.status === 'cancelled'
            ? 'appointment:cancel:own'
            : 'appointment:complete:assigned';
    const action = `appointment.${request.status}`;
    const authorized = doctorAction
      ? await this.authorizeDoctor(current, permission, action, appointmentId)
      : await this.authorizePatient(current, permission, action, appointmentId);
    const result = await this.appointments.updateStatus({
      appointmentId,
      actor: schedulingActor(authorized, permission),
      actorKind: doctorAction ? 'doctor' : 'patient',
      nextStatus: request.status,
      reasonCode: 'reason_code' in request ? request.reason_code : null,
      expectedVersion: request.expected_version,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') return serializeAppointment(result);
    return this.statusFailure(authorized, appointmentId, action, result);
  }

  /**
   * Reschedules by replacement. The original keeps its time, fee and payment and
   * moves to `rescheduled` with a link to the replacement; a new appointment is
   * created against the new slot in the same transaction.
   */
  async reschedule(
    current: AuthenticatedSession,
    appointmentIdValue: string,
    idempotencyKeyValue: string | undefined,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const appointmentId = parseAppointmentId(appointmentIdValue);
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyValue);
    const request = parseReschedule(bodyValue);
    const authorized = await this.authorizePatient(
      current, 'appointment:cancel:own', 'appointment.reschedule', appointmentId,
    );
    // A reschedule both cancels and books, so it requires both authorities rather
    // than treating booking as a side effect of cancellation.
    await this.requirePermission(
      authorized, 'appointment:book:own', 'appointment.reschedule', appointmentId,
    );
    const result = await this.appointments.reschedule({
      appointmentId,
      slotId: request.slot_id,
      mode: request.mode as AppointmentMode | null,
      actor: schedulingActor(
        authorized, 'appointment:cancel:own', ['appointment:book:own'],
      ),
      expectedVersion: request.expected_version,
      idempotencyKey,
      requestHash: requestHash({
        appointment_id: appointmentId,
        slot_id: request.slot_id,
        mode: request.mode,
        expected_version: request.expected_version,
      }),
      idempotencyTtlMs: IDEMPOTENCY_TTL_MS,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') {
      if (result.replayed) return result.snapshot.body;
      return {
        ...serializeAppointment(result.record),
        replaces_appointment_id: result.replacedAppointmentId,
      };
    }
    return this.rescheduleFailure(authorized, appointmentId, result);
  }

  /**
   * Confirms the addressed organization is the acting membership's own. A
   * membership belongs to exactly one organization, so there is nothing to
   * choose: any other value in the path is either a typo or a probe, and both
   * answer 404.
   */
  private async requireActingOrganization(
    current: AuthenticatedSession,
    organizationId: string,
    action: string,
    objectId: string,
  ): Promise<void> {
    const active = current.aggregate.memberships.find(
      (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.organizationId !== organizationId) {
      await this.deny(
        current, null, objectId, action, 404, 'RESOURCE_NOT_FOUND',
        'Organization was not found',
      );
    }
  }

  private async authorizePatient(
    current: AuthenticatedSession,
    permission: string,
    action: string,
    objectId: string,
  ): Promise<AuthenticatedSession> {
    const active = await this.requireOnboardedMembership(current, action, objectId);
    if (active.roleId !== 'patient') {
      return this.deny(
        current, null, objectId, action, 403, 'PERMISSION_DENIED',
        'Booking is only permitted for a patient membership',
      );
    }
    return this.requirePermission(current, permission, action, objectId);
  }

  private async authorizeDoctor(
    current: AuthenticatedSession,
    permission: string,
    action: string,
    objectId: string,
  ): Promise<AuthenticatedSession> {
    const active = await this.requireOnboardedMembership(current, action, objectId);
    if (active.roleId !== 'doctor') {
      return this.deny(
        current, null, objectId, action, 403, 'PERMISSION_DENIED',
        'Only the assigned doctor may record this outcome',
      );
    }
    return this.requirePermission(current, permission, action, objectId);
  }

  /**
   * Resolves the single read scope the acting membership is entitled to. There is
   * no cross-scope fallback: an actor reads appointments as exactly one of patient,
   * assigned doctor or organization administrator.
   */
  private async authorizeRead(
    current: AuthenticatedSession,
    objectId: string | null,
  ): Promise<AppointmentView> {
    const active = await this.requireOnboardedMembership(current, 'appointment.read', objectId);
    const profileId = current.aggregate.profile.profileId;
    if (active.roleId === 'patient') {
      await this.requirePermission(current, 'appointment:read:own', 'appointment.read', objectId);
      return { kind: 'patient', profileId, scope: { kind: 'patient', patientProfileId: profileId } };
    }
    if (active.roleId === 'doctor') {
      await this.requirePermission(
        current, 'appointment:read:assigned', 'appointment.read', objectId,
      );
      return {
        kind: 'doctor',
        membershipId: active.membershipId,
        scope: { kind: 'doctor', doctorMembershipId: active.membershipId },
      };
    }
    if (active.roleId === 'admin') {
      await this.requirePermission(
        current, 'appointment:read:organization', 'appointment.read', objectId,
      );
      return {
        kind: 'organization',
        organizationId: active.organizationId,
        scope: { kind: 'organization', organizationId: active.organizationId },
      };
    }
    if (active.roleId === 'super_admin') {
      await this.requirePermission(
        current, 'appointment:read:global', 'appointment.read', objectId,
      );
      return { kind: 'global', scope: { kind: 'global' } };
    }
    return this.deny(
      current, null, objectId, 'appointment.read', 403, 'PERMISSION_DENIED',
      'Appointments are not readable for this membership',
    );
  }

  private async requireOnboardedMembership(
    current: AuthenticatedSession,
    action: string,
    objectId: string | null,
  ) {
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, null, objectId, action, 403, 'PERMISSION_DENIED',
        'Profile onboarding is incomplete',
      );
    }
    const active = current.aggregate.memberships.find(
      (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      return this.deny(
        current, null, objectId, action, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    return active;
  }

  private async requirePermission(
    current: AuthenticatedSession,
    permission: string,
    action: string,
    objectId: string | null,
  ): Promise<AuthenticatedSession> {
    const active = current.aggregate.memberships.find(
      (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined) {
      return this.deny(
        current, null, objectId, action, 403, 'MEMBERSHIP_INACTIVE',
        'An active membership is required',
      );
    }
    const profileId = current.aggregate.profile.profileId;
    const decision = evaluatePermission(active.permissions, permission, {
      actorProfileId: profileId,
      ownerProfileId: profileId,
      // `assigned` is satisfied structurally rather than by claim: the repository
      // matches the appointment's doctor membership against the acting membership
      // under lock, and a mismatch is concealed as a 404.
      assigned: true,
      resourceOrganizationId: active.organizationId,
      membershipOrganizationId: active.organizationId,
      globalAllowed: active.roleId === 'super_admin',
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, null, objectId, action, 403, code, 'Access is not permitted',
      );
    }
    return this.authorization.touch(current);
  }

  private async slotFailure(
    current: AuthenticatedSession,
    slotId: string,
    action: string,
    result: Extract<HoldSlotResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'slot_not_found':
        return this.deny(
          current, null, slotId, action, 404, 'RESOURCE_NOT_FOUND', 'Slot was not found',
        );
      case 'slot_unavailable':
        return this.deny(
          current, null, slotId, action, 409, 'APPOINTMENT_SLOT_UNAVAILABLE',
          'Slot is no longer available',
        );
      case 'doctor_unavailable':
        return this.deny(
          current, null, slotId, action, 409, 'APPOINTMENT_SLOT_UNAVAILABLE',
          'Slot is no longer available',
        );
      default:
        return this.actorFailure(current, slotId, action, result);
    }
  }

  private async bookingFailure(
    current: AuthenticatedSession,
    slotId: string,
    result: Extract<BookAppointmentResult, string>,
  ): Promise<never> {
    if (result === 'patient_unavailable') {
      return this.deny(
        current, null, slotId, 'appointment.book', 409,
        'APPOINTMENT_PATIENT_UNAVAILABLE',
        'The patient already has an overlapping appointment',
      );
    }
    if (result === 'idempotency_reused') {
      return this.deny(
        current, null, slotId, 'appointment.book', 409, 'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was reused',
      );
    }
    return this.slotFailure(current, slotId, 'appointment.book', result);
  }

  private async statusFailure(
    current: AuthenticatedSession,
    appointmentId: string,
    action: string,
    result: Extract<UpdateAppointmentStatusResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'not_found':
        return this.deny(
          current, null, appointmentId, action, 404, 'RESOURCE_NOT_FOUND',
          'Appointment was not found',
        );
      case 'version_conflict':
        return this.deny(
          current, null, appointmentId, action, 409, 'APPOINTMENT_VERSION_CONFLICT',
          'Appointment version is stale',
        );
      case 'transition_invalid':
        return this.deny(
          current, null, appointmentId, action, 409, 'APPOINTMENT_TRANSITION_INVALID',
          'Appointment transition is invalid',
        );
      default:
        return this.actorFailure(current, appointmentId, action, result);
    }
  }

  private async rescheduleFailure(
    current: AuthenticatedSession,
    appointmentId: string,
    result: Extract<RescheduleAppointmentResult, string>,
  ): Promise<never> {
    switch (result) {
      case 'slot_not_found':
        return this.deny(
          current, null, appointmentId, 'appointment.reschedule', 404, 'RESOURCE_NOT_FOUND',
          'Slot was not found',
        );
      case 'slot_unavailable':
        return this.deny(
          current, null, appointmentId, 'appointment.reschedule', 409,
          'APPOINTMENT_SLOT_UNAVAILABLE', 'Slot is no longer available',
        );
      case 'patient_unavailable':
        return this.deny(
          current, null, appointmentId, 'appointment.reschedule', 409,
          'APPOINTMENT_PATIENT_UNAVAILABLE',
          'The patient already has an overlapping appointment',
        );
      case 'idempotency_reused':
        return this.deny(
          current, null, appointmentId, 'appointment.reschedule', 409,
          'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused',
        );
      default:
        return this.statusFailure(current, appointmentId, 'appointment.reschedule', result);
    }
  }

  private async actorFailure(
    current: AuthenticatedSession,
    objectId: string,
    action: string,
    result: 'actor_session_invalid' | 'actor_permission_denied' | 'actor_step_up_required',
  ): Promise<never> {
    switch (result) {
      case 'actor_session_invalid':
        return this.deny(
          current, null, objectId, action, 401, 'APP_SESSION_INVALID',
          'The session is no longer valid',
        );
      case 'actor_permission_denied':
        return this.deny(
          current, null, objectId, action, 403, 'PERMISSION_DENIED',
          'Access is not permitted',
        );
      case 'actor_step_up_required':
        return this.deny(
          current, null, objectId, action, 403, 'STEP_UP_REQUIRED',
          'A current MFA step-up is required',
        );
    }
  }

  private async deny(
    current: AuthenticatedSession,
    organizationId: string | null,
    objectId: string | null,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.appointments.recordDenial(
      organizationId,
      objectId,
      current.aggregate.profile.profileId,
      action,
      code,
      requestCorrelationId,
    );
    throw problem(status, code, title, requestCorrelationId);
  }
}

type AppointmentView =
  | {
      readonly kind: 'patient';
      readonly profileId: string;
      readonly scope: { readonly kind: 'patient'; readonly patientProfileId: string };
    }
  | {
      readonly kind: 'doctor';
      readonly membershipId: string;
      readonly scope: { readonly kind: 'doctor'; readonly doctorMembershipId: string };
    }
  | {
      readonly kind: 'organization';
      readonly organizationId: string;
      readonly scope: { readonly kind: 'organization'; readonly organizationId: string };
    }
  | {
      readonly kind: 'global';
      readonly scope: { readonly kind: 'global' };
    };

function visibleTo(record: AppointmentRecord, view: AppointmentView): boolean {
  switch (view.kind) {
    case 'patient': return record.patientProfileId === view.profileId;
    case 'doctor': return record.doctorMembershipId === view.membershipId;
    case 'organization': return record.organizationId === view.organizationId;
    case 'global': return true;
  }
}

/**
 * Describes the actor so the repository can re-prove authority under lock in the
 * same transaction as the write. The HTTP guards already checked these conditions,
 * but that is only a fast rejection: between the guard and the write the session
 * can be revoked or the membership suspended.
 */
function schedulingActor(
  authorized: AuthenticatedSession,
  permission: string,
  additionalRequiredPermissions: readonly string[] = [],
): SchedulingActorContext {
  const membershipId = authorized.aggregate.session.activeMembershipId;
  if (membershipId === null) throw new Error('Authorized membership context is missing');
  return {
    sessionId: authorized.aggregate.session.sessionId,
    tokenHash: authorized.tokenHash,
    membershipId,
    requiredPermission: permission,
    ...(additionalRequiredPermissions.length === 0
      ? {}
      : { additionalRequiredPermissions }),
    // Booking and consultation outcomes are routine care actions, not privileged
    // administration; requiring a fresh MFA step-up would push clinicians and
    // patients towards keeping elevated sessions open all day.
    requireStepUp: false,
  };
}

function parseSlotId(value: string): string {
  const result = slotPathSchema.safeParse({ slotId: value });
  if (!result.success) throw validationFailed();
  return result.data.slotId;
}

function parseAppointmentId(value: string): string {
  const result = appointmentPathSchema.safeParse({ appointmentId: value });
  if (!result.success) throw validationFailed();
  return result.data.appointmentId;
}

function parseOrganizationPath(value: string): string {
  const result = organizationPathSchema.safeParse({ organizationId: value });
  if (!result.success) throw validationFailed();
  return result.data.organizationId;
}

function parseIdempotencyKey(value: unknown): string {
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseBook(value: unknown) {
  const result = bookAppointmentSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseList(value: unknown): ListAppointmentsQuery {
  const result = listAppointmentsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseStatus(value: unknown) {
  const result = updateAppointmentStatusSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseReschedule(value: unknown) {
  const result = rescheduleAppointmentSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function requestHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function encodeCursor(record: AppointmentRecord): string {
  return Buffer.from(JSON.stringify({
    created_at: record.createdAt.toISOString(),
    appointment_id: record.appointmentId,
  }), 'utf8').toString('base64url');
}

function decodeCursor(value: string): {
  readonly afterCreatedAt: Date;
  readonly afterAppointmentId: string;
} {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null) throw new Error();
    const candidate = decoded as Record<string, unknown>;
    const createdAtValue = candidate['created_at'];
    const appointmentIdValue = candidate['appointment_id'];
    if (typeof createdAtValue !== 'string' || typeof appointmentIdValue !== 'string') {
      throw new Error();
    }
    const createdAt = new Date(createdAtValue);
    if (!Number.isFinite(createdAt.getTime())) throw new Error();
    return {
      afterCreatedAt: createdAt,
      afterAppointmentId: parseAppointmentId(appointmentIdValue),
    };
  } catch {
    throw validationFailed();
  }
}
