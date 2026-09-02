import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection, SerializationConflictError } from './connection.js';
import {
  PLATFORM_ACCOUNTS, postBalancedEntry, resolvePlatformAccount,
} from './ledger-posting.js';
import {
  revalidateSchedulingActor,
  type SchedulingActor,
  type SchedulingActorContext,
  type SchedulingActorFailure,
} from './availability-repository.js';
import {
  APPOINTMENT_PAYMENT_REQUESTED_EVENT_TYPE,
  APPOINTMENT_PAYMENT_REQUESTED_EVENT_VERSION,
} from './appointment-payment-events.js';
import { createNotification } from './notification-repository.js';

/**
 * Canonical event contract for every appointment mutation. The payload must match
 * `AppointmentChangedData` in the AsyncAPI document exactly, which declares
 * `additionalProperties: false`, so no extra key may be added here. Contextual
 * detail belongs in the audit log, not in the published event.
 */
export const APPOINTMENT_CHANGED_EVENT_TYPE = 'appointment.changed.v1';
export const APPOINTMENT_CHANGED_EVENT_VERSION = 1;

export const APPOINTMENT_MODES = ['video', 'audio', 'chat', 'in_person'] as const;
export type AppointmentMode = typeof APPOINTMENT_MODES[number];

export const APPOINTMENT_STATUSES = [
  'pending_payment', 'confirmed', 'checked_in', 'in_progress',
  'cancelled', 'completed', 'no_show', 'rescheduled',
] as const;
export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number];

/**
 * Structured, PHI-free cancellation reasons. Free text is deliberately not
 * accepted: the reason reaches audit logs, the other party's appointment view and
 * the published event, and no caller can be relied upon to keep clinical detail
 * out of an open string field.
 */
export const APPOINTMENT_CANCELLATION_REASON_CODES = [
  'patient_request',
  'doctor_unavailable',
  'schedule_conflict',
  'payment_expired',
  'duplicate_booking',
  'clinical_reason',
  'administrative_action',
] as const;
export type AppointmentCancellationReasonCode =
  typeof APPOINTMENT_CANCELLATION_REASON_CODES[number];

/** Non-attendance findings, recorded by the assigned doctor only. */
export const APPOINTMENT_NO_SHOW_REASON_CODES = [
  'patient_absent',
  'patient_late',
  'patient_unreachable',
] as const;
export type AppointmentNoShowReasonCode = typeof APPOINTMENT_NO_SHOW_REASON_CODES[number];

/** The reason code a reschedule always stamps on the appointment it replaces. */
const RESCHEDULE_REASON_CODE = 'rescheduled';

const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';

export interface AppointmentRecord {
  readonly appointmentId: string;
  readonly slotId: string;
  readonly patientProfileId: string;
  readonly doctorMembershipId: string;
  readonly organizationId: string;
  readonly mode: AppointmentMode;
  readonly status: AppointmentStatus;
  readonly feeSen: number;
  readonly currency: string;
  readonly cancellationReasonCode: string | null;
  readonly replacedByAppointmentId: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly paymentState: 'pending' | 'captured' | 'refunded' | 'failed' | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A replayed idempotent request returns the byte-for-byte response stored when the
 * original request succeeded. Reloading current state instead would let a replay
 * observe later mutations, which breaks the guarantee `Idempotency-Key` makes.
 */
export interface AppointmentResponseSnapshot {
  readonly status: 201;
  readonly body: Record<string, unknown>;
}

export interface HoldSlotInput {
  readonly slotId: string;
  readonly actor: SchedulingActorContext;
  readonly holdTtlMs: number;
  readonly now: Date;
  readonly correlationId: string;
}

export interface SlotHoldRecord {
  readonly slotId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly heldUntil: Date;
  readonly heldByProfileId: string;
  readonly version: number;
}

export type HoldSlotResult =
  | SlotHoldRecord
  | 'slot_not_found'
  | 'slot_unavailable'
  | 'doctor_unavailable'
  | SchedulingActorFailure;

export interface BookAppointmentInput {
  readonly slotId: string;
  readonly mode: AppointmentMode;
  readonly actor: SchedulingActorContext;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly idempotencyTtlMs: number;
  readonly now: Date;
  readonly correlationId: string;
}

export type BookAppointmentResult =
  | { readonly record: AppointmentRecord; readonly replayed: false }
  | { readonly snapshot: AppointmentResponseSnapshot; readonly replayed: true }
  | 'slot_not_found'
  | 'slot_unavailable'
  | 'doctor_unavailable'
  | 'patient_unavailable'
  | 'idempotency_reused'
  | SchedulingActorFailure;

export interface ListAppointmentsInput {
  readonly scope:
    | { readonly kind: 'patient'; readonly patientProfileId: string }
    | { readonly kind: 'doctor'; readonly doctorMembershipId: string }
    | { readonly kind: 'organization'; readonly organizationId: string }
    | { readonly kind: 'global' };
  readonly status?: AppointmentStatus;
  readonly afterCreatedAt?: Date;
  readonly afterAppointmentId?: string;
  readonly limit: number;
}

export interface UpdateAppointmentStatusInput {
  readonly appointmentId: string;
  readonly actor: SchedulingActorContext;
  readonly actorKind: 'patient' | 'doctor';
  readonly nextStatus: 'cancelled' | 'checked_in' | 'in_progress' | 'completed' | 'no_show';
  readonly reasonCode: string | null;
  readonly expectedVersion: number;
  readonly now: Date;
  readonly correlationId: string;
}

export type UpdateAppointmentStatusResult =
  | AppointmentRecord
  | 'not_found'
  | 'version_conflict'
  | 'transition_invalid'
  | SchedulingActorFailure;

export interface RescheduleAppointmentInput {
  readonly appointmentId: string;
  readonly slotId: string;
  readonly mode: AppointmentMode | null;
  readonly actor: SchedulingActorContext;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly idempotencyTtlMs: number;
  readonly now: Date;
  readonly correlationId: string;
}

export type RescheduleAppointmentResult =
  | {
      readonly record: AppointmentRecord;
      readonly replacedAppointmentId: string;
      readonly replayed: false;
    }
  | { readonly snapshot: AppointmentResponseSnapshot; readonly replayed: true }
  | 'not_found'
  | 'version_conflict'
  | 'transition_invalid'
  | 'slot_not_found'
  | 'slot_unavailable'
  | 'patient_unavailable'
  | 'idempotency_reused'
  | SchedulingActorFailure;

export interface AppointmentPaymentWorkItem {
  readonly paymentId: string;
  readonly appointmentId: string;
  readonly amountSen: number;
  readonly currency: string;
  readonly state: 'pending' | 'captured' | 'refunded' | 'failed';
}

export interface SettleAppointmentPaymentInput {
  readonly paymentId: string;
  readonly outcome: 'captured' | 'failed';
  readonly now: Date;
  readonly correlationId: string;
}

export type SettleAppointmentPaymentResult =
  | 'settled' | 'already_settled' | 'not_found' | 'conflict';

interface AppointmentRow extends QueryResultRow {
  readonly appointmentId: string;
  readonly slotId: string;
  readonly patientProfileId: string;
  readonly doctorMembershipId: string;
  readonly organizationId: string;
  readonly mode: AppointmentMode;
  readonly status: AppointmentStatus;
  readonly feeSen: string;
  readonly currency: string;
  readonly cancellationReasonCode: string | null;
  readonly replacedByAppointmentId: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly paymentState: AppointmentRecord['paymentState'];
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface SlotLockRow extends QueryResultRow {
  readonly slotId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly state: 'open' | 'held' | 'booked' | 'closed';
  readonly heldUntil: Date | null;
  readonly heldByProfileId: string | null;
  readonly version: number;
}

interface PaymentRow extends QueryResultRow {
  readonly paymentId: string;
  readonly appointmentId: string;
  readonly amountSen: string;
  readonly currency: string;
  readonly state: AppointmentPaymentWorkItem['state'];
}

interface IdempotencyRow extends QueryResultRow {
  readonly requestHash: string;
  readonly state: string;
  readonly responseStatus: number | null;
  readonly responseBody: Record<string, unknown> | null;
  readonly expired: boolean;
}

interface IdempotencyScope {
  readonly organizationId: string;
  readonly actorProfileId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
}

export class AppointmentRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Takes a short-lived hold on a slot.
   *
   * Lock order for every appointment mutation: actor session and membership, then
   * the slot row, then the appointment row, then the payment row. The organization
   * row is deliberately NOT locked, unlike membership administration: booking is
   * the highest-contention path in the platform and serialising an organization
   * behind one row would trade a deadlock risk for a throughput collapse. Nothing
   * here depends on an organization-wide invariant — the no-double-booking
   * guarantee is carried by database constraints.
   */
  async holdSlot(input: HoldSlotInput): Promise<HoldSlotResult> {
    return this.database.transaction(async (client) => {
      const actor = await revalidateSchedulingActor(client, input.actor, input.now);
      if (typeof actor === 'string') return actor;

      const slot = await this.lockSlot(client, input.slotId);
      if (slot === undefined || slot.organizationId !== actor.organizationId) {
        return 'slot_not_found';
      }
      if (!slotClaimable(slot, actor.profileId, input.now)) return 'slot_unavailable';
      if (await this.doctorFee(client, slot.membershipId, slot.organizationId) === undefined) {
        return 'doctor_unavailable';
      }
      const heldUntil = new Date(input.now.getTime() + input.holdTtlMs);
      const updated = await client.query<SlotLockRow>(
        `UPDATE appointment_slots
         SET state = 'held', held_until = $2, held_by_profile_id = $3,
             version = version + 1, updated_at = $4
         WHERE slot_id = $1 AND version = $5
         RETURNING ${slotColumns()}`,
        [slot.slotId, heldUntil, actor.profileId, input.now, slot.version],
      );
      const row = updated.rows[0];
      if (row === undefined) throw new Error('Concurrent slot hold was not serialized');
      await this.audit(client, {
        organizationId: slot.organizationId,
        actorProfileId: actor.profileId,
        action: 'appointment.slot.hold',
        objectId: slot.slotId,
        objectType: 'appointment_slot',
        reason: null,
        metadata: {
          membership_id: slot.membershipId,
          held_until: heldUntil.toISOString(),
          version: row.version,
        },
        correlationId: input.correlationId,
      });
      return {
        slotId: row.slotId,
        membershipId: row.membershipId,
        organizationId: row.organizationId,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        heldUntil,
        heldByProfileId: actor.profileId,
        version: row.version,
      };
    });
  }

