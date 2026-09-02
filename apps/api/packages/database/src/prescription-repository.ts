import { createHash } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  PHARMACY_PRESCRIPTION_INTAKE_EVENT_TYPE,
  PHARMACY_PRESCRIPTION_INTAKE_EVENT_VERSION,
  PRESCRIPTION_CHANGED_EVENT_TYPE,
  PRESCRIPTION_CHANGED_EVENT_VERSION,
  PRESCRIPTION_PDF_REQUESTED_EVENT_TYPE,
  PRESCRIPTION_PDF_REQUESTED_EVENT_VERSION,
} from './consultation-events.js';
import {
  revalidateClinicalActor,
  type ClinicalActorContext,
  type ClinicalActorFailure,
} from './clinical-actor.js';
import { createNotification } from './notification-repository.js';
import {
  claimIdempotency,
  completeIdempotency,
  deleteIdempotency,
  loadIdempotency,
  type IdempotencyScope,
} from './idempotency.js';

export const PRESCRIPTION_STATUSES = [
  'draft', 'signed', 'superseded', 'cancelled', 'expired', 'discarded',
] as const;
export type PrescriptionStatus = typeof PRESCRIPTION_STATUSES[number];
export interface PrescriptionItemInput {
  readonly medicationReference: string | null;
  readonly medicationText: string | null;
  readonly doseValue: string;
  readonly doseUnit: string;
  readonly routeCode: string;
  readonly frequencyCode: string | null;
  readonly frequencyText: string | null;
  readonly durationDays: number;
  readonly patientInstructions: string | null;
}
export interface PrescriptionItemRecord extends PrescriptionItemInput {
  readonly prescriptionItemId: string;
  readonly position: number;
}
export interface PrescriptionRecord {
  readonly prescriptionId: string;
  readonly consultationId: string;
  readonly patientProfileId: string;
  readonly doctorMembershipId: string;
  readonly organizationId: string;
  readonly status: PrescriptionStatus;
  readonly replacesPrescriptionId: string | null;
  readonly diagnosis: string | null;
  readonly cancellationReasonCode: string | null;
  readonly signedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly PrescriptionItemRecord[];
  readonly documentStatus: 'pending' | 'ready' | 'failed' | null;
  readonly documentObjectId: string | null;
  readonly documentBytes: Buffer | null;
  readonly documentMediaType: string | null;
}
interface PrescriptionRow extends QueryResultRow, Omit<PrescriptionRecord, 'items'> {}
interface ItemRow extends QueryResultRow, PrescriptionItemRecord {}
interface ConsultationContext extends QueryResultRow {
  readonly consultationId: string; readonly organizationId: string;
  readonly patientProfileId: string; readonly doctorMembershipId: string;
  readonly status: string;
}
export interface PrescriptionPdfWork {
  readonly prescriptionId: string; readonly status: PrescriptionStatus;
  readonly patientProfileId: string; readonly doctorMembershipId: string;
  readonly signedAt: Date; readonly expiresAt: Date | null;
  readonly diagnosis: string | null;
  readonly items: readonly PrescriptionItemRecord[];
}
export type PrescriptionFailure = ClinicalActorFailure | 'not_found' | 'not_issuer' |
  'invalid_transition' | 'version_conflict' | 'not_mutable' | 'empty_items' |
  'idempotency_reused' | 'idempotency_in_progress';
export interface PrescriptionIdempotency {
  readonly key: string;
  readonly requestHash: string;
  readonly operationId: string;
  readonly ttlMs: number;
}
export interface PrescriptionReplay {
  readonly replayed: true;
  readonly body: Record<string, unknown>;
}
export type PrescriptionCommandResult = PrescriptionRecord | PrescriptionReplay | PrescriptionFailure;

export function prescriptionTransitionAllowed(current: PrescriptionStatus, next: PrescriptionStatus): boolean {
  return (current === 'draft' && ['signed', 'discarded'].includes(next)) ||
    (current === 'signed' && ['superseded', 'cancelled', 'expired'].includes(next));
}

