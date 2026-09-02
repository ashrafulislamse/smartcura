import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  CONSULTATION_CHANGED_EVENT_TYPE,
  CONSULTATION_CHANGED_EVENT_VERSION,
} from './consultation-events.js';
import {
  revalidateClinicalActor,
  type ClinicalActorContext,
  type ClinicalActorFailure,
} from './clinical-actor.js';
import { createNotification } from './notification-repository.js';

export const CONSULTATION_STATUSES = [
  'not_started', 'ready', 'in_progress', 'completed', 'cancelled',
] as const;
export type ConsultationStatus = typeof CONSULTATION_STATUSES[number];
export const CLINICAL_NOTE_STATUSES = ['draft', 'signed', 'superseded', 'discarded'] as const;
export type ClinicalNoteStatus = typeof CLINICAL_NOTE_STATUSES[number];

export interface ConsultationRecord {
  readonly consultationId: string;
  readonly appointmentId: string;
  readonly organizationId: string;
  readonly patientProfileId: string;
  readonly doctorMembershipId: string;
  readonly status: ConsultationStatus;
  readonly outcomeCode: string | null;
  readonly version: number;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ClinicalNoteRecord {
  readonly noteId: string;
  readonly consultationId: string;
  readonly authorMembershipId: string;
  readonly organizationId: string;
  readonly versionNo: number;
  readonly status: ClinicalNoteStatus;
  readonly content: Record<string, unknown>;
  readonly replacesNoteId: string | null;
  readonly signedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ConsultationRow extends QueryResultRow, ConsultationRecord {}
interface NoteRow extends QueryResultRow, ClinicalNoteRecord {}
interface AppointmentContextRow extends QueryResultRow {
  readonly appointmentId: string;
  readonly organizationId: string;
  readonly patientProfileId: string;
  readonly doctorMembershipId: string;
  readonly doctorProfileId: string;
  readonly status: string;
}
interface AccessRow extends QueryResultRow {
  readonly patientProfileId: string;
  readonly doctorProfileId: string;
  readonly doctorMembershipId: string;
}

export type ConsultationMutationFailure =
  | ClinicalActorFailure
  | 'not_found'
  | 'not_participant'
  | 'appointment_not_eligible'
  | 'invalid_transition'
  | 'version_conflict'
  | 'note_not_mutable';

export function consultationTransitionAllowed(
  current: ConsultationStatus,
  next: ConsultationStatus,
): boolean {
  return (current === 'not_started' && ['ready', 'in_progress', 'cancelled'].includes(next)) ||
    (current === 'ready' && ['in_progress', 'cancelled'].includes(next)) ||
    (current === 'in_progress' && ['completed', 'cancelled'].includes(next));
}

export function clinicalNoteTransitionAllowed(
  current: ClinicalNoteStatus,
  next: ClinicalNoteStatus,
): boolean {
  return (current === 'draft' && (next === 'signed' || next === 'discarded')) ||
    (current === 'signed' && next === 'superseded');
}

export function serializeConsultation(record: ConsultationRecord): Record<string, unknown> {
  return {
    consultation_id: record.consultationId,
    appointment_id: record.appointmentId,
    organization_id: record.organizationId,
    patient_profile_id: record.patientProfileId,
    doctor_membership_id: record.doctorMembershipId,
    status: record.status,
    outcome_code: record.outcomeCode,
    version: record.version,
    started_at: record.startedAt?.toISOString() ?? null,
    completed_at: record.completedAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export function serializeClinicalNote(record: ClinicalNoteRecord): Record<string, unknown> {
  return {
    note_id: record.noteId,
    consultation_id: record.consultationId,
    author_membership_id: record.authorMembershipId,
    version_no: record.versionNo,
    status: record.status,
    content: record.content,
    replaces_note_id: record.replacesNoteId,
    signed_at: record.signedAt?.toISOString() ?? null,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

const consultationProjection = `consultation_id AS "consultationId", appointment_id AS "appointmentId",
  organization_id AS "organizationId", patient_profile_id AS "patientProfileId",
  doctor_membership_id AS "doctorMembershipId", status, outcome_code AS "outcomeCode",
  version, started_at AS "startedAt", completed_at AS "completedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const noteProjection = `note.note_id AS "noteId", note.consultation_id AS "consultationId",
  note.author_membership_id AS "authorMembershipId", note.organization_id AS "organizationId",
  note.version_no AS "versionNo", note.status, note.content, note.replaces_note_id AS "replacesNoteId",
  note.signed_at AS "signedAt", note.version, note.created_at AS "createdAt", note.updated_at AS "updatedAt"`;

export class ConsultationRepository {
  constructor(private readonly database: PostgresConnection) {}

  async createForAppointment(input: {
    appointmentId: string; actor: ClinicalActorContext; now: Date; correlationId: string;
  }): Promise<ConsultationRecord | ConsultationMutationFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const appointment = (await client.query<AppointmentContextRow>(
        `SELECT appointment.appointment_id AS "appointmentId",
           appointment.organization_id AS "organizationId",
           appointment.patient_profile_id AS "patientProfileId",
           appointment.doctor_membership_id AS "doctorMembershipId",
           doctor.profile_id AS "doctorProfileId", appointment.status
         FROM appointments appointment
         JOIN organization_memberships doctor
           ON doctor.membership_id = appointment.doctor_membership_id
         WHERE appointment.appointment_id = $1 FOR UPDATE OF appointment`,
        [input.appointmentId],
      )).rows[0];
      if (appointment === undefined) return 'not_found';
      if (input.actor.roleId !== 'doctor' || input.actor.membershipId !== appointment.doctorMembershipId) {
        return 'not_participant';
      }
      if (!['confirmed', 'checked_in', 'in_progress'].includes(appointment.status)) {
        return 'appointment_not_eligible';
      }
      const existing = await client.query<ConsultationRow>(
        `SELECT ${consultationProjection} FROM consultations WHERE appointment_id = $1`,
        [input.appointmentId],
      );
      if (existing.rows[0] !== undefined) return existing.rows[0];
      const created = (await client.query<ConsultationRow>(
        `INSERT INTO consultations
         (appointment_id, organization_id, patient_profile_id, doctor_membership_id)
         VALUES ($1,$2,$3,$4) RETURNING ${consultationProjection}`,
        [input.appointmentId, appointment.organizationId, appointment.patientProfileId,
          appointment.doctorMembershipId],
      )).rows[0]!;
      const conversation = await client.query<{ conversationId: string }>(
        `INSERT INTO conversations (consultation_id, organization_id)
         VALUES ($1,$2) RETURNING conversation_id AS "conversationId"`,
        [created.consultationId, created.organizationId],
      );
      const conversationId = conversation.rows[0]!.conversationId;
      await client.query(
        `INSERT INTO conversation_participants
         (conversation_id, profile_id, membership_id, participant_kind)
         VALUES ($1,$2,NULL,'patient'), ($1,$3,$4,'doctor')
         ON CONFLICT (conversation_id, profile_id) DO NOTHING`,
        [conversationId, created.patientProfileId, appointment.doctorProfileId, created.doctorMembershipId],
      );
      await client.query(
        `INSERT INTO consultation_status_history
         (consultation_id, previous_status, status, actor_profile_id, correlation_id, occurred_at)
         VALUES ($1,NULL,'not_started',$2,$3,$4)`,
        [created.consultationId, input.actor.profileId, input.correlationId, input.now],
      );
      await this.record(client, created, null, input.actor.profileId, input.correlationId, input.now);
      return created;
    });
  }

  async transition(input: {
    consultationId: string; nextStatus: ConsultationStatus; outcomeCode: string | null;
    expectedVersion: number; actor: ClinicalActorContext; now: Date; correlationId: string;
  }): Promise<ConsultationRecord | ConsultationMutationFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const current = await this.load(client, input.consultationId, true);
      if (current === undefined) return 'not_found';
      if (!await this.participant(client, current, input.actor)) return 'not_participant';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (!consultationTransitionAllowed(current.status, input.nextStatus)) return 'invalid_transition';
      if (input.actor.roleId !== 'doctor' && input.nextStatus !== 'ready') return 'not_participant';
      // The timestamps are derived HERE rather than in a SQL `CASE` on the status
      // parameter. Reusing one parameter as both an enum value and a literal
      // comparison made PostgreSQL unable to infer its type
      // (`42P08 ambiguous parameter type`), which surfaced only against a real
      // server. Deciding in TypeScript is also directly unit-testable.
      const startedAt = input.nextStatus === 'in_progress'
        ? current.startedAt ?? input.now
        : current.startedAt;
      const completedAt = input.nextStatus === 'completed' ? input.now : current.completedAt;
      const changed = (await client.query<ConsultationRow>(
        `UPDATE consultations SET status = $2, outcome_code = $3,
           started_at = $5, completed_at = $6,
           version = version + 1, updated_at = $4
         WHERE consultation_id = $1 RETURNING ${consultationProjection}`,
        [input.consultationId, input.nextStatus, input.outcomeCode, input.now,
          startedAt, completedAt],
      )).rows[0]!;
      await client.query(
        `INSERT INTO consultation_status_history
         (consultation_id, previous_status, status, reason_code, actor_profile_id, correlation_id, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.consultationId, current.status, input.nextStatus, input.outcomeCode,
          input.actor.profileId, input.correlationId, input.now],
      );
      await this.record(client, changed, current.status, input.actor.profileId, input.correlationId, input.now);
      // Notify the party who did NOT initiate the transition. The actor already
      // knows; a self-notification is noise that trains users to ignore the badge.
      // `ready` can be set by either party (patient joining or doctor starting);
      // `completed` is doctor-only; `cancelled` can be either party. In every case
      // the non-acting party is the one who needs to be told.
      if (input.nextStatus === 'ready' || input.nextStatus === 'completed' || input.nextStatus === 'cancelled') {
        const recipient: 'patient' | 'doctor' = input.actor.roleId === 'doctor' ? 'patient' : 'doctor';
        const titleCode = input.nextStatus === 'ready'
          ? 'consultation.ready.title'
          : input.nextStatus === 'completed'
            ? 'consultation.completed.title'
            : 'consultation.cancelled.title';
        await this.notifyConsultationParty(client, changed, recipient, titleCode, input);
      }
      return changed;
    });
  }

  async findAuthorized(
    consultationId: string,
    profileId: string,
    membershipId: string,
  ): Promise<ConsultationRecord | undefined> {
    const result = await this.database.query<ConsultationRow>(
      `SELECT ${consultationProjection} FROM consultations consultation
       WHERE consultation.consultation_id = $1 AND (
         consultation.patient_profile_id = $2 OR consultation.doctor_membership_id = $3
       )`,
      [consultationId, profileId, membershipId],
    );
    return result.rows[0];
  }

  async roomAccess(consultationId: string, profileId: string): Promise<{
    consultationId: string; roomName: string; participantIdentity: string; status: ConsultationStatus;
  } | undefined> {
    const result = await this.database.query<{ consultationId: string; status: ConsultationStatus }>(
      `SELECT consultation.consultation_id AS "consultationId", consultation.status
       FROM consultations consultation
       JOIN appointments appointment ON appointment.appointment_id = consultation.appointment_id
       JOIN conversations conversation ON conversation.consultation_id = consultation.consultation_id
       JOIN conversation_participants participant
         ON participant.conversation_id = conversation.conversation_id
       WHERE consultation.consultation_id = $1 AND participant.profile_id = $2
         AND appointment.mode IN ('video','audio')
         AND consultation.status IN ('not_started','ready','in_progress')`,
      [consultationId, profileId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : {
      consultationId: row.consultationId,
      roomName: `consultation-${row.consultationId}`,
      participantIdentity: profileId,
      status: row.status,
    };
  }

  async listDoctorNotes(input: {
    membershipId: string; afterCreatedAt?: Date; afterId?: string; limit: number;
  }): Promise<ClinicalNoteRecord[]> {
    return (await this.database.query<NoteRow>(
      `SELECT ${noteProjection} FROM clinical_notes note
       JOIN consultations consultation ON consultation.consultation_id = note.consultation_id
       WHERE consultation.doctor_membership_id = $1
         AND ($2::timestamptz IS NULL OR (note.created_at,note.note_id) < ($2,$3))
       ORDER BY note.created_at DESC, note.note_id DESC LIMIT $4`,
      [input.membershipId, input.afterCreatedAt ?? null, input.afterId ?? null, input.limit],
    )).rows;
  }

  /**
   * The authenticated patient's own past consultations, newest first.
   *
   * The `own`-scope analogue the patient mobile app needs: a patient sees only the
   * consultations where they are the patient. `patientProfileId` comes from the
   * session and never from the query. Ordered by `updated_at` descending so a
   * consultation that just completed or was cancelled surfaces first, rather than
   * by creation recency which would bury a recently-resolved one under older
   * open ones — the same relevance-over-recency rule the appointment list follows.
   * Cursor-paginated deterministically on `(updated_at, consultation_id)`.
   */
  async listOwnConsultations(input: {
    patientProfileId: string; afterUpdatedAt?: Date; afterId?: string; limit: number;
  }): Promise<ConsultationRecord[]> {
    return (await this.database.query<ConsultationRow>(
      `SELECT ${consultationProjection} FROM consultations consultation
       WHERE consultation.patient_profile_id = $1
         AND ($2::timestamptz IS NULL OR
           (consultation.updated_at, consultation.consultation_id) < ($2,$3))
       ORDER BY consultation.updated_at DESC, consultation.consultation_id DESC
       LIMIT $4`,
      [input.patientProfileId, input.afterUpdatedAt ?? null, input.afterId ?? null, input.limit],
    )).rows;
  }

  /**
   * Reads one clinical note by id, scoped exactly as `listNotes` scopes its rows:
   * the caller must be the consultation's patient (by profile id) or its doctor
   * (by membership id). The scope predicate is pushed into the SQL via the join
   * to `consultations`, so the query cannot return a note the caller may not
   * see, and an out-of-scope or absent note reads as `undefined` — which the
   * service maps to 404 so absence and denial stay indistinguishable.
   */
  async findAuthorizedNote(
    noteId: string,
    profileId: string,
    membershipId: string,
  ): Promise<ClinicalNoteRecord | undefined> {
    const result = await this.database.query<NoteRow>(
      `SELECT ${noteProjection} FROM clinical_notes note
       JOIN consultations consultation ON consultation.consultation_id = note.consultation_id
       WHERE note.note_id = $1 AND (
         consultation.patient_profile_id = $2 OR consultation.doctor_membership_id = $3
       )`,
      [noteId, profileId, membershipId],
    );
    return result.rows[0];
  }

  async listNotes(consultationId: string, profileId: string, membershipId: string): Promise<ClinicalNoteRecord[]> {
    return (await this.database.query<NoteRow>(
      `SELECT ${noteProjection} FROM clinical_notes note
       JOIN consultations consultation ON consultation.consultation_id = note.consultation_id
       WHERE note.consultation_id = $1 AND
         (consultation.patient_profile_id = $2 OR consultation.doctor_membership_id = $3)
       ORDER BY note.version_no ASC, note.note_id ASC`,
      [consultationId, profileId, membershipId],
    )).rows;
  }

  async createNote(input: {
    consultationId: string; content: Record<string, unknown>; actor: ClinicalActorContext;
    now: Date; correlationId: string;
  }): Promise<ClinicalNoteRecord | ConsultationMutationFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const consultation = await this.load(client, input.consultationId, true);
      if (consultation === undefined) return 'not_found';
      if (input.actor.roleId !== 'doctor' || input.actor.membershipId !== consultation.doctorMembershipId) {
        return 'not_participant';
      }
      if (!['ready', 'in_progress', 'completed'].includes(consultation.status)) return 'invalid_transition';
      const note = (await client.query<NoteRow>(
        `INSERT INTO clinical_notes
         (consultation_id, author_membership_id, organization_id, version_no, content)
         SELECT $1,$2,$3,COALESCE(MAX(version_no),0)+1,$4::jsonb
         FROM clinical_notes WHERE consultation_id = $1
         RETURNING ${noteProjection}`,
        [input.consultationId, input.actor.membershipId, consultation.organizationId,
          JSON.stringify(input.content)],
      )).rows[0]!;
      await this.audit(client, consultation.organizationId, input.actor.profileId, 'clinical_note.created',
        'clinical_note', note.noteId, input.correlationId, input.now);
      return note;
    });
  }