  /**
   * Books an appointment from a held or open slot.
   *
   * Fails closed on contention: the slot row is taken with `SELECT ... FOR UPDATE`
   * and any constraint violation raised by a racing writer is mapped to
   * `slot_unavailable` rather than surfacing as a server error. The lock produces
   * the clean error code; the guarantee itself comes from the database —
   * `appointments_slot_uq` and `appointment_slots_no_overlapping_booking` make a
   * second booking of one slot impossible even with every application check gone.
   *
   * Payment is simulated but asynchronous across the transactional outbox boundary:
   * a positive fee creates a pending intent and leaves the appointment
   * `pending_payment`; the worker settles it after commit. A zero fee creates no
   * payment aggregate and confirms in this transaction.
   */
  async book(input: BookAppointmentInput): Promise<BookAppointmentResult> {
    try {
      return await this.database.serializableTransaction(async (client) => {
        const actor = await revalidateSchedulingActor(client, input.actor, input.now);
        if (typeof actor === 'string') return actor;

        const slot = await this.lockSlot(client, input.slotId);
        if (slot === undefined || slot.organizationId !== actor.organizationId) {
          return 'slot_not_found';
        }
        const scope: IdempotencyScope = {
          organizationId: slot.organizationId,
          actorProfileId: actor.profileId,
          operationId: 'appointment.book',
          idempotencyKey: input.idempotencyKey,
        };
        const existing = await this.loadIdempotency(client, scope, input.now);
        if (existing !== undefined && !existing.expired) {
          return this.resolveIdempotency(existing, input.requestHash);
        }
        if (existing?.expired === true) await this.deleteIdempotency(client, scope);
        if (!slotClaimable(slot, actor.profileId, input.now)) return 'slot_unavailable';
        const fee = await this.doctorFee(client, slot.membershipId, slot.organizationId);
        if (fee === undefined) return 'doctor_unavailable';
        await this.lockPatientSchedule(client, actor.profileId);
        if (await this.patientHasOverlap(
          client, actor.profileId, slot.startsAt, slot.endsAt, null,
        )) return 'patient_unavailable';
        if (!await this.claimIdempotency(client, scope, input)) {
          const raced = await this.loadIdempotency(client, scope, input.now);
          if (raced === undefined) throw new Error('Idempotency claim disappeared');
          return this.resolveIdempotency(raced, input.requestHash);
        }

        const created = await this.insertAppointment(client, {
          slotId: slot.slotId,
          patientProfileId: actor.profileId,
          doctorMembershipId: slot.membershipId,
          organizationId: slot.organizationId,
          mode: input.mode,
          feeSen: fee,
          now: input.now,
        });
        await this.appendHistory(client, created.appointmentId, null, 'pending_payment', null, actor.profileId, input);
        await this.occupySlot(client, slot.slotId, input.now);
        const booked = fee > 0
          ? await this.createPendingPayment(client, created, input)
          : await this.transitionToConfirmed(client, created, actor.profileId, input);
        await this.audit(client, {
          organizationId: slot.organizationId,
          actorProfileId: actor.profileId,
          action: 'appointment.book',
          objectId: booked.appointmentId,
          objectType: 'appointment',
          reason: null,
          metadata: {
            slot_id: slot.slotId,
            doctor_membership_id: slot.membershipId,
            mode: booked.mode,
            fee_sen: booked.feeSen,
            currency: booked.currency,
            status: booked.status,
            version: booked.version,
          },
          correlationId: input.correlationId,
        });
        await this.publish(client, booked, null, null, input.correlationId, input.now);
        // The doctor must act on every new booking (confirm or decline it), so
        // they are notified unconditionally. A zero-fee appointment is already
        // confirmed at this point — the patient is notified of the confirmation;
        // a paid one is confirmed by the payment worker when the capture lands.
        await this.notifyAppointmentParty(
          client, booked, 'doctor', 'appointment.requested.title', input,
        );
        if (booked.status === 'confirmed') {
          await this.notifyAppointmentParty(
            client, booked, 'patient', 'appointment.confirmed.title', input,
          );
        }
        const body = serializeAppointment(booked);
        await this.completeIdempotency(client, scope, 201, body, input.now);
        return { record: booked, replayed: false };
      });
    } catch (error) {
      if (isSlotContention(error)) return 'slot_unavailable';
      // An exhausted SERIALIZABLE retry is a stable, retryable 409, but it tells a client
      // nothing and invites a pointless retry against a slot that is already gone. On
      // exhaustion the truth is knowable, so it is read: if the slot is no longer
      // claimable, answer with the reason the caller can act on.
      if (error instanceof SerializationConflictError) {
        // The diagnosis must never make the original outcome WORSE. This read once queried
        // columns that do not exist (`status`, `hold_expires_at`; the real ones are `state` and
        // `held_until`), so under contention the caller received a 500 INTERNAL_ERROR instead of
        // the stable retryable conflict it would have got without the improvement — visible only
        // under load, in roughly one 20-way race in four. If diagnosis fails for any reason the
        // original contention error is rethrown, which is honest and retryable.
        try {
          const slot = await this.readSlotForDiagnosis(input.slotId);
          const gone = slot === undefined
            || slot.state !== 'open'
            || (slot.heldByProfileId !== null
              && slot.heldUntil !== null
              && slot.heldUntil > input.now);
          if (gone) return 'slot_unavailable';
        } catch {
          throw error;
        }
      }
      throw error;
    }
  }