const projection = `prescription_id AS "prescriptionId", consultation_id AS "consultationId",
  patient_profile_id AS "patientProfileId", doctor_membership_id AS "doctorMembershipId",
  organization_id AS "organizationId", status,
  replaces_prescription_id AS "replacesPrescriptionId",
  diagnosis,
  cancellation_reason_code AS "cancellationReasonCode", signed_at AS "signedAt",
  expires_at AS "expiresAt", document_object_id AS "documentObjectId", version,
  created_at AS "createdAt", updated_at AS "updatedAt",
  document_bytes AS "documentBytes", document_media_type AS "documentMediaType",
  (SELECT document.status FROM prescription_documents document
    WHERE document.prescription_id = prescriptions.prescription_id) AS "documentStatus"`;
const itemProjection = `prescription_item_id AS "prescriptionItemId", position,
  medication_reference AS "medicationReference", medication_text AS "medicationText",
  dose_value::text AS "doseValue", dose_unit AS "doseUnit", route_code AS "routeCode",
  frequency_code AS "frequencyCode", frequency_text AS "frequencyText",
  duration_days AS "durationDays", patient_instructions AS "patientInstructions"`;

export function serializePrescription(record: PrescriptionRecord): Record<string, unknown> {
  return {
    prescription_id: record.prescriptionId,
    consultation_id: record.consultationId,
    patient_profile_id: record.patientProfileId,
    doctor_membership_id: record.doctorMembershipId,
    status: record.status,
    replaces_prescription_id: record.replacesPrescriptionId,
    diagnosis: record.diagnosis,
    cancellation_reason_code: record.cancellationReasonCode,
    signed_at: record.signedAt?.toISOString() ?? null,
    expires_at: record.expiresAt?.toISOString() ?? null,
    version: record.version,
    document_status: record.documentStatus,
    items: record.items.map((item) => ({
      prescription_item_id: item.prescriptionItemId, position: item.position,
      medication_reference: item.medicationReference, medication_text: item.medicationText,
      dose_value: item.doseValue, dose_unit: item.doseUnit, route_code: item.routeCode,
      frequency_code: item.frequencyCode, frequency_text: item.frequencyText,
      duration_days: item.durationDays, patient_instructions: item.patientInstructions,
    })),
    created_at: record.createdAt.toISOString(), updated_at: record.updatedAt.toISOString(),
  };
}

export class PrescriptionRepository {
  constructor(private readonly database: PostgresConnection) {}

  async listIssued(input: {
    membershipId: string; afterCreatedAt?: Date; afterId?: string; limit: number;
  }): Promise<PrescriptionRecord[]> {
    const rows = (await this.database.query<PrescriptionRow>(
      `SELECT ${projection} FROM prescriptions
       WHERE doctor_membership_id = $1
         AND ($2::timestamptz IS NULL OR (created_at,prescription_id) < ($2,$3))
       ORDER BY created_at DESC, prescription_id DESC LIMIT $4`,
      [input.membershipId, input.afterCreatedAt ?? null, input.afterId ?? null, input.limit],
    )).rows;
    return Promise.all(rows.map((row) => this.withItems(this.database, row)));
  }

  /**
   * The authenticated patient's own signed-or-active prescriptions, newest first.
   *
   * The `own`-scope analogue of `listIssued`: a patient sees the prescriptions
   * written for them, not the ones a doctor issued. `patientProfileId` is taken
   * from the session by the service and never from the query, and a draft is
   * excluded because a draft is the doctor's working copy the patient has not yet
   * been handed — `signed` is the act that publishes a prescription to the
   * patient, so anything still `draft` or `discarded` is not theirs to read.
   * `superseded`, `cancelled` and `expired` are included because a patient's
   * medication history is incomplete without the prescriptions that were replaced
   * or withdrawn, exactly as the read-one path returns them.
   */
  async listOwn(input: {
    patientProfileId: string; afterCreatedAt?: Date; afterId?: string; limit: number;
  }): Promise<PrescriptionRecord[]> {
    const rows = (await this.database.query<PrescriptionRow>(
      `SELECT ${projection} FROM prescriptions
       WHERE patient_profile_id = $1
         AND status <> 'draft' AND status <> 'discarded'
         AND ($2::timestamptz IS NULL OR (created_at,prescription_id) < ($2,$3))
       ORDER BY created_at DESC, prescription_id DESC LIMIT $4`,
      [input.patientProfileId, input.afterCreatedAt ?? null, input.afterId ?? null, input.limit],
    )).rows;
    return Promise.all(rows.map((row) => this.withItems(this.database, row)));
  }