  async updateNote(input: {
    noteId: string; content: Record<string, unknown>; expectedVersion: number;
    actor: ClinicalActorContext; now: Date; correlationId: string;
  }): Promise<ClinicalNoteRecord | ConsultationMutationFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const note = await this.loadNote(client, input.noteId, true);
      if (note === undefined) return 'not_found';
      if (note.authorMembershipId !== input.actor.membershipId) return 'not_participant';
      if (note.version !== input.expectedVersion) return 'version_conflict';
      if (note.status !== 'draft') return 'note_not_mutable';
      const changed = (await client.query<NoteRow>(
        `UPDATE clinical_notes SET content = $2::jsonb, version = version + 1, updated_at = $3
         WHERE note_id = $1 RETURNING ${noteProjection}`,
        [input.noteId, JSON.stringify(input.content), input.now],
      )).rows[0]!;
      await this.audit(client, note.organizationId, input.actor.profileId, 'clinical_note.updated',
        'clinical_note', note.noteId, input.correlationId, input.now);
      return changed;
    });
  }

  async transitionNote(input: {
    noteId: string; nextStatus: Extract<ClinicalNoteStatus, 'signed' | 'discarded'>;
    expectedVersion: number; actor: ClinicalActorContext; now: Date; correlationId: string;
  }): Promise<ClinicalNoteRecord | ConsultationMutationFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const note = await this.loadNote(client, input.noteId, true);
      if (note === undefined) return 'not_found';
      if (note.authorMembershipId !== input.actor.membershipId) return 'not_participant';
      if (note.version !== input.expectedVersion) return 'version_conflict';
      if (!clinicalNoteTransitionAllowed(note.status, input.nextStatus)) return 'invalid_transition';
      // Derived in TypeScript; see the `42P08` note on consultation transitions.
      const signedAt = input.nextStatus === 'signed' ? input.now : note.signedAt;
      const changed = (await client.query<NoteRow>(
        `UPDATE clinical_notes SET status = $2, signed_at = $4,
           version = version + 1, updated_at = $3
         WHERE note_id = $1 RETURNING ${noteProjection}`,
        [input.noteId, input.nextStatus, input.now, signedAt],
      )).rows[0]!;
      await this.audit(client, note.organizationId, input.actor.profileId,
        `clinical_note.${input.nextStatus}`, 'clinical_note', note.noteId,
        input.correlationId, input.now);
      return changed;
    });
  }

  async amendSignedNote(input: {
    noteId: string; content: Record<string, unknown>; expectedVersion: number;
    actor: ClinicalActorContext; now: Date; correlationId: string;
  }): Promise<ClinicalNoteRecord | ConsultationMutationFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const prior = await this.loadNote(client, input.noteId, true);
      if (prior === undefined) return 'not_found';
      if (prior.authorMembershipId !== input.actor.membershipId) return 'not_participant';
      if (prior.version !== input.expectedVersion) return 'version_conflict';
      if (prior.status !== 'signed') return 'invalid_transition';
      const replacement = (await client.query<NoteRow>(
        `INSERT INTO clinical_notes
         (consultation_id, author_membership_id, organization_id, version_no, status,
          content, replaces_note_id, signed_at)
         VALUES ($1,$2,$3,$4,'signed',$5::jsonb,$6,$7)
         RETURNING ${noteProjection}`,
        [prior.consultationId, input.actor.membershipId, prior.organizationId, prior.versionNo + 1,
          JSON.stringify(input.content), prior.noteId, input.now],
      )).rows[0]!;
      await client.query(
        `UPDATE clinical_notes SET status = 'superseded', version = version + 1, updated_at = $2
         WHERE note_id = $1`,
        [prior.noteId, input.now],
      );
      await this.audit(client, prior.organizationId, input.actor.profileId, 'clinical_note.superseded',
        'clinical_note', prior.noteId, input.correlationId, input.now);
      return replacement;
    });
  }

  /**
   * Notifies one party to a consultation, mirroring the appointment repository's
   * `notifyAppointmentParty`. The patient's profile id is on the consultation
   * record; the doctor's is resolved from their membership id because
   * notifications address profiles, never memberships.
   */
  private async notifyConsultationParty(
    client: PoolClient,
    consultation: ConsultationRecord,
    party: 'patient' | 'doctor',
    titleCode: string,
    input: { readonly now: Date; readonly correlationId: string },
  ): Promise<void> {
    let profileId = consultation.patientProfileId;
    if (party === 'doctor') {
      const doctor = (await client.query<{ profileId: string }>(
        `SELECT profile_id AS "profileId" FROM organization_memberships
         WHERE membership_id = $1`,
        [consultation.doctorMembershipId],
      )).rows[0];
      if (doctor === undefined) return;
      profileId = doctor.profileId;
    }
    await createNotification(client, {
      profileId,
      category: 'consultations',
      resourceType: 'consultation',
      resourceId: consultation.consultationId,
      titleCode,
      bodyCode: titleCode.replace(/\.title$/, '.body'),
      correlationId: input.correlationId,
      now: input.now,
    });
  }

  private async participant(client: PoolClient, consultation: ConsultationRecord, actor: ClinicalActorContext) {
    if (actor.roleId === 'patient') return actor.profileId === consultation.patientProfileId;
    return actor.membershipId === consultation.doctorMembershipId;
  }

  private async load(client: PoolClient, id: string, lock: boolean): Promise<ConsultationRecord | undefined> {
    return (await client.query<ConsultationRow>(
      `SELECT ${consultationProjection} FROM consultations WHERE consultation_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )).rows[0];
  }

  private async loadNote(client: PoolClient, id: string, lock: boolean): Promise<ClinicalNoteRecord | undefined> {
    return (await client.query<NoteRow>(
      `SELECT ${noteProjection} FROM clinical_notes WHERE note_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )).rows[0];
  }

  private async record(
    client: PoolClient, record: ConsultationRecord, previous: ConsultationStatus | null,
    actorProfileId: string, correlationId: string, now: Date,
  ): Promise<void> {
    await this.audit(client, record.organizationId, actorProfileId, 'consultation.changed',
      'consultation', record.consultationId, correlationId, now);
    await client.query(
      `INSERT INTO outbox_events
       (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
        payload,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,'consultation',$3,$4,$5::jsonb,$6,$7)`,
      [CONSULTATION_CHANGED_EVENT_TYPE, CONSULTATION_CHANGED_EVENT_VERSION,
        record.consultationId, record.version,
        JSON.stringify({
          consultation_id: record.consultationId,
          appointment_id: record.appointmentId,
          previous_status: previous,
          status: record.status,
        }), correlationId, now],
    );
  }

  private async audit(
    client: PoolClient, organizationId: string, actorProfileId: string,
    action: string, objectType: string, objectId: string, correlationId: string, now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id,organization_id,actor_profile_id,action,object_type,object_id,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,$3,$4,$5,$6,$7)`,
      [organizationId, actorProfileId, action, objectType, objectId, correlationId, now],
    );
  }
}