  /** Reads a slot outside any transaction, for post-contention diagnosis only. */
  private async readSlotForDiagnosis(slotId: string) {
    const found = await this.database.query<{
      slotId: string; state: string; heldByProfileId: string | null;
      heldUntil: Date | null; startsAt: Date;
    }>(
      `SELECT slot_id AS "slotId", state, held_by_profile_id AS "heldByProfileId",
              held_until AS "heldUntil", starts_at AS "startsAt"
         FROM appointment_slots WHERE slot_id = $1`,
      [slotId],
    );
    return found.rows[0];
  }

  async list(input: ListAppointmentsInput): Promise<AppointmentRecord[]> {
    const scopeClause = input.scope.kind === 'patient'
      ? 'appointment.patient_profile_id = $1'
      : input.scope.kind === 'doctor'
        ? 'appointment.doctor_membership_id = $1'
        : input.scope.kind === 'organization'
          ? 'appointment.organization_id = $1'
          : '$1::text IS NULL';
    const scopeValue = input.scope.kind === 'patient'
      ? input.scope.patientProfileId
      : input.scope.kind === 'doctor'
        ? input.scope.doctorMembershipId
        : input.scope.kind === 'organization'
          ? input.scope.organizationId
          : null;
    const result = await this.database.query<AppointmentRow>(
      `${appointmentProjection()}
       WHERE ${scopeClause}
         AND ($2::text IS NULL OR appointment.status = $2::appointment_status)
         AND ($3::timestamptz IS NULL OR
           (appointment.created_at, appointment.appointment_id) > ($3, $4::uuid))
       ORDER BY appointment.created_at, appointment.appointment_id
       LIMIT $5`,
      [
        scopeValue,
        input.status ?? null,
        input.afterCreatedAt ?? null,
        input.afterAppointmentId ?? null,
        input.limit,
      ],
    );
    return result.rows.map(toAppointmentRecord);
  }