  async findAuthorized(id: string, profileId: string, membershipId: string): Promise<PrescriptionRecord | undefined> {
    const row = (await this.database.query<PrescriptionRow>(
      `SELECT ${projection} FROM prescriptions
       WHERE prescription_id = $1 AND (patient_profile_id = $2 OR doctor_membership_id = $3)`,
      [id, profileId, membershipId],
    )).rows[0];
    return row === undefined ? undefined : this.withItems(this.database, row);
  }

  async findById(id: string): Promise<PrescriptionRecord | undefined> {
    const row = await this.load(this.database, id, false);
    return row === undefined ? undefined : this.withItems(this.database, row);
  }

  /**
   * Prescriptions belonging to a single consultation, ordered newest first.
   *
   * A patient participant only sees prescriptions that have been published to
   * them (i.e. not `draft` or `discarded`), while a doctor participant sees the
   * full working set including drafts they are still editing. Access is gated
   * by the caller having already proven they can read the consultation.
   */
  async listForConsultation(input: {
    consultationId: string; profileId: string; membershipId: string; excludeDrafts?: boolean;
  }): Promise<PrescriptionRecord[]> {
    const rows = (await this.database.query<PrescriptionRow>(
      `SELECT ${projection} FROM prescriptions
       WHERE consultation_id = $1
         AND (patient_profile_id = $2 OR doctor_membership_id = $3)
         AND ($4::boolean IS FALSE OR (status <> 'draft' AND status <> 'discarded'))
       ORDER BY created_at DESC, prescription_id DESC`,
      [input.consultationId, input.profileId, input.membershipId, input.excludeDrafts ?? false],
    )).rows;
    return Promise.all(rows.map((row) => this.withItems(this.database, row)));
  }

