/**
 * Professional verification documents and their review history.
 *
 * SHAPE OF EVERY MUTATION HERE
 * ----------------------------
 * Copied from `MembershipRepository`, because the hazards are identical:
 *   1. one transaction per mutation;
 *   2. the organization row is locked `FOR UPDATE` first, so every mutation in an
 *      organization takes locks in the same order (organization, actor, target)
 *      and cannot deadlock against the others;
 *   3. the actor's authority is re-proved under lock by `revalidateActor`,
 *      because the HTTP guard's answer is stale by the time the write happens;
 *   4. `expected_version` optimistic concurrency, so a stale reviewer is
 *      rejected instead of silently overwriting a newer decision;
 *   5. structured PHI-free reason codes only - see `VERIFICATION_REASON_CODES`;
 *   6. `Idempotency-Key` with a stored response snapshot for replay;
 *   7. the audit row and the canonical outbox event are written in the SAME
 *      transaction as the state change, so they cannot diverge from it.
 *
 * THE INVARIANT THIS MODULE MUST NOT BREAK
 * ----------------------------------------
 * Verification and membership activation are ORTHOGONAL. Approving a document
 * NEVER activates a membership: this module does not write
 * `organization_memberships.status`, ever. It writes only
 * `organization_memberships.verification_status`, which is the precondition an
 * administrator's separate activation decision has to satisfy. The reverse
 * direction still holds too: activating a doctor, driver, pharmacy or emergency
 * membership requires `verification_status = 'approved'`, enforced by
 * `MembershipRepository`.
 *
 * Because continuous eligibility re-checks approved verification on EVERY
 * authenticated request, writing `suspended` here invalidates that professional's
 * live sessions immediately. That is the intended blast radius of a suspension,
 * so suspension is deliberately not softened into a delayed or advisory state.
 */

import type { PoolClient, QueryResultRow } from 'pg';
import { revalidateActor } from './actor-revalidation.js';
import { PostgresConnection } from './connection.js';
import {
  claimIdempotency,
  completeIdempotency,
  deleteIdempotency,
  loadIdempotency,
  type IdempotencyRecord,
  type IdempotencyScope,
} from './idempotency.js';
import type {
  ActorAuthorizationContext,
  ActorRevalidationFailure,
} from './membership-repository.js';
import { VERIFICATION_REASON_CODES, type VerificationReasonCode } from './schema-verification.js';
import { createNotification } from './notification-repository.js';
import {
  FILE_SCAN_REQUESTED_EVENT_TYPE,
  FILE_SCAN_REQUESTED_EVENT_VERSION,
} from './private-file-events.js';

export { VERIFICATION_REASON_CODES, type VerificationReasonCode };

/**
 * Canonical event contract for every verification document mutation. The payload
 * carries exactly these four fields because the matching AsyncAPI schema declares
 * `additionalProperties: false`; richer context belongs in the audit log, not in a
 * published event that other services parse.
 */
export const VERIFICATION_DOCUMENT_CHANGED_EVENT_TYPE = 'verification.document.changed.v1';
export const VERIFICATION_DOCUMENT_CHANGED_EVENT_VERSION = 1;

/**
 * Document kinds, reusing the `verification_document_kind` enum created by
 * migration 0011. The WP-04b brief named `practising_certificate` and
 * `insurance`; those are the same facts as the existing
 * `qualification_certificate` and `professional_indemnity` labels, so the
 * existing vocabulary is reused rather than given synonyms.
 */
export const VERIFICATION_DOCUMENT_KINDS = [
  'medical_license',
  'national_id',
  'driving_licence',
  'vehicle_registration',
  'pharmacy_licence',
  'qualification_certificate',
  'professional_indemnity',
] as const;

export type VerificationDocumentKind = typeof VERIFICATION_DOCUMENT_KINDS[number];

export type VerificationDocumentStatus =
  | 'not_submitted' | 'pending_review' | 'changes_requested'
  | 'approved' | 'rejected' | 'suspended' | 'expired';

/** The statuses a human reviewer may move a document into. */
export const REVIEWABLE_VERIFICATION_STATUSES = [
  'changes_requested', 'approved', 'rejected', 'suspended', 'expired',
] as const;

export type ReviewableVerificationStatus = typeof REVIEWABLE_VERIFICATION_STATUSES[number];

export type ObjectUploadState = 'pending' | 'finalized' | 'quarantined' | 'deleted' | 'rejected';
export type ObjectScanState = 'not_scanned' | 'scanning' | 'clean' | 'infected' | 'scan_failed';

export interface VerificationDocumentRecord {
  readonly documentId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly profileId: string;
  readonly roleId: string;
  readonly membershipVerificationStatus: VerificationDocumentStatus | null;
  readonly objectId: string;
  readonly documentKind: VerificationDocumentKind;
  readonly status: VerificationDocumentStatus;
  readonly submittedAt: Date;
  readonly reviewedAt: Date | null;
  readonly reviewerMembershipId: string | null;
  readonly reviewerProfileId: string | null;
  readonly reasonCode: VerificationReasonCode | null;
  readonly expiresAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly declaredSha256: string;
  readonly verifiedSha256: string | null;
  readonly uploadState: ObjectUploadState;
  readonly scanState: ObjectScanState;
  readonly downloadable: boolean;
  readonly quarantinedAt: Date | null;
  readonly retentionExpiresAt: Date | null;
}

/**
 * A replayed idempotent request returns the response stored when the original
 * succeeded. Note what is NOT stored: the pre-signed upload URL. A pre-signed URL
 * is a time-bounded capability, so replaying an expired one would hand the client
 * something unusable. The snapshot guarantees the part that matters - that no
 * second document or stored object was created - and the caller mints a fresh
 * capability for the same object key.
 */