  async findById(appointmentId: string): Promise<AppointmentRecord | undefined> {
    const result = await this.database.query<AppointmentRow>(
      `${appointmentProjection()} WHERE appointment.appointment_id = $1`,
      [appointmentId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toAppointmentRecord(row);
  }

  /**
   * The patient's next upcoming appointment — the single earliest appointment
   * whose slot starts after `now` and whose status is still live (not yet
   * cancelled, completed, marked non-attendance or rescheduled away).
   *
   * A convenience aggregate for the patient home screen, so the app does not have
   * to page through the full appointment list to find the one row it wants. The
   * status set mirrors the overlap check `patientHasOverlap` uses: the four
   * statuses that mean the appointment is still going to happen. `now` is taken
   * at call time, not from the request, so a cached response can never report a
   * slot in the past as upcoming. Returns `undefined` when there is none.
   */
  async findNextUpcoming(input: {
    patientProfileId: string; now: Date;
  }): Promise<AppointmentRecord | undefined> {
    const result = await this.database.query<AppointmentRow>(
      `${appointmentProjection()}
       WHERE appointment.patient_profile_id = $1
         AND appointment.status IN ('pending_payment','confirmed','checked_in','in_progress')
         AND slot.starts_at > $2
       ORDER BY slot.starts_at, appointment.appointment_id
       LIMIT 1`,
      [input.patientProfileId, input.now],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toAppointmentRecord(row);
  }

  /**
   * Cancels, completes or records non-attendance for an appointment.
   *
   * Cancellation closes the slot rather than reopening it: `appointments_slot_uq`
   * makes a slot single-use forever, so an "available again" slot row could be
   * held and then fail at INSERT. Regeneration from the rules creates a fresh open
   * slot for the same instant, which the partial live-uniqueness index allows
   * precisely because the cancelled slot is `closed`.
   */
  async updateStatus(
    input: UpdateAppointmentStatusInput,
  ): Promise<UpdateAppointmentStatusResult> {
    return this.database.transaction(async (client) => {
      const actor = await revalidateSchedulingActor(client, input.actor, input.now);
      if (typeof actor === 'string') return actor;

      const current = await this.lockAppointment(client, input.appointmentId);
      if (current === undefined) return 'not_found';
      if (!actorOwnsAppointment(current, actor, input.actorKind)) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (!transitionAllowed(
        current, input.nextStatus, input.actorKind, input.now,
      )) return 'transition_invalid';

      await this.applyStatus(client, current, input);
      if (input.nextStatus === 'cancelled') {
        await this.closeSlot(client, current.slotId, input.now);
        await this.settlePaymentForCancellation(client, current, input.now, input.correlationId);
      }
      // Projected AFTER the cancellation side effects, deliberately. The
      // settlement rewrites `appointment_payments.state`, and a projection taken
      // before it reported `captured` for an appointment whose refund had already
      // been written in the same transaction — telling the patient their money was
      // still taken, and publishing that same stale value in
      // `appointment.changed.v1` to every downstream consumer.
      const updated = await this.loadAppointment(client, current.appointmentId);
      await this.appendHistory(
        client, current.appointmentId, current.status, input.nextStatus,
        input.reasonCode, actor.profileId, input,
      );
      await this.audit(client, {
        organizationId: current.organizationId,
        actorProfileId: actor.profileId,
        action: `appointment.${input.nextStatus}`,
        objectId: current.appointmentId,
        objectType: 'appointment',
        reason: input.reasonCode,
        metadata: {
          previous_status: current.status,
          next_status: updated.status,
          actor_kind: input.actorKind,
          version: updated.version,
        },
        correlationId: input.correlationId,
      });
      await this.publish(
        client, updated, current.status, input.reasonCode, input.correlationId, input.now,
      );
      // Notify the party who did NOT act: the actor already knows, and a
      // self-notification is noise that trains users to ignore the badge.
      // There is no `rejected` status: a doctor declining a request is a
      // `cancelled` with a reason code, which this same branch covers.
      // `completed` and `no_show` are doctor-recorded outcomes; the patient is
      // the non-acting party and should be told their appointment's outcome.
      if (input.nextStatus === 'cancelled') {
        await this.notifyAppointmentParty(
          client, updated, input.actorKind === 'patient' ? 'doctor' : 'patient',
          input.actorKind === 'patient' ? 'appointment.cancelled_by_patient.title'
            : 'appointment.cancelled_by_doctor.title',
          input,
        );
      } else if (input.nextStatus === 'completed') {
        await this.notifyAppointmentParty(
          client, updated, 'patient',
          'appointment.completed.title',
          input,
        );
      } else if (input.nextStatus === 'no_show') {
        await this.notifyAppointmentParty(
          client, updated, 'patient',
          'appointment.no_show.title',
          input,
        );
      }
      return updated;
    });
  }

  /**
   * Reschedules by REPLACEMENT. The original appointment's slot, time and fee are
   * never mutated: it moves to `rescheduled`, gains
   * `replaced_by_appointment_id`, and a separate appointment is booked against a
   * separate slot in the same transaction. The captured payment stays with the
   * original appointment, so the patient is not charged twice.
   */
  async reschedule(input: RescheduleAppointmentInput): Promise<RescheduleAppointmentResult> {
    try {
      return await this.database.serializableTransaction(async (client) => {
        const actor = await revalidateSchedulingActor(client, input.actor, input.now);
        if (typeof actor === 'string') return actor;

        const current = await this.lockAppointment(client, input.appointmentId);
        if (current === undefined || current.patientProfileId !== actor.profileId) {
          return 'not_found';
        }
        if (current.version !== input.expectedVersion) return 'version_conflict';
        if (current.status !== 'confirmed') {
          return 'transition_invalid';
        }
        const scope: IdempotencyScope = {
          organizationId: current.organizationId,
          actorProfileId: actor.profileId,
          operationId: 'appointment.reschedule',
          idempotencyKey: input.idempotencyKey,
        };
        const existing = await this.loadIdempotency(client, scope, input.now);
        if (existing !== undefined && !existing.expired) {
          return this.resolveIdempotency(existing, input.requestHash);
        }
        if (existing?.expired === true) await this.deleteIdempotency(client, scope);

        const slot = await this.lockSlot(client, input.slotId);
        if (
          slot === undefined ||
          slot.organizationId !== current.organizationId ||
          slot.membershipId !== current.doctorMembershipId
        ) return 'slot_not_found';
        if (slot.slotId === current.slotId) return 'transition_invalid';
        if (!slotClaimable(slot, actor.profileId, input.now)) return 'slot_unavailable';
        if (await this.doctorFee(
          client, current.doctorMembershipId, current.organizationId,
        ) === undefined) return 'slot_unavailable';
        await this.lockPatientSchedule(client, actor.profileId);
        if (await this.patientHasOverlap(
          client, actor.profileId, slot.startsAt, slot.endsAt, current.appointmentId,
        )) return 'patient_unavailable';
        if (!await this.claimIdempotency(client, scope, input)) {
          const raced = await this.loadIdempotency(client, scope, input.now);
          if (raced === undefined) throw new Error('Idempotency claim disappeared');
          return this.resolveIdempotency(raced, input.requestHash);
        }

        const replacement = await this.insertAppointment(client, {
          slotId: slot.slotId,
          patientProfileId: current.patientProfileId,
          doctorMembershipId: current.doctorMembershipId,
          organizationId: current.organizationId,
          mode: input.mode ?? current.mode,
          feeSen: current.feeSen,
          now: input.now,
        });
        await this.appendHistory(
          client, replacement.appointmentId, null, 'pending_payment', null, actor.profileId, input,
        );
        await this.occupySlot(client, slot.slotId, input.now);
        const confirmed = current.status === 'confirmed'
          ? await this.transitionToConfirmed(client, replacement, actor.profileId, input)
          : replacement;
        // The original is closed FIRST so the guard trigger sees no live
        // appointment when its slot is released.
        const replaced = await this.markReplaced(client, current, confirmed.appointmentId, input);
        await this.closeSlot(client, current.slotId, input.now);
        await this.appendHistory(
          client, current.appointmentId, current.status, 'rescheduled',
          RESCHEDULE_REASON_CODE, actor.profileId, input,
        );
        await this.audit(client, {
          organizationId: current.organizationId,
          actorProfileId: actor.profileId,
          action: 'appointment.reschedule',
          objectId: current.appointmentId,
          objectType: 'appointment',
          reason: RESCHEDULE_REASON_CODE,
          metadata: {
            replacement_appointment_id: confirmed.appointmentId,
            previous_slot_id: current.slotId,
            replacement_slot_id: slot.slotId,
            previous_status: current.status,
            version: replaced.version,
          },
          correlationId: input.correlationId,
        });
        await this.publish(
          client, replaced, current.status, RESCHEDULE_REASON_CODE,
          input.correlationId, input.now,
        );
        await this.publish(
          client, confirmed, 'pending_payment', null, input.correlationId, input.now,
        );
        // Both parties learn about the new time through the REPLACEMENT
        // appointment, so the deep link lands on the appointment that is still
        // live — the replaced one is terminal history.
        await this.notifyAppointmentParty(
          client, confirmed, 'patient', 'appointment.rescheduled.title', input,
        );
        await this.notifyAppointmentParty(
          client, confirmed, 'doctor', 'appointment.rescheduled.title', input,
        );
        const body = serializeAppointment(confirmed);
        await this.completeIdempotency(client, scope, 201, body, input.now);
        return {
          record: confirmed,
          replacedAppointmentId: current.appointmentId,
          replayed: false,
        };
      });
    } catch (error) {
      if (isSlotContention(error)) return 'slot_unavailable';
      throw error;
    }
  }

  async loadPaymentWorkItem(
    paymentId: string,
  ): Promise<AppointmentPaymentWorkItem | undefined> {
    const result = await this.database.query<PaymentRow>(
      `SELECT payment_id AS "paymentId", appointment_id AS "appointmentId",
       amount_sen AS "amountSen", currency, state
       FROM appointment_payments WHERE payment_id = $1`,
      [paymentId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const amountSen = Number(row.amountSen);
    if (!Number.isSafeInteger(amountSen)) throw new Error('Payment amount is out of safe range');
    return {
      paymentId: row.paymentId,
      appointmentId: row.appointmentId,
      amountSen,
      currency: row.currency,
      state: row.state,
    };
  }

  async settlePayment(
    input: SettleAppointmentPaymentInput,
  ): Promise<SettleAppointmentPaymentResult> {
    return this.database.transaction(async (client) => {
      const reference = await client.query<{ readonly appointmentId: string }>(
        `SELECT appointment_id AS "appointmentId"
         FROM appointment_payments WHERE payment_id = $1`,
        [input.paymentId],
      );
      const appointmentId = reference.rows[0]?.appointmentId;
      if (appointmentId === undefined) return 'not_found';
      const appointment = await this.lockAppointment(client, appointmentId);
      if (appointment === undefined) return 'not_found';
      const paymentResult = await client.query<PaymentRow>(
        `SELECT payment_id AS "paymentId", appointment_id AS "appointmentId",
         amount_sen AS "amountSen", currency, state
         FROM appointment_payments WHERE payment_id = $1 FOR UPDATE`,
        [input.paymentId],
      );
      const payment = paymentResult.rows[0];
      if (payment === undefined) return 'not_found';
      if (payment.state !== 'pending') return 'already_settled';
      if (appointment.status !== 'pending_payment') return 'conflict';

      await client.query(
        `UPDATE appointment_payments
         SET state = $2, version = version + 1, updated_at = $3
         WHERE payment_id = $1 AND state = 'pending'`,
        [payment.paymentId, input.outcome, input.now],
      );
      const nextStatus: AppointmentStatus = input.outcome === 'captured'
        ? 'confirmed'
        : 'cancelled';
      const reasonCode = input.outcome === 'captured' ? null : 'payment_expired';
      await client.query(
        `UPDATE appointments
         SET status = $2, cancellation_reason_code = $3,
             version = version + 1, updated_at = $4
         WHERE appointment_id = $1 AND status = 'pending_payment'`,
        [appointment.appointmentId, nextStatus, reasonCode, input.now],
      );
      if (nextStatus === 'cancelled') {
        await this.closeSlot(client, appointment.slotId, input.now);
      }
      // A captured payment posts to the ledger IN THE SAME TRANSACTION as the state
      // change. Posting afterwards, or from the outbox, would allow a confirmed
      // appointment whose money was never recorded — the books would then disagree with
      // the schedule, and the schedule is not the record of what was charged.
      if (input.outcome === 'captured') {
        const cash = await resolvePlatformAccount(
          client, appointment.organizationId,
          PLATFORM_ACCOUNTS.cash.code, 'asset', 'debit',
        );
        const revenue = await resolvePlatformAccount(
          client, appointment.organizationId,
          PLATFORM_ACCOUNTS.consultationRevenue.code, 'revenue', 'credit',
        );
        await postBalancedEntry(client, {
          organizationId: appointment.organizationId,
          kind: 'appointment_payment',
          referenceType: 'appointment',
          referenceId: appointment.appointmentId,
          memoCode: 'consultation_captured',
          reversesEntryId: null,
          postings: [
            { ledgerAccountId: cash, amountSen: Number(payment.amountSen) },
            { ledgerAccountId: revenue, amountSen: -Number(payment.amountSen) },
          ],
          correlationId: input.correlationId,
          occurredAt: input.now,
        });
      }
      const updated = await this.loadAppointment(client, appointment.appointmentId);
      await this.appendHistory(
        client, appointment.appointmentId, 'pending_payment', nextStatus,
        reasonCode, null, input,
      );
      await this.audit(client, {
        organizationId: appointment.organizationId,
        actorProfileId: null,
        action: input.outcome === 'captured'
          ? 'appointment.payment_captured'
          : 'appointment.payment_failed',
        objectId: appointment.appointmentId,
        objectType: 'appointment',
        reason: reasonCode,
        metadata: {
          payment_id: payment.paymentId,
          payment_state: input.outcome,
          status: updated.status,
          version: updated.version,
        },
        correlationId: input.correlationId,
      });
      await this.publish(
        client, updated, 'pending_payment', reasonCode,
        input.correlationId, input.now,
      );
      // A captured payment is the moment the appointment becomes real for the
      // patient; until now they only saw "pending payment". A failed payment
      // cancels the appointment, and the patient is told which of the two
      // happened — silence here is how a paid appointment looks lost.
      if (nextStatus === 'confirmed') {
        await this.notifyAppointmentParty(
          client, updated, 'patient', 'appointment.confirmed.title',
          { now: input.now, correlationId: input.correlationId },
        );
      }
      return 'settled';
    });
  }

  /**
   * Creates reminder notifications for confirmed appointments starting within the
   * next `windowMs`, skipping any appointment that already has a reminder row.
   * Called by the worker on an interval; idempotent by the NOT EXISTS check, so a
   * restart or a slow poll can never double-remind. Reminders go to the patient
   * only — the doctor's schedule is their own view of the same slot.
   */
  async createDueReminders(input: {
    readonly now: Date; readonly windowMs: number; readonly limit: number;
    readonly correlationId: string;
  }): Promise<number> {
    return this.database.transaction(async (client) => {
      const due = (await client.query<{ readonly appointmentId: string; readonly patientProfileId: string }>(
        `SELECT appointment.appointment_id AS "appointmentId",
                appointment.patient_profile_id AS "patientProfileId"
         FROM appointments appointment
         JOIN appointment_slots slot ON slot.slot_id = appointment.slot_id
         WHERE appointment.status = 'confirmed'
           AND slot.starts_at > $1::timestamptz
           AND slot.starts_at <= $1::timestamptz + ($2::text || ' seconds')::interval
           AND NOT EXISTS (
             SELECT 1 FROM notifications n
             WHERE n.resource_type = 'appointment'
               AND n.resource_id = appointment.appointment_id
               AND n.title_code = 'appointment.reminder.title')
         ORDER BY slot.starts_at
         LIMIT $3::int`,
        [input.now, String(Math.round(input.windowMs / 1000)), input.limit],
      )).rows;
      for (const row of due) {
        await createNotification(client, {
          profileId: row.patientProfileId,
          category: 'appointments',
          resourceType: 'appointment',
          resourceId: row.appointmentId,
          titleCode: 'appointment.reminder.title',
          bodyCode: 'appointment.reminder.body',
          priority: 'high',
          mandatoryEmail: true,
          correlationId: input.correlationId,
          now: input.now,
        });
      }
      return due.length;
    });
  }

  /**
   * Releases holds that have lapsed. Holds must expire: an abandoned checkout
   * cannot be allowed to remove capacity permanently. Booking reclaims a lapsed
   * hold on the spot, so this sweep only keeps the read model honest for bulk
   * queries and reporting.
   */
  async releaseExpiredHolds(now: Date, limit: number): Promise<number> {
    return this.database.transaction(async (client) => {
      const expired = await client.query<{ readonly slotId: string }>(
        `SELECT slot_id AS "slotId" FROM appointment_slots
         WHERE state = 'held' AND held_until <= $1
         ORDER BY slot_id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [now, limit],
      );
      const slotIds = expired.rows.map((row) => row.slotId);
      if (slotIds.length === 0) return 0;
      const released = await client.query(
        `UPDATE appointment_slots
         SET state = 'open', held_until = NULL, held_by_profile_id = NULL,
             version = version + 1, updated_at = $2
         WHERE slot_id = ANY($1::uuid[])`,
        [slotIds, now],
      );
      return released.rowCount ?? 0;
    });
  }

  /** Audits a refused appointment request. PHI-free by construction. */
  async recordDenial(
    organizationId: string | null,
    objectId: string | null,
    actorProfileId: string,
    action: string,
    code: string,
    correlationId: string,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(),
        CASE WHEN EXISTS (SELECT 1 FROM organizations WHERE organization_id = $1)
          THEN $1::uuid ELSE NULL END,
        $2, $3, 'appointment', $4, $5, $6, $7)`,
      [organizationId, actorProfileId, action, objectId, code, correlationId, {
        denial_code: code,
      }],
    );
  }

  private async lockSlot(
    client: PoolClient,
    slotId: string,
  ): Promise<SlotLockRow | undefined> {
    const result = await client.query<SlotLockRow>(
      `SELECT ${slotColumns()} FROM appointment_slots WHERE slot_id = $1 FOR UPDATE`,
      [slotId],
    );
    return result.rows[0];
  }

  /**
   * The doctor's fee in integer MYR sen, or `undefined` when the membership is not
   * bookable at all. Bookability is proved here, under lock, rather than trusted
   * from the slot: a doctor can be suspended or have verification revoked after a
   * slot was generated, and stale capacity must not become an appointment.
   */
  private async doctorFee(
    client: PoolClient,
    membershipId: string,
    organizationId: string,
  ): Promise<number | undefined> {
    // `doctor_professional_details` is the canonical table: it is the one
    // `DoctorDetailRepository` and the doctor-details API write, along with the
    // matching specialties and languages. An earlier version of this query joined
    // the orphaned `doctor_details` table instead, which nothing writes, so every
    // fee lookup found no row and no appointment could ever be priced. The
    // composite join on (membership_id, organization_id) keeps a fee from one
    // organization out of a booking in another.
    const result = await client.query<{ readonly feeSen: number }>(
      `SELECT detail.consultation_fee_sen AS "feeSen"
       FROM organization_memberships AS membership
       JOIN doctor_professional_details AS detail
         ON detail.membership_id = membership.membership_id
         AND detail.organization_id = membership.organization_id
       WHERE membership.membership_id = $1 AND membership.organization_id = $2
         AND membership.status = 'active' AND membership.role_id = 'doctor'
         AND membership.verification_status = 'approved'
         AND detail.accepts_new_patients
       FOR SHARE OF membership, detail`,
      [membershipId, organizationId],
    );
    return result.rows[0]?.feeSen;
  }

  private async lockAppointment(
    client: PoolClient,
    appointmentId: string,
  ): Promise<AppointmentRecord | undefined> {
    const result = await client.query<AppointmentRow>(
      `${appointmentProjection()}
       WHERE appointment.appointment_id = $1
       FOR UPDATE OF appointment`,
      [appointmentId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toAppointmentRecord(row);
  }

  private async loadAppointment(
    client: PoolClient,
    appointmentId: string,
  ): Promise<AppointmentRecord> {
    const result = await client.query<AppointmentRow>(
      `${appointmentProjection()} WHERE appointment.appointment_id = $1`,
      [appointmentId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Appointment could not be loaded');
    return toAppointmentRecord(row);
  }

  private async lockPatientSchedule(
    client: PoolClient,
    patientProfileId: string,
  ): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [patientProfileId],
    );
  }

  private async patientHasOverlap(
    client: PoolClient,
    patientProfileId: string,
    startsAt: Date,
    endsAt: Date,
    excludedAppointmentId: string | null,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1
       FROM appointments AS appointment
       JOIN appointment_slots AS slot ON slot.slot_id = appointment.slot_id
       WHERE appointment.patient_profile_id = $1
         AND appointment.status IN ('pending_payment','confirmed','checked_in','in_progress')
         AND ($4::uuid IS NULL OR appointment.appointment_id <> $4::uuid)
         AND tstzrange(slot.starts_at, slot.ends_at, '[)') && tstzrange($2, $3, '[)')
       LIMIT 1`,
      [patientProfileId, startsAt, endsAt, excludedAppointmentId],
    );
    return result.rowCount === 1;
  }

  private async insertAppointment(
    client: PoolClient,
    appointment: {
      readonly slotId: string;
      readonly patientProfileId: string;
      readonly doctorMembershipId: string;
      readonly organizationId: string;
      readonly mode: AppointmentMode;
      readonly feeSen: number;
      readonly now: Date;
    },
  ): Promise<AppointmentRecord> {
    const inserted = await client.query<{ readonly appointmentId: string }>(
      `INSERT INTO appointments
       (appointment_id, slot_id, patient_profile_id, doctor_membership_id,
        organization_id, mode, status, fee_sen, currency, version,
        created_at, updated_at)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, 'pending_payment', $6, 'MYR', 0, $7, $7)
       RETURNING appointment_id AS "appointmentId"`,
      [
        appointment.slotId, appointment.patientProfileId, appointment.doctorMembershipId,
        appointment.organizationId, appointment.mode, appointment.feeSen, appointment.now,
      ],
    );
    const appointmentId = inserted.rows[0]?.appointmentId;
    if (appointmentId === undefined) throw new Error('Appointment insert returned no id');
    return this.loadAppointment(client, appointmentId);
  }

  private async occupySlot(client: PoolClient, slotId: string, now: Date): Promise<void> {
    await client.query(
      `UPDATE appointment_slots
       SET state = 'booked', held_until = NULL, held_by_profile_id = NULL,
           version = version + 1, updated_at = $2
       WHERE slot_id = $1`,
      [slotId, now],
    );
  }

  /**
   * Closes a slot instead of reopening it. `appointments_slot_uq` makes a slot
   * single-use forever, so a reopened slot could be held and then fail at INSERT.
   * Regeneration from the availability rules publishes a fresh open slot for the
   * same instant, which the partial live-uniqueness index permits precisely
   * because this row is `closed`.
   */
  private async closeSlot(client: PoolClient, slotId: string, now: Date): Promise<void> {
    await client.query(
      `UPDATE appointment_slots
       SET state = 'closed', held_until = NULL, held_by_profile_id = NULL,
           version = version + 1, updated_at = $2
       WHERE slot_id = $1`,
      [slotId, now],
    );
  }

  /**
   * Creates only the local payment intent. The worker advances the deterministic
   * simulated provider after commit and settles the outcome in a second,
   * idempotent transaction; no provider call occurs while booking locks are held.
   */
  private async createPendingPayment(
    client: PoolClient,
    appointment: AppointmentRecord,
    input: { readonly idempotencyKey: string; readonly now: Date; readonly correlationId: string },
  ): Promise<AppointmentRecord> {
    const inserted = await client.query<{ readonly paymentId: string }>(
      `INSERT INTO appointment_payments
       (payment_id, appointment_id, amount_sen, currency, provider, state,
        idempotency_reference, version, created_at, updated_at)
       VALUES (uuidv7(), $1, $2, $3, 'simulated', 'pending', $4, 0, $5, $5)
       RETURNING payment_id AS "paymentId"`,
      [
        appointment.appointmentId, appointment.feeSen, appointment.currency,
        input.idempotencyKey, input.now,
      ],
    );
    const paymentId = inserted.rows[0]?.paymentId;
    if (paymentId === undefined) throw new Error('Payment intent insert returned no id');
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, 'appointment_payment', $3, 0, $4, $5, $6)`,
      [
        APPOINTMENT_PAYMENT_REQUESTED_EVENT_TYPE,
        APPOINTMENT_PAYMENT_REQUESTED_EVENT_VERSION,
        paymentId,
        { payment_id: paymentId },
        input.correlationId,
        input.now,
      ],
    );
    return this.loadAppointment(client, appointment.appointmentId);
  }

  /**
   * Notifies one party of an appointment event, inside the same transaction as the
   * transition itself. The doctor's profile id is resolved from the membership
   * because notifications address profiles, never memberships. Body codes are the
   * `.body` twin of the title code, matching the existing producer convention
   * (message.new.title/body, prescription.ready.title/body).
   */
  private async notifyAppointmentParty(
    client: PoolClient,
    appointment: AppointmentRecord,
    party: 'patient' | 'doctor',
    titleCode: string,
    input: { readonly now: Date; readonly correlationId: string },
  ): Promise<void> {
    let profileId = appointment.patientProfileId;
    if (party === 'doctor') {
      const doctor = (await client.query<{ profileId: string }>(
        `SELECT profile_id AS "profileId" FROM organization_memberships
         WHERE membership_id = $1`,
        [appointment.doctorMembershipId],
      )).rows[0];
      if (doctor === undefined) return;
      profileId = doctor.profileId;
    }
    await createNotification(client, {
      profileId,
      category: 'appointments',
      resourceType: 'appointment',
      resourceId: appointment.appointmentId,
      titleCode,
      bodyCode: titleCode.replace(/\.title$/, '.body'),
      correlationId: input.correlationId,
      now: input.now,
    });
  }

  private async transitionToConfirmed(
    client: PoolClient,
    appointment: AppointmentRecord,
    actorProfileId: string,
    input: { readonly now: Date; readonly correlationId: string },
  ): Promise<AppointmentRecord> {
    const updated = await client.query(
      `UPDATE appointments
       SET status = 'confirmed', version = version + 1, updated_at = $3
       WHERE appointment_id = $1 AND version = $2`,
      [appointment.appointmentId, appointment.version, input.now],
    );
    if (updated.rowCount !== 1) throw new Error('Concurrent appointment update was not serialized');
    await this.appendHistory(
      client, appointment.appointmentId, 'pending_payment', 'confirmed',
      null, actorProfileId, input,
    );
    return this.loadAppointment(client, appointment.appointmentId);
  }

  /**
   * Writes the new status under the optimistic version guard and returns nothing.
   * Projecting the result here would be projecting it too early: cancellation
   * settlement runs after this call and changes `payment_state`, so the caller
   * loads the appointment once every side effect has been written.
   */
  private async applyStatus(
    client: PoolClient,
    current: AppointmentRecord,
    input: UpdateAppointmentStatusInput,
  ): Promise<void> {
    const updated = await client.query(
      `UPDATE appointments
       SET status = $2, cancellation_reason_code = $3, version = version + 1,
           updated_at = $4
       WHERE appointment_id = $1 AND version = $5`,
      [
        current.appointmentId, input.nextStatus, input.reasonCode, input.now, current.version,
      ],
    );
    if (updated.rowCount !== 1) throw new Error('Concurrent appointment update was not serialized');
  }

  private async markReplaced(
    client: PoolClient,
    current: AppointmentRecord,
    replacementId: string,
    input: { readonly now: Date },
  ): Promise<AppointmentRecord> {
    const updated = await client.query(
      `UPDATE appointments
       SET status = 'rescheduled', cancellation_reason_code = $2,
           replaced_by_appointment_id = $3, version = version + 1, updated_at = $4
       WHERE appointment_id = $1 AND version = $5`,
      [
        current.appointmentId, RESCHEDULE_REASON_CODE, replacementId,
        input.now, current.version,
      ],
    );
    if (updated.rowCount !== 1) throw new Error('Concurrent appointment update was not serialized');
    return this.loadAppointment(client, current.appointmentId);
  }

  /**
   * Cancellation settlement for the simulated provider: a captured payment is
   * refunded when the appointment is cancelled before it was due to start, and a
   * still-pending intent fails. A cancellation after the start time keeps the
   * capture, because the doctor's time was already reserved.
   */
  private async settlePaymentForCancellation(
    client: PoolClient,
    current: AppointmentRecord,
    now: Date,
    correlationId: string,
  ): Promise<void> {
    const nextState = current.paymentState === 'captured' && now < current.startsAt
      ? 'refunded'
      : current.paymentState === 'pending' ? 'failed' : null;
    if (nextState === null) return;
    await client.query(
      `UPDATE appointment_payments
       SET state = $2, version = version + 1, updated_at = $3
       WHERE appointment_id = $1`,
      [current.appointmentId, nextState, now],
    );
    // A refund is a NEW opposing entry, never an edit of the capture. The original charge
    // must stay readable: "we charged and then refunded" and "we never charged" are
    // different facts, and only the first one is true here.
    if (nextState !== 'refunded') return;
    const cash = await resolvePlatformAccount(
      client, current.organizationId, PLATFORM_ACCOUNTS.cash.code, 'asset', 'debit',
    );
    const refunds = await resolvePlatformAccount(
      client, current.organizationId, PLATFORM_ACCOUNTS.refunds.code, 'expense', 'debit',
    );
    await postBalancedEntry(client, {
      organizationId: current.organizationId,
      kind: 'appointment_refund',
      referenceType: 'appointment',
      referenceId: current.appointmentId,
      memoCode: 'consultation_refunded',
      // NOT a `reversal`: a refund is its own business event with its own expense, not a
      // correction of a mistaken entry. Filing it as a reversal would also consume the
      // one-reversal-per-entry slot that a genuine correction may later need.
      reversesEntryId: null,
      postings: [
        { ledgerAccountId: refunds, amountSen: Number(current.feeSen) },
        { ledgerAccountId: cash, amountSen: -Number(current.feeSen) },
      ],
      correlationId: correlationId,
      occurredAt: now,
    });
  }

  private async appendHistory(
    client: PoolClient,
    appointmentId: string,
    previousStatus: AppointmentStatus | null,
    status: AppointmentStatus,
    reasonCode: string | null,
    actorProfileId: string | null,
    input: { readonly now: Date; readonly correlationId: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO appointment_status_history
       (history_id, appointment_id, previous_status, status, reason_code,
        actor_profile_id, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7)`,
      [
        appointmentId, previousStatus, status, reasonCode, actorProfileId,
        input.correlationId, input.now,
      ],
    );
  }

  private async audit(
    client: PoolClient,
    entry: {
      readonly organizationId: string;
      readonly actorProfileId: string | null;
      readonly action: string;
      readonly objectType: 'appointment' | 'appointment_slot';
      readonly objectId: string;
      readonly reason: string | null;
      readonly metadata: Record<string, unknown>;
      readonly correlationId: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.organizationId, entry.actorProfileId, entry.action, entry.objectType,
        entry.objectId, entry.reason, entry.correlationId, entry.metadata,
      ],
    );
  }

  /**
   * Single writer for the published appointment event. The payload is restricted
   * to the six fields `AppointmentChangedData` declares, because that schema sets
   * `additionalProperties: false` — any extra key would fail contract validation
   * and dead-letter in the worker. No time, fee or clinical detail is published;
   * richer context stays in the audit log.
   */
  private async publish(
    client: PoolClient,
    appointment: AppointmentRecord,
    previousStatus: AppointmentStatus | null,
    reasonCode: string | null,
    correlationId: string,
    occurredAt: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, 'appointment', $3, $4, $5, $6, $7)`,
      [
        APPOINTMENT_CHANGED_EVENT_TYPE,
        APPOINTMENT_CHANGED_EVENT_VERSION,
        appointment.appointmentId,
        appointment.version,
        {
          appointment_id: appointment.appointmentId,
          patient_profile_id: appointment.patientProfileId,
          doctor_membership_id: appointment.doctorMembershipId,
          previous_status: previousStatus,
          status: appointment.status,
          reason_code: reasonCode,
        },
        correlationId,
        occurredAt,
      ],
    );
  }

  private async loadIdempotency(
    client: PoolClient,
    scope: IdempotencyScope,
    now: Date,
  ): Promise<IdempotencyRow | undefined> {
    const result = await client.query<IdempotencyRow>(
      `SELECT request_hash AS "requestHash", state,
       response_status AS "responseStatus", response_body AS "responseBody",
       (expires_at <= $5) AS expired
       FROM idempotency_keys
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4
       FOR UPDATE`,
      [scope.organizationId, scope.actorProfileId, scope.operationId, scope.idempotencyKey, now],
    );
    return result.rows[0];
  }

  private async deleteIdempotency(
    client: PoolClient,
    scope: IdempotencyScope,
  ): Promise<void> {
    await client.query(
      `DELETE FROM idempotency_keys
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4`,
      [scope.organizationId, scope.actorProfileId, scope.operationId, scope.idempotencyKey],
    );
  }

  private async claimIdempotency(
    client: PoolClient,
    scope: IdempotencyScope,
    input: {
      readonly requestHash: string;
      readonly idempotencyTtlMs: number;
      readonly now: Date;
    },
  ): Promise<boolean> {
    const claimed = await client.query(
      `INSERT INTO idempotency_keys
       (organization_id, actor_profile_id, operation_id, idempotency_key,
        request_hash, state, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'processing', $6)
       ON CONFLICT (organization_id, actor_profile_id, operation_id, idempotency_key)
       DO NOTHING RETURNING idempotency_key`,
      [
        scope.organizationId, scope.actorProfileId, scope.operationId, scope.idempotencyKey,
        input.requestHash, new Date(input.now.getTime() + input.idempotencyTtlMs),
      ],
    );
    return claimed.rowCount === 1;
  }

  private async completeIdempotency(
    client: PoolClient,
    scope: IdempotencyScope,
    responseStatus: 201,
    responseBody: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE idempotency_keys
       SET state = 'completed', response_status = $5, response_body = $6,
           updated_at = $7
       WHERE organization_id = $1 AND actor_profile_id = $2
         AND operation_id = $3 AND idempotency_key = $4`,
      [
        scope.organizationId, scope.actorProfileId, scope.operationId, scope.idempotencyKey,
        responseStatus, responseBody, now,
      ],
    );
  }

  /**
   * Replays the stored response verbatim. Deliberately does not read the
   * appointment again: a replay must reproduce the original outcome even if the
   * appointment has since been cancelled, completed or rescheduled, and must never
   * book a second appointment.
   */
  private resolveIdempotency(
    existing: IdempotencyRow,
    requestHash: string,
  ): { readonly snapshot: AppointmentResponseSnapshot; readonly replayed: true } | 'idempotency_reused' {
    if (existing.requestHash !== requestHash) return 'idempotency_reused';
    if (existing.state !== 'completed') return 'idempotency_reused';
    const body = existing.responseBody;
    if (existing.responseStatus !== 201 || body === null || body['id'] === undefined) {
      return 'idempotency_reused';
    }
    return { snapshot: { status: 201, body }, replayed: true };
  }
}

/**
 * The single appointment representation. Used both for live HTTP responses and for
 * the idempotency snapshot, so a replayed response is identical by construction.
 */
export function serializeAppointment(record: AppointmentRecord): Record<string, unknown> {
  return {
    id: record.appointmentId,
    slot_id: record.slotId,
    patient_profile_id: record.patientProfileId,
    doctor_membership_id: record.doctorMembershipId,
    organization_id: record.organizationId,
    mode: record.mode,
    status: record.status,
    starts_at: record.startsAt.toISOString(),
    ends_at: record.endsAt.toISOString(),
    fee_sen: record.feeSen,
    currency: record.currency,
    payment_state: record.paymentState,
    cancellation_reason_code: record.cancellationReasonCode,
    replaced_by_appointment_id: record.replacedByAppointmentId,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

/**
 * `fee_sen` and `amount_sen` are `bigint` columns, which the driver returns as
 * strings so no value is silently rounded. Money is converted once, here, and
 * rejected if it could not survive the round trip.
 */
function toAppointmentRecord(row: AppointmentRow): AppointmentRecord {
  const feeSen = Number(row.feeSen);
  if (!Number.isSafeInteger(feeSen)) throw new Error('Appointment fee is out of safe range');
  return {
    appointmentId: row.appointmentId,
    slotId: row.slotId,
    patientProfileId: row.patientProfileId,
    doctorMembershipId: row.doctorMembershipId,
    organizationId: row.organizationId,
    mode: row.mode,
    status: row.status,
    feeSen,
    currency: row.currency,
    cancellationReasonCode: row.cancellationReasonCode,
    replacedByAppointmentId: row.replacedByAppointmentId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    paymentState: row.paymentState,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A slot may be claimed when it is in the future and either open, or held by this
 * actor, or held by a hold that has already lapsed. An expired hold is treated as
 * available on read and reclaimed under lock on write, so an abandoned checkout
 * never removes capacity permanently.
 */
function slotClaimable(row: SlotLockRow, actorProfileId: string, now: Date): boolean {
  if (row.startsAt <= now) return false;
  if (row.state === 'open') return true;
  if (row.state !== 'held') return false;
  return row.heldUntil === null || row.heldUntil <= now ||
    row.heldByProfileId === actorProfileId;
}

export function appointmentTransitionAllowed(
  current: AppointmentRecord,
  next: 'cancelled' | 'checked_in' | 'in_progress' | 'completed' | 'no_show',
  actorKind: 'patient' | 'doctor',
  now: Date,
): boolean {
  // Cancellation is time-bound because the refund rule depends on it: the
  // enum-state catalogue ties a refund to cancelling BEFORE the appointment
  // starts, so this constraint is evidenced rather than invented.
  if (next === 'cancelled') {
    return now < current.startsAt &&
      (current.status === 'pending_payment' || current.status === 'confirmed' ||
       current.status === 'checked_in');
  }
  if (actorKind === 'patient') {
    return next === 'checked_in' && current.status === 'confirmed' && now < current.endsAt;
  }
  // Non-attendance is inherently a statement about the start having passed.
  if (next === 'no_show') {
    return current.status === 'confirmed' && now >= current.startsAt;
  }
  // NO TIME WINDOW on starting or completing a consultation.
  //
  // An earlier version required `now >= starts_at` to start and to complete. That
  // constraint appears nowhere in the enum-state catalogue, which specifies only
  // `checked_in -> in_progress -> completed`, and it blocks a legitimate case: the
  // patient has checked in and the doctor is free, so the consultation begins a
  // few minutes early. Inventing scheduling policy without documentary basis made
  // a correct clinical workflow impossible, so the rule is now state and role only.
  if (next === 'in_progress') {
    return current.status === 'checked_in';
  }
  return next === 'completed' && current.status === 'in_progress';
}

function transitionAllowed(
  current: AppointmentRecord,
  next: 'cancelled' | 'checked_in' | 'in_progress' | 'completed' | 'no_show',
  actorKind: 'patient' | 'doctor',
  now: Date,
): boolean {
  return appointmentTransitionAllowed(current, next, actorKind, now);
}

function actorOwnsAppointment(
  appointment: AppointmentRecord,
  actor: SchedulingActor,
  kind: 'patient' | 'doctor',
): boolean {
  return kind === 'patient'
    ? appointment.patientProfileId === actor.profileId
    : appointment.doctorMembershipId === actor.membershipId;
}

/**
 * Recognises the three database objects that make double booking impossible. When
 * one of them rejects a racing writer the request fails closed as slot contention,
 * never as an unexplained server error.
 */
function isSlotContention(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly constraint?: unknown };
  if (candidate.code !== UNIQUE_VIOLATION && candidate.code !== EXCLUSION_VIOLATION) {
    return false;
  }
  return candidate.constraint === 'appointments_slot_uq' ||
    candidate.constraint === 'appointment_slots_live_start_uq' ||
    candidate.constraint === 'appointment_slots_no_overlapping_booking';
}

function appointmentProjection(): string {
  return `SELECT appointment.appointment_id AS "appointmentId",
   appointment.slot_id AS "slotId",
   appointment.patient_profile_id AS "patientProfileId",
   appointment.doctor_membership_id AS "doctorMembershipId",
   appointment.organization_id AS "organizationId",
   appointment.mode, appointment.status,
   appointment.fee_sen AS "feeSen", appointment.currency,
   appointment.cancellation_reason_code AS "cancellationReasonCode",
   appointment.replaced_by_appointment_id AS "replacedByAppointmentId",
   slot.starts_at AS "startsAt", slot.ends_at AS "endsAt",
   payment.state AS "paymentState",
   appointment.version, appointment.created_at AS "createdAt",
   appointment.updated_at AS "updatedAt"
   FROM appointments AS appointment
   JOIN appointment_slots AS slot ON slot.slot_id = appointment.slot_id
   LEFT JOIN appointment_payments AS payment
     ON payment.appointment_id = appointment.appointment_id`;
}

function slotColumns(): string {
  return `slot_id AS "slotId", membership_id AS "membershipId",
   organization_id AS "organizationId", starts_at AS "startsAt",
   ends_at AS "endsAt", state, held_until AS "heldUntil",
   held_by_profile_id AS "heldByProfileId", version`;
}