  async createDraft(input: {
    consultationId: string; items: readonly PrescriptionItemInput[];
    diagnosis: string | null;
    actor: ClinicalActorContext; now: Date; correlationId: string;
    idempotency: PrescriptionIdempotency;
  }): Promise<PrescriptionCommandResult> {
    if (input.items.length === 0) return 'empty_items';
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const context = await this.consultation(client, input.consultationId, true);
      if (context === undefined) return 'not_found';
      if (input.actor.roleId !== 'doctor' || context.doctorMembershipId !== input.actor.membershipId) return 'not_issuer';
      if (!['in_progress', 'completed'].includes(context.status)) return 'invalid_transition';
      const idempotency = await this.beginIdempotency(
        client, context.organizationId, input.actor.profileId, input.idempotency, input.now,
      );
      if (idempotency !== 'claimed') return idempotency;
      const row = (await client.query<PrescriptionRow>(
        `INSERT INTO prescriptions
         (consultation_id,patient_profile_id,doctor_membership_id,organization_id,
          diagnosis)
         VALUES ($1,$2,$3,$4,$5) RETURNING ${projection}`,
        [context.consultationId, context.patientProfileId, context.doctorMembershipId, context.organizationId, input.diagnosis],
      )).rows[0]!;
      await this.replaceItems(client, row.prescriptionId, input.items);
      await this.history(client, row, null, input.actor.profileId, input.correlationId, input.now);
      await this.audit(client, row, input.actor.profileId, 'prescription.created', input.correlationId, input.now);
      const full = await this.withItems(client, row);
      await this.finishIdempotency(client, context.organizationId, input.actor.profileId,
        input.idempotency, full, input.now);
      return full;
    });
  }

  async updateDraft(input: {
    prescriptionId: string; items: readonly PrescriptionItemInput[]; expectedVersion: number;
    diagnosis: string | null;
    actor: ClinicalActorContext; now: Date; correlationId: string;
  }): Promise<PrescriptionRecord | PrescriptionFailure> {
    if (input.items.length === 0) return 'empty_items';
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const current = await this.load(client, input.prescriptionId, true);
      if (current === undefined) return 'not_found';
      if (current.doctorMembershipId !== input.actor.membershipId) return 'not_issuer';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (current.status !== 'draft') return 'not_mutable';
      await this.replaceItems(client, current.prescriptionId, input.items);
      const changed = (await client.query<PrescriptionRow>(
        `UPDATE prescriptions SET diagnosis = $3, version = version + 1, updated_at = $2
         WHERE prescription_id = $1 RETURNING ${projection}`,
        [current.prescriptionId, input.now, input.diagnosis],
      )).rows[0]!;
      await this.audit(client, changed, input.actor.profileId, 'prescription.updated', input.correlationId, input.now);
      return this.withItems(client, changed);
    });
  }

  async transitionDraft(input: {
    prescriptionId: string; nextStatus: 'signed' | 'discarded'; expectedVersion: number;
    expiresAt: Date | null; actor: ClinicalActorContext; now: Date; correlationId: string;
    idempotency: PrescriptionIdempotency;
  }): Promise<PrescriptionCommandResult> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const current = await this.load(client, input.prescriptionId, true);
      if (current === undefined) return 'not_found';
      if (current.doctorMembershipId !== input.actor.membershipId) return 'not_issuer';
      const idempotency = await this.beginIdempotency(
        client, current.organizationId, input.actor.profileId, input.idempotency, input.now,
      );
      if (idempotency !== 'claimed') return idempotency;
      if (current.version !== input.expectedVersion) {
        await this.abandonIdempotency(client, current.organizationId, input.actor.profileId, input.idempotency);
        return 'version_conflict';
      }
      if (!prescriptionTransitionAllowed(current.status, input.nextStatus)) {
        await this.abandonIdempotency(client, current.organizationId, input.actor.profileId, input.idempotency);
        return 'invalid_transition';
      }
      // Derived in TypeScript; see the `42P08` note on consultation transitions.
      // Parameters must also stay CONTIGUOUS: skipping one makes PostgreSQL unable
      // to determine its type, which is a second way to fail the same statement.
      const signing = input.nextStatus === 'signed';
      const changed = (await client.query<PrescriptionRow>(
        `UPDATE prescriptions SET status = $2, signed_at = $4, expires_at = $5,
           version = version + 1, updated_at = $3
         WHERE prescription_id = $1 RETURNING ${projection}`,
        [current.prescriptionId, input.nextStatus, input.now,
          signing ? input.now : null, signing ? input.expiresAt : null],
      )).rows[0]!;
      await this.history(client, changed, current.status, input.actor.profileId, input.correlationId, input.now);
      if (input.nextStatus === 'signed') await this.afterSigning(client, changed, input.correlationId, input.now);
      await this.publishChanged(client, changed, current.status, input.correlationId, input.now);
      await this.audit(client, changed, input.actor.profileId, `prescription.${input.nextStatus}`, input.correlationId, input.now);
      const full = await this.withItems(client, changed);
      await this.finishIdempotency(client, changed.organizationId, input.actor.profileId,
        input.idempotency, full, input.now);
      return full;
    });
  }

  async supersede(input: {
    prescriptionId: string; items: readonly PrescriptionItemInput[]; expectedVersion: number;
    diagnosis: string | null;
    expiresAt: Date | null; actor: ClinicalActorContext; now: Date; correlationId: string;
    idempotency: PrescriptionIdempotency;
  }): Promise<PrescriptionCommandResult> {
    if (input.items.length === 0) return 'empty_items';
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const prior = await this.load(client, input.prescriptionId, true);
      if (prior === undefined) return 'not_found';
      if (prior.doctorMembershipId !== input.actor.membershipId) return 'not_issuer';
      const idempotency = await this.beginIdempotency(
        client, prior.organizationId, input.actor.profileId, input.idempotency, input.now,
      );
      if (idempotency !== 'claimed') return idempotency;
      if (prior.version !== input.expectedVersion) {
        await this.abandonIdempotency(client, prior.organizationId, input.actor.profileId, input.idempotency);
        return 'version_conflict';
      }
      if (prior.status !== 'signed') {
        await this.abandonIdempotency(client, prior.organizationId, input.actor.profileId, input.idempotency);
        return 'invalid_transition';
      }
      const draftReplacement = (await client.query<PrescriptionRow>(
        `INSERT INTO prescriptions
         (consultation_id,patient_profile_id,doctor_membership_id,organization_id,
          replaces_prescription_id, diagnosis)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${projection}`,
        [prior.consultationId, prior.patientProfileId, prior.doctorMembershipId,
          prior.organizationId, prior.prescriptionId, input.diagnosis],
      )).rows[0]!;
      await this.replaceItems(client, draftReplacement.prescriptionId, input.items);
      const replacement = (await client.query<PrescriptionRow>(
        `UPDATE prescriptions SET status = 'signed', signed_at = $2, expires_at = $3,
           version = version + 1, updated_at = $2
         WHERE prescription_id = $1 RETURNING ${projection}`,
        [draftReplacement.prescriptionId, input.now, input.expiresAt],
      )).rows[0]!;
      const superseded = (await client.query<PrescriptionRow>(
        `UPDATE prescriptions SET status = 'superseded', version = version + 1, updated_at = $2
         WHERE prescription_id = $1 RETURNING ${projection}`,
        [prior.prescriptionId, input.now],
      )).rows[0]!;
      await this.history(client, superseded, 'signed', input.actor.profileId, input.correlationId, input.now);
      await this.history(client, replacement, null, input.actor.profileId, input.correlationId, input.now);
      await this.afterSigning(client, replacement, input.correlationId, input.now);
      await this.publishChanged(client, superseded, 'signed', input.correlationId, input.now);
      await this.publishChanged(client, replacement, null, input.correlationId, input.now);
      await this.audit(client, replacement, input.actor.profileId, 'prescription.superseded', input.correlationId, input.now);
      const full = await this.withItems(client, replacement);
      await this.finishIdempotency(client, replacement.organizationId, input.actor.profileId,
        input.idempotency, full, input.now);
      return full;
    });
  }

  async cancel(input: {
    prescriptionId: string; reasonCode: string; expectedVersion: number;
    actor: ClinicalActorContext; now: Date; correlationId: string;
    idempotency: PrescriptionIdempotency;
  }): Promise<PrescriptionCommandResult> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const prior = await this.load(client, input.prescriptionId, true);
      if (prior === undefined) return 'not_found';
      if (prior.doctorMembershipId !== input.actor.membershipId) return 'not_issuer';
      const idempotency = await this.beginIdempotency(
        client, prior.organizationId, input.actor.profileId, input.idempotency, input.now,
      );
      if (idempotency !== 'claimed') return idempotency;
      if (prior.version !== input.expectedVersion) {
        await this.abandonIdempotency(client, prior.organizationId, input.actor.profileId, input.idempotency);
        return 'version_conflict';
      }
      if (!prescriptionTransitionAllowed(prior.status, 'cancelled')) {
        await this.abandonIdempotency(client, prior.organizationId, input.actor.profileId, input.idempotency);
        return 'invalid_transition';
      }
      const changed = (await client.query<PrescriptionRow>(
        `UPDATE prescriptions SET status = 'cancelled', cancellation_reason_code = $2,
           version = version + 1, updated_at = $3
         WHERE prescription_id = $1 RETURNING ${projection}`,
        [prior.prescriptionId, input.reasonCode, input.now],
      )).rows[0]!;
      await this.history(client, changed, prior.status, input.actor.profileId, input.correlationId, input.now);
      await this.publishChanged(client, changed, prior.status, input.correlationId, input.now);
      await createNotification(client, {
        profileId: changed.patientProfileId, category: 'prescriptions',
        resourceType: 'prescription', resourceId: changed.prescriptionId,
        titleCode: 'prescription.cancelled.title', bodyCode: 'prescription.cancelled.body',
        correlationId: input.correlationId, now: input.now,
      });
      await this.audit(client, changed, input.actor.profileId, 'prescription.cancelled', input.correlationId, input.now);
      const full = await this.withItems(client, changed);
      await this.finishIdempotency(client, changed.organizationId, input.actor.profileId,
        input.idempotency, full, input.now);
      return full;
    });
  }

  async loadPdfWork(id: string): Promise<PrescriptionPdfWork | undefined> {
    const row = await this.load(this.database, id, false);
    if (row === undefined || !['signed', 'superseded', 'cancelled', 'expired'].includes(row.status) || row.signedAt === null) return undefined;
    return {
      prescriptionId: row.prescriptionId, status: row.status,
      patientProfileId: row.patientProfileId, doctorMembershipId: row.doctorMembershipId,
      signedAt: row.signedAt, expiresAt: row.expiresAt, diagnosis: row.diagnosis,
      items: await this.items(this.database, row.prescriptionId),
    };
  }

  async completePdf(input: {
    prescriptionId: string; objectKey: string; bytes: Uint8Array; now: Date;
  }): Promise<'completed' | 'terminal' | 'not_found'> {
    return this.database.transaction(async (client) => {
      const row = (await client.query<{ status: string }>(
        `SELECT status FROM prescription_documents WHERE prescription_id = $1 FOR UPDATE`,
        [input.prescriptionId],
      )).rows[0];
      if (row === undefined) return 'not_found';
      if (row.status === 'ready') return 'terminal';
      await client.query(
        `UPDATE prescription_documents SET status = 'ready', object_key = $2,
           sha256 = $3, size_bytes = $4, generated_at = $5,
           failure_code = NULL, updated_at = $5 WHERE prescription_id = $1`,
        [input.prescriptionId, input.objectKey,
          createHash('sha256').update(input.bytes).digest('hex'), input.bytes.byteLength, input.now],
      );
      return 'completed';
    });
  }

  async attachDocumentObject(input: {
    prescriptionId: string;
    organizationId: string;
    storageProvider: string;
    bucket: string;
    objectKey: string;
    contentType: string;
    bytes: Uint8Array;
    uploadedByProfileId: string;
    now: Date;
  }): Promise<string> {
    return this.database.transaction(async (client) => {
      const sha256 = createHash('sha256').update(input.bytes).digest('hex');
      const objectResult = await client.query<{ objectId: string }>(
        `INSERT INTO stored_objects
         (object_id, organization_id, storage_provider, bucket, object_key,
          media_type, byte_size, declared_sha256, verified_sha256, upload_status,
          scan_state, downloadable, finalized_at, scanned_at, uploaded_by_profile_id, updated_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $7, 'finalized', 'clean', true, $8, $8, $9, $8)
         RETURNING object_id AS "objectId"`,
        [
          input.organizationId, input.storageProvider, input.bucket, input.objectKey,
          input.contentType, input.bytes.byteLength, sha256, input.now, input.uploadedByProfileId,
        ],
      );
      const objectId = objectResult.rows[0]?.objectId;
      if (objectId === undefined) throw new Error('Stored object insert returned no row');
      await client.query(
        `UPDATE prescriptions SET document_object_id = $2, version = version + 1, updated_at = $3
         WHERE prescription_id = $1`,
        [input.prescriptionId, objectId, input.now],
      );
      return objectId;
    });
  }

  async attachDocumentBytes(input: {
    prescriptionId: string;
    bytes: Uint8Array;
    mediaType: string;
    now: Date;
  }): Promise<void> {
    await this.database.query(
      `UPDATE prescriptions
       SET document_bytes = $2, document_media_type = $3,
           version = version + 1, updated_at = $4
       WHERE prescription_id = $1`,
      [input.prescriptionId, Buffer.from(input.bytes), input.mediaType, input.now],
    );
  }

  async getDocumentBytes(prescriptionId: string): Promise<{ bytes: Buffer; mediaType: string } | undefined> {
    const result = await this.database.query<{ bytes: Buffer; mediaType: string }>(
      `SELECT document_bytes AS "bytes", document_media_type AS "mediaType"
       FROM prescriptions WHERE prescription_id = $1`,
      [prescriptionId],
    );
    const row = result.rows[0];
    if (row === undefined || row.bytes === null || row.mediaType === null) return undefined;
    return { bytes: row.bytes, mediaType: row.mediaType };
  }

  async findDocumentObject(prescriptionId: string): Promise<{ objectId: string; objectKey: string; downloadable: boolean } | undefined> {
    const result = await this.database.query<{ objectId: string; objectKey: string; downloadable: boolean }>(
      `SELECT so.object_id AS "objectId", so.object_key AS "objectKey", so.downloadable
       FROM prescriptions p JOIN stored_objects so ON p.document_object_id = so.object_id
       WHERE p.prescription_id = $1`,
      [prescriptionId],
    );
    return result.rows[0];
  }

  private scope(
    organizationId: string, actorProfileId: string, input: PrescriptionIdempotency,
  ): IdempotencyScope {
    return {
      organizationId, actorProfileId, operationId: input.operationId,
      idempotencyKey: input.key, requestHash: input.requestHash,
    };
  }

  private async beginIdempotency(
    client: PoolClient, organizationId: string, actorProfileId: string,
    input: PrescriptionIdempotency, now: Date,
  ): Promise<'claimed' | PrescriptionReplay | 'idempotency_reused' | 'idempotency_in_progress'> {
    const scope = this.scope(organizationId, actorProfileId, input);
    const existing = await loadIdempotency(client, scope, now, true);
    if (existing !== undefined) {
      if (existing.expired) await deleteIdempotency(client, scope);
      else if (existing.requestHash !== input.requestHash) return 'idempotency_reused';
      else if (existing.state === 'completed' && existing.responseBody !== null) {
        return { replayed: true, body: existing.responseBody };
      } else return 'idempotency_in_progress';
    }
    const claimed = await claimIdempotency(
      client, scope, new Date(now.getTime() + input.ttlMs),
    );
    return claimed ? 'claimed' : 'idempotency_in_progress';
  }

  private async finishIdempotency(
    client: PoolClient, organizationId: string, actorProfileId: string,
    input: PrescriptionIdempotency, record: PrescriptionRecord, now: Date,
  ): Promise<void> {
    await completeIdempotency(
      client, this.scope(organizationId, actorProfileId, input),
      200, serializePrescription(record), now,
    );
  }

  private async abandonIdempotency(
    client: PoolClient, organizationId: string, actorProfileId: string,
    input: PrescriptionIdempotency,
  ): Promise<void> {
    await deleteIdempotency(client, this.scope(organizationId, actorProfileId, input));
  }

  private async afterSigning(client: PoolClient, record: PrescriptionRow, correlationId: string, now: Date) {
    await client.query(
      `INSERT INTO prescription_documents (prescription_id,status,updated_at)
       VALUES ($1,'pending',$2) ON CONFLICT (prescription_id) DO NOTHING`,
      [record.prescriptionId, now],
    );
    for (const [eventType, eventVersion] of [
      [PRESCRIPTION_PDF_REQUESTED_EVENT_TYPE, PRESCRIPTION_PDF_REQUESTED_EVENT_VERSION],
      [PHARMACY_PRESCRIPTION_INTAKE_EVENT_TYPE, PHARMACY_PRESCRIPTION_INTAKE_EVENT_VERSION],
    ] as const) {
      await client.query(
        `INSERT INTO outbox_events
         (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
          payload,correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'prescription',$3,$4,$5::jsonb,$6,$7)`,
        [eventType, eventVersion, record.prescriptionId, record.version,
          JSON.stringify({ prescription_id: record.prescriptionId }), correlationId, now],
      );
    }
    await createNotification(client, {
      profileId: record.patientProfileId, category: 'prescriptions', resourceType: 'prescription',
      resourceId: record.prescriptionId, titleCode: 'prescription.ready.title',
      bodyCode: 'prescription.ready.body', correlationId, now,
    });
  }

  private async publishChanged(client: PoolClient, record: PrescriptionRow, previous: PrescriptionStatus | null, correlationId: string, now: Date) {
    await client.query(
      `INSERT INTO outbox_events
       (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
        payload,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,'prescription',$3,$4,$5::jsonb,$6,$7)`,
      [PRESCRIPTION_CHANGED_EVENT_TYPE, PRESCRIPTION_CHANGED_EVENT_VERSION,
        record.prescriptionId, record.version, JSON.stringify({
          prescription_id: record.prescriptionId,
          patient_profile_id: record.patientProfileId,
          previous_status: previous,
          status: record.status,
        }), correlationId, now],
    );
  }

  private async history(client: PoolClient, record: PrescriptionRow, previous: PrescriptionStatus | null, actorProfileId: string, correlationId: string, now: Date) {
    await client.query(
      `INSERT INTO prescription_status_history
       (prescription_id,previous_status,status,reason_code,actor_profile_id,correlation_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [record.prescriptionId, previous, record.status, record.cancellationReasonCode,
        actorProfileId, correlationId, now],
    );
  }

  private async audit(client: PoolClient, record: PrescriptionRow, actorProfileId: string, action: string, correlationId: string, now: Date) {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id,organization_id,actor_profile_id,action,object_type,object_id,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,$3,'prescription',$4,$5,$6)`,
      [record.organizationId, actorProfileId, action, record.prescriptionId, correlationId, now],
    );
  }

  private async replaceItems(client: PoolClient, id: string, items: readonly PrescriptionItemInput[]) {
    await client.query(`DELETE FROM prescription_items WHERE prescription_id = $1`, [id]);
    for (const [index, item] of items.entries()) {
      await client.query(
        `INSERT INTO prescription_items
         (prescription_id,position,medication_reference,medication_text,dose_value,dose_unit,
          route_code,frequency_code,frequency_text,duration_days,patient_instructions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, index + 1, item.medicationReference, item.medicationText, item.doseValue,
          item.doseUnit, item.routeCode, item.frequencyCode, item.frequencyText,
          item.durationDays, item.patientInstructions],
      );
    }
  }

  private async consultation(client: PoolClient, id: string, lock: boolean): Promise<ConsultationContext | undefined> {
    return (await client.query<ConsultationContext>(
      `SELECT consultation_id AS "consultationId", organization_id AS "organizationId",
         patient_profile_id AS "patientProfileId", doctor_membership_id AS "doctorMembershipId", status
       FROM consultations WHERE consultation_id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id],
    )).rows[0];
  }

  private async load(client: PoolClient | PostgresConnection, id: string, lock: boolean): Promise<PrescriptionRow | undefined> {
    const text = `SELECT ${projection} FROM prescriptions WHERE prescription_id = $1 ${lock ? 'FOR UPDATE' : ''}`;
    const result = client instanceof PostgresConnection
      ? await client.query<PrescriptionRow>(text, [id])
      : await client.query<PrescriptionRow>(text, [id]);
    return result.rows[0];
  }

  private async items(client: PoolClient | PostgresConnection, id: string): Promise<PrescriptionItemRecord[]> {
    const text = `SELECT ${itemProjection} FROM prescription_items WHERE prescription_id = $1 ORDER BY position`;
    const result = client instanceof PostgresConnection
      ? await client.query<ItemRow>(text, [id])
      : await client.query<ItemRow>(text, [id]);
    return result.rows;
  }

  private async withItems(client: PoolClient | PostgresConnection, row: PrescriptionRow): Promise<PrescriptionRecord> {
    return { ...row, items: await this.items(client, row.prescriptionId) };
  }
}