export interface VerificationResponseSnapshot {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface RequestVerificationUploadInput {
  readonly membershipId: string;
  readonly actorProfileId: string;
  readonly actor: ActorAuthorizationContext;
  readonly documentKind: VerificationDocumentKind;
  readonly contentType: string;
  readonly byteSize: number;
  readonly declaredSha256: string;
  readonly storageProvider: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly documentExpiresAt: Date | null;
  readonly retentionExpiresAt: Date | null;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly idempotencyTtlMs: number;
  readonly now: Date;
  readonly correlationId: string;
}

export type RequestVerificationUploadResult =
  | { readonly record: VerificationDocumentRecord; readonly replayed: false }
  | { readonly snapshot: VerificationResponseSnapshot; readonly replayed: true }
  | 'membership_not_found'
  | 'role_not_verifiable'
  | 'document_awaiting_review'
  | 'idempotency_reused'
  | ActorRevalidationFailure;

export interface FinalizeVerificationDocumentInput {
  readonly documentId: string;
  readonly actorProfileId: string;
  readonly actor: ActorAuthorizationContext;
  /** The digest the client claims it uploaded. */
  readonly reportedSha256: string;
  /** The digest the store itself reports for the key, or undefined when it has none. */
  readonly storedSha256: string | undefined;
  readonly storedByteSize: number | undefined;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly idempotencyTtlMs: number;
  readonly now: Date;
  readonly correlationId: string;
}

export type FinalizeVerificationDocumentResult =
  | { readonly record: VerificationDocumentRecord; readonly replayed: false }
  | { readonly snapshot: VerificationResponseSnapshot; readonly replayed: true }
  | 'not_found'
  | 'already_finalized'
  | 'checksum_mismatch'
  | 'idempotency_reused'
  | ActorRevalidationFailure;

export interface ListVerificationDocumentsInput {
  readonly membershipId: string;
  readonly limit: number;
}

export interface TransitionVerificationDocumentInput {
  readonly documentId: string;
  readonly actorProfileId: string;
  readonly actorRoleId: 'admin' | 'super_admin';
  readonly actor: ActorAuthorizationContext;
  readonly nextStatus: ReviewableVerificationStatus;
  readonly expectedVersion: number;
  readonly reasonCode: VerificationReasonCode;
  readonly now: Date;
  readonly correlationId: string;
}

export type TransitionVerificationDocumentResult =
  | VerificationDocumentRecord
  | 'not_found'
  | 'version_conflict'
  | 'transition_invalid'
  | 'reason_code_invalid'
  | 'self_review_denied'
  | 'document_not_verifiable'
  | ActorRevalidationFailure;

interface DocumentRow extends QueryResultRow {
  readonly documentId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly profileId: string;
  readonly roleId: string;
  readonly membershipVerificationStatus: VerificationDocumentStatus | null;
  readonly objectId: string;
  readonly documentKind: VerificationDocumentKind;
  readonly status: VerificationDocumentStatus;
  readonly submittedAt: Date;
  readonly reviewedAt: Date | null;
  readonly reviewerMembershipId: string | null;
  readonly reviewerProfileId: string | null;
  readonly reasonCode: VerificationReasonCode | null;
  readonly expiresAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: string;
  readonly declaredSha256: string;
  readonly verifiedSha256: string | null;
  readonly uploadState: ObjectUploadState;
  readonly scanState: ObjectScanState;
  readonly downloadable: boolean;
  readonly quarantinedAt: Date | null;
  readonly retentionExpiresAt: Date | null;
}

interface MembershipContextRow extends QueryResultRow {
  readonly organizationId: string;
  readonly profileId: string;
  readonly roleId: string;
  readonly verificationStatus: VerificationDocumentStatus | null;
}

export class VerificationRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Resolves the organization and storage key of a document the ACTOR OWNS.
   *
   * Used before the finalize transaction, because the storage stat needs the
   * object key. Returns `undefined` both for a document that does not exist and
   * for one that belongs to somebody else, so this read cannot be used as an
   * existence oracle. It is a read, not an authority: `finalize` re-proves
   * everything under lock.
   */
  async loadOwnDocumentContext(
    documentId: string,
    actorProfileId: string,
  ): Promise<{ organizationId: string; objectKey: string } | undefined> {
    const result = await this.database.query<{
      readonly organizationId: string;
      readonly objectKey: string;
    }>(
      `SELECT document.organization_id AS "organizationId",
       object.object_key AS "objectKey"
       FROM verification_documents AS document
       JOIN organization_memberships AS membership
         ON membership.membership_id = document.membership_id
       JOIN stored_objects AS object ON object.object_id = document.object_id
       WHERE document.document_id = $1 AND membership.profile_id = $2`,
      [documentId, actorProfileId],
    );
    return result.rows[0];
  }

  /** Organization of a document, for reviewer routes. `undefined` when absent. */
  async loadDocumentOrganization(documentId: string): Promise<string | undefined> {
    const result = await this.database.query<{ readonly organizationId: string }>(
      `SELECT organization_id AS "organizationId" FROM verification_documents
       WHERE document_id = $1`,
      [documentId],
    );
    return result.rows[0]?.organizationId;
  }

  /** Organization and owning profile of a membership, for submission routes. */
  async loadMembershipContext(membershipId: string): Promise<{
    organizationId: string;
    profileId: string;
    roleId: string;
  } | undefined> {
    const result = await this.database.query<MembershipContextRow>(
      `SELECT organization_id AS "organizationId", profile_id AS "profileId",
       role_id AS "roleId", verification_status AS "verificationStatus"
       FROM organization_memberships WHERE membership_id = $1`,
      [membershipId],
    );
    return result.rows[0];
  }

  /**
   * Reads one verification document by id, scoped to the membership the URL
   * names. The `membershipId` predicate is pushed into the SQL so the query
   * cannot return a document belonging to another membership, and an
   * out-of-scope or absent document reads as `undefined` — which the service
   * maps to an audited 404 so absence and denial stay indistinguishable.
   *
   * The service separately proves the caller is either the owning profile or an
   * authorized reviewer before calling this, so the membership scoping here is a
   * backstop, not the only gate.
   */
  async findAuthorized(
    documentId: string,
    membershipId: string,
  ): Promise<VerificationDocumentRecord | undefined> {
    const result = await this.database.query<DocumentRow>(
      `${documentProjection()}
       WHERE document.document_id = $1 AND document.membership_id = $2`,
      [documentId, membershipId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapDocument(row);
  }

  async list(input: ListVerificationDocumentsInput): Promise<VerificationDocumentRecord[]> {
    const result = await this.database.query<DocumentRow>(
      `${documentProjection()}
       WHERE document.membership_id = $1
       ORDER BY document.submitted_at DESC, document.document_id DESC
       LIMIT $2`,
      [input.membershipId, input.limit],
    );
    return result.rows.map(mapDocument);
  }

  /**
   * Creates the document row plus its pending stored-object metadata, so a
   * pre-signed upload target can be minted for a key the platform already knows
   * about. Nothing is downloadable at this point and nothing is reviewable: the
   * object is `pending` with an unverified checksum until `finalize` runs.
   */
  async requestUpload(
    input: RequestVerificationUploadInput,
  ): Promise<RequestVerificationUploadResult> {
    const context = await this.loadMembershipContext(input.membershipId);
    if (context === undefined) return 'membership_not_found';
    const organizationId = context.organizationId;
    const scope = idempotencyScope(input, organizationId, 'verification.document.request');

    return this.database.transaction(async (client) => {
      // Fixed lock order for every mutation in this organization: organization,
      // then actor, then target. The unlocked read above only chose WHICH
      // organization row to lock; the membership is re-read under lock below.
      const organization = await client.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE`,
        [organizationId],
      );
      if (organization.rowCount !== 1) return 'membership_not_found';

      const actorFailure = await revalidateActor(client, input.actor, organizationId, input.now);
      if (actorFailure !== undefined) return actorFailure;

      const existingKey = await loadIdempotency(client, scope, input.now, true);
      if (existingKey !== undefined && !existingKey.expired) {
        return resolveUploadIdempotency(scope, existingKey);
      }
      if (existingKey?.expired === true) await deleteIdempotency(client, scope);

      const membership = await client.query<MembershipContextRow>(
        `SELECT organization_id AS "organizationId", profile_id AS "profileId",
         role_id AS "roleId", verification_status AS "verificationStatus"
         FROM organization_memberships
         WHERE membership_id = $1 AND organization_id = $2
         FOR UPDATE`,
        [input.membershipId, organizationId],
      );
      const target = membership.rows[0];
      // A membership belonging to somebody else is reported as absent: a
      // submission route must not confirm that another profile's membership
      // exists.
      if (target === undefined || target.profileId !== input.actorProfileId) {
        return 'membership_not_found';
      }
      if (!requiresVerification(target.roleId)) return 'role_not_verifiable';

      const current = await client.query<DocumentRow>(
        `${documentProjection()}
         WHERE document.membership_id = $1 AND document.document_kind = $2
           AND document.status IN ('pending_review', 'changes_requested', 'approved')
         FOR UPDATE OF document, object`,
        [input.membershipId, input.documentKind],
      );
      const held = current.rows[0];
      // An upload that never completed, or whose bytes failed checksum
      // verification, leaves the document holding the one live slot for its kind.
      // Re-pointing that document at a fresh object is a retry, not a second
      // submission; a document whose object IS verified is awaiting a reviewer and
      // must not be silently replaced underneath them.
      if (held !== undefined && held.uploadState !== 'pending' && held.uploadState !== 'rejected') {
        return 'document_awaiting_review';
      }

      if (!await claimIdempotency(
        client, scope, new Date(input.now.getTime() + input.idempotencyTtlMs),
      )) {
        const raced = await loadIdempotency(client, scope, input.now, true);
        if (raced === undefined) throw new Error('Idempotency claim disappeared');
        return resolveUploadIdempotency(scope, raced);
      }

      const objectId = await this.insertStoredObject(client, input, organizationId);
      const documentId = held === undefined
        ? await this.insertDocument(client, input, organizationId, objectId)
        : await this.repointDocument(client, held.documentId, objectId, input);

      await this.syncMembershipVerificationStatus(client, input.membershipId, input.now);
      const record = await this.loadForUpdate(client, documentId);
      if (record === undefined) throw new Error('Created verification document could not be loaded');
      await this.recordDocumentChange(
        client,
        record,
        held === undefined ? 'verification.document.submitted' : 'verification.document.resubmitted',
        null,
        input.actorProfileId,
        input.correlationId,
        input.now,
      );
      await completeIdempotency(client, scope, 201, serializeDocument(record), input.now);
      return { record, replayed: false };
    });
  }

  /**
   * Confirms the uploaded bytes are the bytes the platform was promised.
   *
   * Three digests must agree: what the client declared when it asked for the
   * upload, what the client reports now, and what the STORE says it holds. The
   * store's answer is the one that cannot be forged by the client, which is why a
   * missing store checksum counts as a mismatch rather than as a pass. A mismatch
   * moves the object to `rejected`, which is terminal and can never be
   * downloadable, and leaves an audit row explaining why.
   */
  async finalize(
    input: FinalizeVerificationDocumentInput,
  ): Promise<FinalizeVerificationDocumentResult> {
    const organizationId = await this.loadDocumentOrganization(input.documentId);
    if (organizationId === undefined) return 'not_found';
    const scope = idempotencyScope(input, organizationId, 'verification.document.finalize');

    return this.database.transaction(async (client) => {
      const organization = await client.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE`,
        [organizationId],
      );
      if (organization.rowCount !== 1) return 'not_found';

      const actorFailure = await revalidateActor(client, input.actor, organizationId, input.now);
      if (actorFailure !== undefined) return actorFailure;

      const existingKey = await loadIdempotency(client, scope, input.now, true);
      if (existingKey !== undefined && !existingKey.expired) {
        return resolveFinalizeIdempotency(scope, existingKey);
      }
      if (existingKey?.expired === true) await deleteIdempotency(client, scope);

      const current = await this.loadForUpdate(client, input.documentId);
      if (current === undefined || current.profileId !== input.actorProfileId) return 'not_found';
      if (current.uploadState === 'finalized') return 'already_finalized';
      if (current.uploadState !== 'pending') return 'not_found';

      if (!await claimIdempotency(
        client, scope, new Date(input.now.getTime() + input.idempotencyTtlMs),
      )) {
        const raced = await loadIdempotency(client, scope, input.now, true);
        if (raced === undefined) throw new Error('Idempotency claim disappeared');
        return resolveFinalizeIdempotency(scope, raced);
      }

      const expected = current.declaredSha256;
      const matches = input.reportedSha256 === expected &&
        input.storedSha256 === expected &&
        (input.storedByteSize === undefined || input.storedByteSize === current.byteSize);
      if (!matches) {
        await client.query(
          `UPDATE stored_objects
           SET upload_status = 'rejected', version = version + 1, updated_at = $2
           WHERE object_id = $1`,
          [current.objectId, input.now],
        );
        // The digests themselves are recorded: they are content-addressed hashes,
        // not payload, and an integrity investigation is impossible without them.
        await this.recordAudit(client, current, 'verification.document.checksum_rejected', {
          declared_sha256: expected,
          reported_sha256: input.reportedSha256,
          stored_sha256: input.storedSha256 ?? null,
          declared_byte_size: current.byteSize,
          stored_byte_size: input.storedByteSize ?? null,
        }, 'OBJECT_CHECKSUM_MISMATCH', input.actorProfileId, input.correlationId);
        await completeIdempotency(client, scope, 409, {
          code: 'OBJECT_CHECKSUM_MISMATCH',
        }, input.now);
        return 'checksum_mismatch';
      }

      await client.query(
        `UPDATE stored_objects
         SET upload_status = 'finalized', finalized_at = $2, verified_sha256 = $3,
             version = version + 1, updated_at = $2
         WHERE object_id = $1 AND upload_status = 'pending'`,
        [current.objectId, input.now, expected],
      );
      // The document itself is re-versioned even though its status is unchanged:
      // what a reviewer is being asked to decide on has changed, so a reviewer
      // holding the pre-finalize version must be made to re-read it.
      await client.query(
        `UPDATE verification_documents
         SET version = version + 1, updated_at = $2 WHERE document_id = $1`,
        [current.documentId, input.now],
      );
      const record = await this.loadForUpdate(client, input.documentId);
      if (record === undefined) throw new Error('Verification document disappeared during finalize');
      await this.recordDocumentChange(
        client, record, 'verification.document.finalized', null,
        input.actorProfileId, input.correlationId, input.now,
      );
      await this.enqueueMalwareScan(
        client, record.objectId, input.correlationId, input.now,
      );
      await completeIdempotency(client, scope, 200, serializeDocument(record), input.now);
      return { record, replayed: false };
    });
  }

  /**
   * The reviewer's decision on a document.
   *
   * Same shape as `MembershipRepository.transition`: organization lock first,
   * actor re-proved under lock, `expected_version` optimistic concurrency, then
   * the state change, the append-only history row, the derived membership
   * verification status, the audit row and the outbox event - all in one
   * transaction.
   *
   * No `Idempotency-Key` here, deliberately. `expected_version` already makes a
   * repeated decision harmless: the second attempt is a version conflict rather
   * than a second review, which is the same protection an idempotency key would
   * buy for a state transition.
   */
  async transition(
    input: TransitionVerificationDocumentInput,
  ): Promise<TransitionVerificationDocumentResult> {
    const organizationId = await this.loadDocumentOrganization(input.documentId);
    if (organizationId === undefined) return 'not_found';

    return this.database.transaction(async (client) => {
      // Fixed lock order shared with requestUpload/finalize: organization, then
      // actor, then target. The unlocked read above only chose WHICH
      // organization row to lock.
      const organization = await client.query(
        `SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE`,
        [organizationId],
      );
      if (organization.rowCount !== 1) return 'not_found';

      const actorFailure = await revalidateActor(client, input.actor, organizationId, input.now);
      if (actorFailure !== undefined) return actorFailure;
      // A review is administrative by definition: the reviewed document row has
      // to name the authorising membership, and a self-service actor has none to
      // name. Narrowing here also avoids a non-null assertion below.
      if (input.actor.kind !== 'administrative') return 'actor_permission_denied';

      const current = await this.loadForUpdate(client, input.documentId);
      if (current === undefined) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      // Nobody reviews their own licence. Checked before any state-dependent
      // answer, so a self-review attempt never learns the document's current
      // status, target validity or object scan verdict.
      if (current.profileId === input.actorProfileId) return 'self_review_denied';
      if (!requiresVerification(current.roleId)) return 'document_not_verifiable';
      if (!transitionAllowed(current.status, input.nextStatus)) return 'transition_invalid';
      // Approval is the moment the platform starts trusting the file, so the
      // bytes must already be the bytes that were promised and must have passed
      // the malware scan. A quarantined, infected, unscanned or unfinalized
      // object can never be approved: approving it would create a document whose
      // evidence nobody has actually seen.
      if (
        input.nextStatus === 'approved' &&
        (current.uploadState !== 'finalized' || current.scanState !== 'clean')
      ) return 'transition_invalid';
      // Mirrors `verification_reviews_approval_reason_check`: an approval may
      // only be justified as a positive verification, and a positive
      // verification may not justify anything else. Rejecting it here turns a
      // constraint violation into a specific, mappable API error.
      if ((input.reasonCode === 'approved_verified') !== (input.nextStatus === 'approved')) {
        return 'reason_code_invalid';
      }

      // `verification_documents_review_status_check` admits a recorded review
      // only for changes_requested/approved/rejected/suspended, and
      // `..._review_pair_check` plus `..._decision_reason_check` bind the
      // timestamp, the reviewer and the reason together. An expiry is therefore
      // recorded with no decision columns on the document row; who expired it,
      // when and why is the history row written below, which is the evidence an
      // auditor reads anyway.
      const recordsDecision = input.nextStatus !== 'expired';
      // The reviewer membership is written straight from the actor context:
      // `verification_documents_reviewer_org_fk` requires it to belong to the
      // document's organization, which is exactly the escalation guard that
      // constraint exists for. Substituting NULL to dodge the constraint would
      // produce an approval with no accountable membership.
      await client.query(
        `UPDATE verification_documents
         SET status = $2, reviewed_at = $3, reviewed_by_membership_id = $4,
             review_decision_reason = $5, version = version + 1, updated_at = $6
         WHERE document_id = $1 AND version = $7`,
        [
          current.documentId,
          input.nextStatus,
          recordsDecision ? input.now : null,
          recordsDecision ? input.actor.membershipId : null,
          recordsDecision ? input.reasonCode : null,
          input.now,
          current.version,
        ],
      );
      // Append-only history. `verification_reviews_reject_mutation` refuses
      // UPDATE and DELETE on this table, so this INSERT is the only way a
      // decision is ever recorded - and the reviewer is the durable PROFILE,
      // because a membership can be revoked and re-created.
      await client.query(
        `INSERT INTO verification_reviews
         (review_id, document_id, organization_id, reviewer_profile_id,
          previous_status, next_status, reason_code, correlation_id, occurred_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          current.documentId, organizationId, input.actorProfileId,
          current.status, input.nextStatus, input.reasonCode,
          input.correlationId, input.now,
        ],
      );
      await this.syncMembershipVerificationStatus(client, current.membershipId, input.now);

      const updated = await this.loadForUpdate(client, input.documentId);
      if (updated === undefined) {
        throw new Error('Verification document disappeared during transition');
      }
      await this.recordDocumentChange(
        client, updated, `verification.document.${reviewAction(input.nextStatus)}`,
        current.status, input.actorProfileId, input.correlationId, input.now,
      );
      // The reviewed party learns the outcome in the same transaction as the
      // decision. The category is `system` with `verification.*` title codes,
      // which is the combination the email channel already maps to the
      // verification-result template.
      const decisionCode: string | null = input.nextStatus === 'approved'
        ? 'verification.approved.title'
        : input.nextStatus === 'rejected'
          ? 'verification.rejected.title'
          : input.nextStatus === 'changes_requested'
            ? 'verification.changes_requested.title'
            : null;
      if (decisionCode !== null) {
        await createNotification(client, {
          profileId: current.profileId,
          category: 'system',
          resourceType: 'verification_document',
          resourceId: current.documentId,
          titleCode: decisionCode,
          bodyCode: decisionCode.replace(/\.title$/, '.body'),
          mandatoryEmail: true,
          correlationId: input.correlationId,
          now: input.now,
        });
      }
      return updated;
    });
  }

  /**
   * Pending metadata for the bytes that have not been uploaded yet. Nothing here
   * is trusted: the digest is only what the client DECLARED, the scan has not
   * run, and `downloadable` stays false because
   * `stored_objects_downloadable_check` would refuse anything else at this point.
   */
  private async insertStoredObject(
    client: PoolClient,
    input: RequestVerificationUploadInput,
    organizationId: string,
  ): Promise<string> {
    // `media_type` is the existing 0011 column for what the API calls
    // `content_type`; see the mapping table in migration 0012 rather than adding
    // a second column for the same fact.
    const result = await client.query<{ readonly objectId: string }>(
      `INSERT INTO stored_objects
       (object_id, organization_id, storage_provider, bucket, object_key,
        media_type, byte_size, declared_sha256, upload_status, scan_state,
        downloadable, retention_expires_at, uploaded_by_profile_id, updated_at)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, 'pending', 'not_scanned',
        false, $8, $9, $10)
       RETURNING object_id AS "objectId"`,
      [
        organizationId, input.storageProvider, input.bucket, input.objectKey,
        input.contentType, input.byteSize, input.declaredSha256,
        input.retentionExpiresAt, input.actorProfileId, input.now,
      ],
    );
    const objectId = result.rows[0]?.objectId;
    if (objectId === undefined) throw new Error('Stored object insert returned no row');
    return objectId;
  }

  /** First submission of a kind for this membership. */
  private async insertDocument(
    client: PoolClient,
    input: RequestVerificationUploadInput,
    organizationId: string,
    objectId: string,
  ): Promise<string> {
    // `version` starts at 0 so the first reviewer read and the first
    // `expected_version` a client sends agree; finalize bumps it to 1.
    const result = await client.query<{ readonly documentId: string }>(
      `INSERT INTO verification_documents
       (document_id, membership_id, organization_id, object_id, document_kind,
        status, submitted_at, expires_at, version, updated_at)
       VALUES (uuidv7(), $1, $2, $3, $4, 'pending_review', $5, $6, 0, $5)
       RETURNING document_id AS "documentId"`,
      [
        input.membershipId, organizationId, objectId, input.documentKind,
        input.now, input.documentExpiresAt,
      ],
    );
    const documentId = result.rows[0]?.documentId;
    if (documentId === undefined) throw new Error('Verification document insert returned no row');
    return documentId;
  }

  /**
   * Retry of an upload that never produced trustworthy bytes.
   *
   * The document keeps its identity - `verification_documents_membership_kind_current_uq`
   * allows only one live document per kind, and a retry is not a second
   * submission - but every trace of an earlier decision is cleared, because the
   * reviewer is now being asked about a different file. The abandoned object row
   * is left behind on purpose: it is the record of a failed or tampered upload
   * and the retention sweeper owns its disposal.
   */
  private async repointDocument(
    client: PoolClient,
    documentId: string,
    objectId: string,
    input: RequestVerificationUploadInput,
  ): Promise<string> {
    await client.query(
      `UPDATE verification_documents
       SET object_id = $2, status = 'pending_review', submitted_at = $3,
           expires_at = $4, reviewed_at = NULL, reviewed_by_membership_id = NULL,
           review_decision_reason = NULL, version = version + 1, updated_at = $3
       WHERE document_id = $1`,
      [documentId, objectId, input.now, input.documentExpiresAt],
    );
    return documentId;
  }

  /**
   * Recomputes `organization_memberships.verification_status` from the
   * membership's documents.
   *
   * CRITICAL INVARIANT: this writes ONLY `verification_status`. It must NEVER
   * write `organization_memberships.status`. Approving verification does not
   * activate a membership - activation stays an administrator's separate
   * decision, for which an approved verification is merely a precondition.
   * `updated_at` is refreshed because every UPDATE in this schema does; the
   * membership `version` is deliberately not bumped, because verification is
   * input to an administrator's decision, not a decision about the membership,
   * and invalidating their in-flight `expected_version` would be a false
   * conflict.
   *
   * PRECEDENCE: the worst state wins. A single suspended licence must not be
   * masked by other approved documents, so suspension outranks everything,
   * then rejection, then expiry. `approved` is only reached when a document
   * exists and every one of them is approved: there is no per-role catalogue of
   * required kinds yet, so every document the professional submitted counts as
   * required, which is the conservative reading.
   */
  private async syncMembershipVerificationStatus(
    client: PoolClient,
    membershipId: string,
    now: Date,
  ): Promise<void> {
    // One pass over the membership's documents; `bool_or`/`bool_and` return NULL
    // for a membership with no documents, and a NULL branch simply falls through
    // to `not_submitted`. The CASE arms are quoted literals, so the result is
    // cast to the enum explicitly rather than relying on assignment coercion.
    await client.query(
      `WITH document_state AS (
         SELECT count(*) AS document_count,
           bool_or(status = 'suspended') AS has_suspended,
           bool_or(status = 'rejected') AS has_rejected,
           bool_or(status = 'expired') AS has_expired,
           bool_or(status = 'pending_review') AS has_pending,
           bool_or(status = 'changes_requested') AS has_changes,
           bool_and(status = 'approved') AS all_approved
         FROM verification_documents WHERE membership_id = $1
       )
       UPDATE organization_memberships
       SET verification_status = (CASE
             WHEN state.has_suspended THEN 'suspended'
             WHEN state.has_rejected THEN 'rejected'
             WHEN state.has_expired THEN 'expired'
             WHEN state.document_count > 0 AND state.all_approved THEN 'approved'
             WHEN state.has_pending THEN 'pending_review'
             WHEN state.has_changes THEN 'changes_requested'
             ELSE 'not_submitted'
           END)::verification_status,
           updated_at = $2
       FROM document_state AS state
       WHERE membership_id = $1`,
      [membershipId, now],
    );
  }

  /**
   * Locks the document and its stored object for the rest of the transaction.
   * The membership row is joined but NOT locked here: `requestUpload` locks it
   * explicitly in the fixed order, and locking it as a side effect of a read
   * would make that order depend on which query ran first.
   */
  private async loadForUpdate(
    client: PoolClient,
    documentId: string,
  ): Promise<VerificationDocumentRecord | undefined> {
    const result = await client.query<DocumentRow>(
      `${documentProjection()}
       WHERE document.document_id = $1
       FOR UPDATE OF document, object`,
      [documentId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapDocument(row);
  }

  private async enqueueMalwareScan(
    client: PoolClient,
    objectId: string,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       SELECT uuidv7(), $1, $2, 'stored_object', object_id, version,
        $3, $4, $5 FROM stored_objects
       WHERE object_id = $6 AND upload_status = 'finalized'
         AND scan_state = 'not_scanned'`,
      [
        FILE_SCAN_REQUESTED_EVENT_TYPE,
        FILE_SCAN_REQUESTED_EVENT_VERSION,
        { object_id: objectId },
        correlationId,
        now,
        objectId,
      ],
    );
  }

  /**
   * Writes the audit row and the canonical outbox event in the SAME transaction
   * as the state change, so a published event can never describe a state the
   * database did not reach - and a state change can never go unpublished.
   */
  private async recordDocumentChange(
    client: PoolClient,
    record: VerificationDocumentRecord,
    action: string,
    previousStatus: VerificationDocumentStatus | null,
    actorProfileId: string,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    // The audit row carries the wide context (object state, derived membership
    // verification status, version). None of it may leak into the event payload
    // below, which is contract-bound.
    await this.recordAudit(client, record, action, {
      previous_status: previousStatus,
      status: record.status,
      document_kind: record.documentKind,
      membership_id: record.membershipId,
      membership_verification_status: record.membershipVerificationStatus,
      object_id: record.objectId,
      upload_state: record.uploadState,
      scan_state: record.scanState,
      version: record.version,
    }, record.reasonCode, actorProfileId, correlationId);
    // Exactly the four fields the AsyncAPI schema declares: it sets
    // `additionalProperties: false`, so any extra key would fail contract
    // validation and dead-letter in the worker.
    await client.query(
      `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, payload, correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, 'verification_document', $3, $4, $5, $6, $7)`,
      [
        VERIFICATION_DOCUMENT_CHANGED_EVENT_TYPE,
        VERIFICATION_DOCUMENT_CHANGED_EVENT_VERSION,
        record.documentId,
        record.version,
        {
          document_id: record.documentId,
          membership_id: record.membershipId,
          document_kind: record.documentKind,
          status: record.status,
        },
        correlationId,
        now,
      ],
    );
  }

  /**
   * Single writer for verification audit rows. `object_type` is the document,
   * never the file, so an auditor searching by document id finds the whole
   * story including the checksum rejections that never became a review.
   */
  private async recordAudit(
    client: PoolClient,
    record: VerificationDocumentRecord,
    action: string,
    metadata: Record<string, unknown>,
    reason: string | null,
    actorProfileId: string,
    correlationId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id, organization_id, actor_profile_id, action, object_type,
        object_id, reason, correlation_id, metadata)
       VALUES (uuidv7(), $1, $2, $3, 'verification_document', $4, $5, $6, $7)`,
      [
        record.organizationId, actorProfileId, action, record.documentId,
        reason, correlationId, metadata,
      ],
    );
  }
}

/**
 * The single document representation. Used both for live HTTP responses and for
 * the idempotency snapshot, so a replayed response is identical by construction.
 * `document_id` is what `resolveUploadIdempotency` and
 * `resolveFinalizeIdempotency` require a stored snapshot to contain, so it is
 * the field that proves a snapshot describes a document at all.
 *
 * The pre-signed upload URL is deliberately absent: it is a time-bounded
 * capability, and a stored one would be replayed already expired.
 */
export function serializeDocument(
  record: VerificationDocumentRecord,
): Record<string, unknown> {
  return {
    document_id: record.documentId,
    membership_id: record.membershipId,
    organization_id: record.organizationId,
    object_id: record.objectId,
    document_kind: record.documentKind,
    status: record.status,
    submitted_at: record.submittedAt.toISOString(),
    reviewed_at: record.reviewedAt?.toISOString() ?? null,
    reviewer_profile_id: record.reviewerProfileId,
    reason_code: record.reasonCode,
    expires_at: record.expiresAt?.toISOString() ?? null,
    object_key: record.objectKey,
    content_type: record.contentType,
    byte_size: record.byteSize,
    declared_sha256: record.declaredSha256,
    verified_sha256: record.verifiedSha256,
    upload_state: record.uploadState,
    scan_state: record.scanState,
    downloadable: record.downloadable,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

/**
 * One projection for every document read, so a list row, a locked row and a
 * replayed row cannot describe the document differently.
 *
 * The reviewer's PROFILE is derived by subquery: `verification_documents` stores
 * only `reviewed_by_membership_id`, and the durable reviewer identity lives in
 * `verification_reviews`. Exposing the profile here saves every caller from
 * resolving the membership itself.
 */
function documentProjection(): string {
  return `SELECT document.document_id AS "documentId",
   document.membership_id AS "membershipId",
   document.organization_id AS "organizationId",
   membership.profile_id AS "profileId",
   membership.role_id AS "roleId",
   membership.verification_status AS "membershipVerificationStatus",
   document.object_id AS "objectId",
   document.document_kind AS "documentKind",
   document.status,
   document.submitted_at AS "submittedAt",
   document.reviewed_at AS "reviewedAt",
   document.reviewed_by_membership_id AS "reviewerMembershipId",
   (SELECT reviewer.profile_id FROM organization_memberships AS reviewer
    WHERE reviewer.membership_id = document.reviewed_by_membership_id)
     AS "reviewerProfileId",
   document.review_decision_reason AS "reasonCode",
   document.expires_at AS "expiresAt",
   document.version,
   document.created_at AS "createdAt", document.updated_at AS "updatedAt",
   object.object_key AS "objectKey",
   object.media_type AS "contentType",
   object.byte_size AS "byteSize",
   object.declared_sha256 AS "declaredSha256",
   object.verified_sha256 AS "verifiedSha256",
   object.upload_status AS "uploadState",
   object.scan_state AS "scanState",
   object.downloadable,
   object.quarantined_at AS "quarantinedAt",
   object.retention_expires_at AS "retentionExpiresAt"
   FROM verification_documents AS document
   JOIN organization_memberships AS membership
     ON membership.membership_id = document.membership_id
   JOIN stored_objects AS object ON object.object_id = document.object_id`;
}

/**
 * Row to record. Written out field by field rather than spread, because
 * `QueryResultRow` carries an untyped index signature: a spread would let a
 * renamed alias pass unnoticed instead of failing the type check.
 */
function mapDocument(row: DocumentRow): VerificationDocumentRecord {
  return {
    documentId: row.documentId,
    membershipId: row.membershipId,
    organizationId: row.organizationId,
    profileId: row.profileId,
    roleId: row.roleId,
    membershipVerificationStatus: row.membershipVerificationStatus,
    objectId: row.objectId,
    documentKind: row.documentKind,
    status: row.status,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewerMembershipId: row.reviewerMembershipId,
    reviewerProfileId: row.reviewerProfileId,
    reasonCode: row.reasonCode,
    expiresAt: row.expiresAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    objectKey: row.objectKey,
    contentType: row.contentType,
    // `stored_objects.byte_size` is a bigint, and the driver returns bigints as
    // strings so a value beyond IEEE-754 range cannot be silently rounded.
    // Upload sizes are capped far below `Number.MAX_SAFE_INTEGER`, so narrowing
    // here is safe and gives callers arithmetic they can actually use.
    byteSize: Number(row.byteSize),
    declaredSha256: row.declaredSha256,
    verifiedSha256: row.verifiedSha256,
    uploadState: row.uploadState,
    scanState: row.scanState,
    downloadable: row.downloadable,
    quarantinedAt: row.quarantinedAt,
    retentionExpiresAt: row.retentionExpiresAt,
  };
}

/**
 * Scope for the shared idempotency helpers. Structural on purpose: the request
 * and finalize inputs both carry these three fields and nothing else about them
 * is relevant to key identity.
 */
function idempotencyScope(
  input: {
    readonly actorProfileId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  },
  organizationId: string,
  operationId: string,
): IdempotencyScope {
  return {
    organizationId,
    actorProfileId: input.actorProfileId,
    operationId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
  };
}

/**
 * Replays the stored upload response verbatim. Deliberately does not read the
 * document again: a replay must reproduce the ORIGINAL outcome even if the
 * document has since been re-pointed at a new object, reviewed or suspended.
 */
function resolveUploadIdempotency(
  scope: IdempotencyScope,
  existing: IdempotencyRecord,
): RequestVerificationUploadResult {
  if (existing.requestHash !== scope.requestHash) return 'idempotency_reused';
  // `processing` means the original request is still in flight or died holding
  // the key: there is no response to replay, so this is a reuse error.
  if (existing.state !== 'completed') return 'idempotency_reused';
  const body = existing.responseBody;
  if (
    existing.responseStatus === null || body === null || body['document_id'] === undefined
  ) return 'idempotency_reused';
  return { snapshot: { status: existing.responseStatus, body }, replayed: true };
}

/**
 * Replays the stored finalize response verbatim, with the same no-reload rule as
 * the upload path. A stored 409 is replayed as the checksum rejection it was:
 * the original request DID reach a decision, and reporting key reuse instead
 * would hide it. This mirrors how `MembershipRepository.resolveIdempotency`
 * replays its own stored conflict.
 */
function resolveFinalizeIdempotency(
  scope: IdempotencyScope,
  existing: IdempotencyRecord,
): FinalizeVerificationDocumentResult {
  if (existing.requestHash !== scope.requestHash) return 'idempotency_reused';
  if (existing.state !== 'completed') return 'idempotency_reused';
  if (existing.responseStatus === 409) return 'checksum_mismatch';
  const body = existing.responseBody;
  if (
    existing.responseStatus === null || body === null || body['document_id'] === undefined
  ) return 'idempotency_reused';
  return { snapshot: { status: existing.responseStatus, body }, replayed: true };
}

/**
 * Identical to the helper in `membership-repository.ts`: only these four roles
 * are gated on professional verification. A patient has nothing to verify, and
 * administrators are appointed rather than verified.
 */
function requiresVerification(roleId: string): boolean {
  return roleId === 'doctor' || roleId === 'driver' ||
    roleId === 'pharmacy' || roleId === 'emergency';
}

/**
 * The total reviewer transition table.
 *
 * `rejected` and `expired` are TERMINAL: a rejected or lapsed licence is
 * re-established by submitting a new document, which `requestUpload` returns to
 * `pending_review`, not by editing the old decision. `changes_requested` does not
 * lead back to `pending_review` here for the same reason - a resubmission is what
 * moves it, and a reviewer silently un-requesting their own change request would
 * leave the applicant's outstanding action unexplained.
 */
function transitionAllowed(
  current: VerificationDocumentStatus,
  next: ReviewableVerificationStatus,
): boolean {
  switch (current) {
    case 'pending_review':
      return next === 'changes_requested' || next === 'approved' || next === 'rejected';
    case 'changes_requested':
      return next === 'approved' || next === 'rejected';
    case 'approved':
      return next === 'suspended' || next === 'expired';
    case 'suspended':
      return next === 'approved' || next === 'rejected';
    // `not_submitted` describes a membership with no document at all, so no row
    // ever rests there; `rejected` and `expired` are terminal.
    case 'not_submitted':
    case 'rejected':
    case 'expired':
      return false;
  }
}

/** Audit action suffix naming the decision that was taken. */
function reviewAction(next: ReviewableVerificationStatus): string {
  switch (next) {
    case 'changes_requested': return 'changes_requested';
    case 'approved': return 'approved';
    case 'rejected': return 'rejected';
    case 'suspended': return 'suspended';
    case 'expired': return 'expired';
  }
}
