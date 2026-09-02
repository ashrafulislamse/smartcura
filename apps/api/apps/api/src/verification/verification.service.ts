import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  serializeDocument,
  VerificationRepository,
  type ActorAuthorizationContext,
  type FinalizeVerificationDocumentResult,
  type RequestVerificationUploadResult,
  type TransitionVerificationDocumentResult,
  type VerificationDocumentRecord,
} from '@smartcura/database';
import { createUuidV7 } from '@smartcura/observability';
import { evaluatePermission } from '@smartcura/policy';
import {
  assertObjectKey,
  ObjectStorageRequestError,
  supportsPrivateFilePipeline,
  type ObjectStorageProvider,
  type PresignedObjectOperation,
  type PrivateFileStorageProvider,
} from '@smartcura/storage';
import type { ApiConfig } from '../config.js';
import { correlationId, validationFailed } from '../platform/problems.js';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { API_CONFIG, OBJECT_STORAGE } from '../tokens.js';
import {
  finalizeVerificationDocumentSchema,
  idempotencyKeySchema,
  listVerificationDocumentsQuerySchema,
  membershipDocumentPathSchema,
  organizationDocumentPathSchema,
  requestVerificationUploadSchema,
  transitionVerificationDocumentSchema,
} from './verification-request.schemas.js';

/** Replay window for a verification `Idempotency-Key`, matching memberships. */
const IDEMPOTENCY_TTL_MS = 86_400_000;

/** Submit a verification document for your own membership. */
const SUBMIT_OWN = 'verification.document:submit:own';
/** Read your own verification documents and their status. */
const READ_OWN = 'verification.document:read:own';

/**
 * Permission ids are the ones migrations 0011/0012 already seeded under the
 * canonical `resource.subresource:action:scope` naming. No new vocabulary is
 * introduced here: 0012 records the decision explicitly, because two permission
 * ids for one capability leave every role holding a grant nobody can explain.
 */
function reviewerPermission(
  roleId: string,
  action: 'read' | 'review',
): string {
  return roleId === 'super_admin'
    ? `verification.document:${action}:global`
    : `verification.document:${action}:organization`;
}

/**
 * Membership statuses from which a professional may still submit evidence.
 *
 * `applied` and `invited` are the point of the endpoint: a doctor cannot be
 * activated until verification is approved, so requiring an already-active
 * membership would make the whole workflow unreachable. `suspended` and
 * `revoked` are excluded: a membership under administrative sanction is not a
 * membership whose evidence the platform is waiting on, and re-establishing it is
 * an administrative decision, not a file upload.
 */
function maySubmit(status: string): boolean {
  return status === 'applied' || status === 'invited' || status === 'active';
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly documents: VerificationRepository,
    private readonly authorization: SessionAuthorizationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageProvider,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /**
   * The documents of one membership.
   *
   * Two distinct authorities reach this: the owner through
   * `verification.document:read:own`, and a reviewer through their organization
   * (or platform) authority. A caller holding neither is answered 404, never 403,
   * because a 403 would confirm that the membership exists - which is itself a
   * fact about a person.
   */
  async list(
    current: AuthenticatedSession,
    membershipIdValue: string,
    queryValue: unknown,
  ): Promise<Record<string, unknown>> {
    const membershipId = parsePath({ membershipId: membershipIdValue }).membershipId;
    const query = parseListQuery(queryValue);
    // Same profile gate as the write routes. A suspended profile keeps a live
    // session until its next expiry, and this read exposes storage keys and
    // review decisions, so it is not the place to be more permissive than
    // submission is.
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, 'verification.document.list',
        403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete',
      );
    }
    const context = await this.documents.loadMembershipContext(membershipId);
    const active = activeMembership(current);
    const owner = context !== undefined &&
      context.profileId === current.aggregate.profile.profileId &&
      evaluatePermission(membershipPermissions(current, membershipId), READ_OWN, {
        actorProfileId: current.aggregate.profile.profileId,
        ownerProfileId: context.profileId,
      }).allowed;
    const reviewer = context !== undefined && active !== undefined &&
      active.status === 'active' &&
      (active.roleId === 'admin' || active.roleId === 'super_admin') &&
      evaluatePermission(active.permissions, reviewerPermission(active.roleId, 'read'), {
        actorProfileId: current.aggregate.profile.profileId,
        membershipOrganizationId: active.organizationId,
        resourceOrganizationId: context.organizationId,
        globalAllowed: active.roleId === 'super_admin',
      }).allowed;
    if (context === undefined || (!owner && !reviewer)) {
      return this.deny(
        current, 'verification.document.list',
        404, 'RESOURCE_NOT_FOUND', 'Verification documents were not found',
      );
    }
    // Touch refreshes the session's idle window and re-reads the aggregate, so a
    // read authorised a moment ago cannot be served on a session revoked since.
    await this.authorization.touch(current);
    const records = await this.documents.list({
      membershipId,
      limit: query.page_size,
    });
    return { data: records.map(documentResponse) };
  }

  /**
   * Reads one verification document by id.
   *
   * Same dual authority as `list`: the owner through
   * `verification.document:read:own`, and a reviewer through their organization
   * (or platform) authority. A caller holding neither is answered 404, never 403,
   * because confirming that a document exists is itself a fact about a person.
   * Every refusal is audited through the session denial log, matching `list`.
   */
  async get(
    current: AuthenticatedSession,
    membershipIdValue: string,
    documentIdValue: string,
  ): Promise<Record<string, unknown>> {
    const path = parsePath({ membershipId: membershipIdValue, documentId: documentIdValue });
    const membershipId = path.membershipId;
    const documentId = path.documentId!;
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, 'verification.document.read',
        403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete',
      );
    }
    const context = await this.documents.loadMembershipContext(membershipId);
    const active = activeMembership(current);
    const owner = context !== undefined &&
      context.profileId === current.aggregate.profile.profileId &&
      evaluatePermission(membershipPermissions(current, membershipId), READ_OWN, {
        actorProfileId: current.aggregate.profile.profileId,
        ownerProfileId: context.profileId,
      }).allowed;
    const reviewer = context !== undefined && active !== undefined &&
      active.status === 'active' &&
      (active.roleId === 'admin' || active.roleId === 'super_admin') &&
      evaluatePermission(active.permissions, reviewerPermission(active.roleId, 'read'), {
        actorProfileId: current.aggregate.profile.profileId,
        membershipOrganizationId: active.organizationId,
        resourceOrganizationId: context.organizationId,
        globalAllowed: active.roleId === 'super_admin',
      }).allowed;
    if (context === undefined || (!owner && !reviewer)) {
      return this.deny(
        current, 'verification.document.read',
        404, 'RESOURCE_NOT_FOUND', 'Verification document was not found',
      );
    }
    await this.authorization.touch(current);
    const record = await this.documents.findAuthorized(documentId, membershipId);
    if (record === undefined) {
      return this.deny(
        current, 'verification.document.read',
        404, 'RESOURCE_NOT_FOUND', 'Verification document was not found',
      );
    }
    return documentResponse(record);
  }

  /**
   * Reserves the document row and mints a short-lived upload capability.
   *
   * The actor must OWN the membership, so the actor context is `self`: there is no
   * administrative membership to name and no step-up to prove, only a live session
   * belonging to an active, onboarded profile. Ownership is checked here for a fast
   * rejection and re-proved by the repository under lock, because the membership
   * can be revoked between this check and the write.
   */
  async requestUpload(
    current: AuthenticatedSession,
    membershipIdValue: string,
    idempotencyKeyValue: string | undefined,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const membershipId = parsePath({ membershipId: membershipIdValue }).membershipId;
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyValue);
    const request = parseRequestUpload(bodyValue);
    const storage = await this.requirePrivateFileStorage(
      current, 'verification.document.request',
    );
    const context = await this.requireOwnMembership(
      current, membershipId, 'verification.document.request',
    );
    const authorized = await this.authorization.touch(current);
    // The key is derived server-side from the organization, the membership and a
    // fresh uuidv7. A client-supplied key would be a direct route into another
    // tenant's prefix, and the id keeps a retry from overwriting the bytes of an
    // earlier attempt that is still under investigation.
    const objectKey = verificationObjectKey(
      context.organizationId, membershipId, request.document_kind,
    );
    const result = await this.documents.requestUpload({
      membershipId,
      actorProfileId: authorized.aggregate.profile.profileId,
      actor: selfActor(authorized),
      documentKind: request.document_kind,
      contentType: request.content_type,
      byteSize: request.byte_size,
      declaredSha256: request.declared_sha256,
      storageProvider: storage.providerName,
      bucket: storage.bucket,
      objectKey,
      documentExpiresAt: request.document_expires_at === undefined ||
        request.document_expires_at === null
        ? null
        : new Date(request.document_expires_at),
      // NULL means "no scheduled expiry yet", which is what migration 0012
      // documents. Inventing a retention period here would commit the platform to
      // a deletion date for identity evidence that no reviewed retention policy
      // has agreed, and the retention sweeper - not this route - owns disposal.
      retentionExpiresAt: null,
      idempotencyKey,
      // The generated object key is deliberately NOT part of the fingerprint: it
      // is fresh on every call, so including it would make every replay look like
      // a different request and defeat the key entirely.
      requestHash: requestFingerprint({ membership_id: membershipId, ...request }),
      idempotencyTtlMs: IDEMPOTENCY_TTL_MS,
      now: new Date(),
      correlationId: correlationId(),
    });
    return this.requestUploadResult(authorized, storage, result);
  }

  /**
   * Confirms the uploaded bytes are the bytes the platform was promised.
   *
   * The store's own digest is fetched here because the repository cannot reach the
   * object store from inside a transaction. A key the store does not know, or one
   * it holds without a checksum, arrives as `undefined` and the repository treats
   * that as a mismatch rather than a pass - a client-reported digest alone proves
   * nothing.
   */
  async finalize(
    current: AuthenticatedSession,
    membershipIdValue: string,
    documentIdValue: string,
    idempotencyKeyValue: string | undefined,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const path = parsePath({
      membershipId: membershipIdValue,
      documentId: documentIdValue,
    });
    const documentId = path.documentId!;
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyValue);
    const request = parseFinalize(bodyValue);
    const storage = await this.requirePrivateFileStorage(
      current, 'verification.document.finalize',
    );
    // Both halves of the URL are proved to belong to the actor: the membership by
    // `requireOwnMembership`, and the document by `loadOwnDocumentContext`, which
    // joins through the owning membership and therefore cannot be used as an
    // existence oracle for somebody else's document.
    await this.requireOwnMembership(
      current, path.membershipId, 'verification.document.finalize',
    );
    const document = await this.documents.loadOwnDocumentContext(
      documentId, current.aggregate.profile.profileId,
    );
    if (document === undefined) {
      return this.deny(
        current, 'verification.document.finalize',
        404, 'RESOURCE_NOT_FOUND', 'Verification document was not found',
      );
    }
    const authorized = await this.authorization.touch(current);
    const stat = await this.statObject(authorized, storage.provider, document.objectKey);
    const result = await this.documents.finalize({
      documentId,
      actorProfileId: authorized.aggregate.profile.profileId,
      actor: selfActor(authorized),
      reportedSha256: request.reported_sha256,
      storedSha256: stat?.sha256,
      storedByteSize: stat?.size,
      idempotencyKey,
      requestHash: requestFingerprint({ document_id: documentId, ...request }),
      idempotencyTtlMs: IDEMPOTENCY_TTL_MS,
      now: new Date(),
      correlationId: correlationId(),
    });
    return this.finalizeResult(authorized, result);
  }

  /**
   * The reviewer's decision.
   *
   * Administrative, so the actor context is `administrative` and carries the
   * review permission plus `requireStepUp`, exactly as `MembershipsService`
   * builds it: the repository re-proves the membership, the grant and the step-up
   * under lock, because all three can lapse between the guard and the write. The
   * step-up is also checked here so an expired one is refused before any
   * document state is read.
   */
  async review(
    current: AuthenticatedSession,
    organizationIdValue: string,
    documentIdValue: string,
    bodyValue: unknown,
  ): Promise<Record<string, unknown>> {
    const path = parseOrganizationPath({
      organizationId: organizationIdValue,
      documentId: documentIdValue,
    });
    const request = parseTransition(bodyValue);
    const active = await this.authorizeReviewer(current, path.organizationId);
    if (
      current.aggregate.session.stepUpValidUntil === null ||
      current.aggregate.session.stepUpValidUntil <= new Date()
    ) {
      return this.deny(
        current, 'verification.document.review',
        403, 'STEP_UP_REQUIRED', 'A current MFA step-up is required',
      );
    }
    // The document must live in the organization the URL names. Without this a
    // reviewer could pass their own organization in the path and a document from
    // another one in the body position, and the repository would resolve the
    // organization from the document rather than from the authority just proved.
    const organizationId = await this.documents.loadDocumentOrganization(path.documentId);
    if (organizationId !== path.organizationId) {
      return this.deny(
        current, 'verification.document.review',
        404, 'RESOURCE_NOT_FOUND', 'Verification document was not found',
      );
    }
    const authorized = await this.authorization.touch(current);
    const result = await this.documents.transition({
      documentId: path.documentId,
      actorProfileId: authorized.aggregate.profile.profileId,
      actorRoleId: active.roleId === 'super_admin' ? 'super_admin' : 'admin',
      actor: administrativeActor(authorized, active.membershipId, active.roleId),
      nextStatus: request.status,
      expectedVersion: request.expected_version,
      reasonCode: request.reason_code,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result !== 'string') return documentResponse(result);
    return this.reviewFailure(authorized, result);
  }

  /**
   * Narrows the configured provider to one that can run the private file
   * pipeline, or refuses the request.
   *
   * The deterministic in-memory adapter has no signing capability by design, so a
   * deployment configured for it cannot serve these routes. The two alternatives
   * are both worse than a 503: fabricating a URL would hand the client a
   * capability that leads nowhere, and streaming the bytes through the API would
   * put private identity evidence in the request path of every API worker. The
   * storage factory documents this rule and `loadObjectStorageConfig` forbids the
   * memory provider in production, so this is a misconfiguration, not a live
   * outage.
   */
  private async requirePrivateFileStorage(
    current: AuthenticatedSession,
    action: string,
  ): Promise<{
    readonly provider: PrivateFileStorageProvider;
    readonly providerName: string;
    readonly bucket: string;
  }> {
    const storage = this.config.objectStorage;
    if (storage.provider !== 'r2' || !supportsPrivateFilePipeline(this.storage)) {
      return this.deny(
        current, action, 503, 'DEPENDENCY_UNAVAILABLE',
        'Private file storage is not configured for verification uploads',
      );
    }
    return {
      provider: this.storage,
      providerName: storage.provider,
      bucket: storage.bucket,
    };
  }

  /**
   * Stats the uploaded object. A transport failure is reported as a dependency
   * problem rather than a checksum mismatch: "the store could not be reached" and
   * "the bytes are wrong" are different facts, and recording the second when the
   * first happened would reject a legitimate submission permanently.
   */
  private async statObject(
    current: AuthenticatedSession,
    provider: PrivateFileStorageProvider,
    objectKey: string,
  ): Promise<{ readonly sha256: string | undefined; readonly size: number } | undefined> {
    try {
      const head = await provider.headObject(objectKey);
      return head === undefined ? undefined : { sha256: head.sha256, size: head.size };
    } catch (error) {
      if (error instanceof ObjectStorageRequestError) {
        return this.deny(
          current, 'verification.document.finalize',
          503, 'DEPENDENCY_UNAVAILABLE', 'Object storage is unavailable',
        );
      }
      throw error;
    }
  }

  /**
   * Proves the target membership is the actor's own and that the actor holds the
   * submission grant for it. The permissions come from the TARGET membership, not
   * from whichever membership the session currently has selected: an applied
   * doctor is submitting evidence precisely because that membership is not active
   * yet, and the `own` scope is what constrains the grant.
   */
  private async requireOwnMembership(
    current: AuthenticatedSession,
    membershipId: string,
    action: string,
  ): Promise<{ readonly organizationId: string; readonly profileId: string }> {
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, action, 403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete',
      );
    }
    const context = await this.documents.loadMembershipContext(membershipId);
    const held = current.aggregate.memberships.find(
      (membership) => membership.membershipId === membershipId,
    );
    // A membership belonging to somebody else is reported as absent, so a
    // submission route cannot be used to discover another profile's memberships.
    if (
      context === undefined || held === undefined ||
      context.profileId !== current.aggregate.profile.profileId ||
      !maySubmit(held.status)
    ) {
      return this.deny(
        current, action, 404, 'RESOURCE_NOT_FOUND', 'Membership was not found',
      );
    }
    const decision = evaluatePermission(held.permissions, SUBMIT_OWN, {
      actorProfileId: current.aggregate.profile.profileId,
      ownerProfileId: context.profileId,
    });
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, action, 403, code, 'Submitting verification documents is not permitted',
      );
    }
    return context;
  }

  /**
   * Deny-by-default reviewer check: an active administrative membership holding
   * the review grant at the scope its role is entitled to. An organization
   * administrator is confined to their own organization by the `organization`
   * scope; only a platform administrator reaches `global`.
   */
  private async authorizeReviewer(
    current: AuthenticatedSession,
    organizationId: string,
  ): Promise<{ readonly membershipId: string; readonly roleId: string }> {
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      return this.deny(
        current, 'verification.document.review',
        403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete',
      );
    }
    const active = activeMembership(current);
    if (
      active === undefined || active.status !== 'active' ||
      (active.roleId !== 'admin' && active.roleId !== 'super_admin')
    ) {
      return this.deny(
        current, 'verification.document.review',
        403, 'PERMISSION_DENIED', 'Verification review is not permitted',
      );
    }
    const decision = evaluatePermission(
      active.permissions,
      reviewerPermission(active.roleId, 'review'),
      {
        actorProfileId: current.aggregate.profile.profileId,
        membershipOrganizationId: active.organizationId,
        resourceOrganizationId: organizationId,
        globalAllowed: active.roleId === 'super_admin',
      },
    );
    if (!decision.allowed) {
      const code = decision.reason === 'object_policy_denied'
        ? 'OBJECT_ACCESS_DENIED'
        : 'PERMISSION_DENIED';
      return this.deny(
        current, 'verification.document.review',
        403, code, 'Verification review is not permitted',
      );
    }
    return { membershipId: active.membershipId, roleId: active.roleId };
  }

  /**
   * Maps the upload outcome, including the replay case.
   *
   * A replay reproduces the stored document body verbatim but mints a FRESH
   * upload capability for the same object key: the stored snapshot deliberately
   * holds no URL, because a pre-signed URL is time-bounded and a replayed one
   * would already have expired.
   */
  private async requestUploadResult(
    current: AuthenticatedSession,
    storage: { readonly provider: PrivateFileStorageProvider },
    result: RequestVerificationUploadResult,
  ): Promise<Record<string, unknown>> {
    if (typeof result !== 'string') {
      const document = result.replayed
        ? result.snapshot.body
        : documentResponse(result.record);
      const target = await this.mintUploadTarget(current, storage.provider, document);
      return { document, upload: target };
    }
    const action = 'verification.document.request';
    switch (result) {
      case 'membership_not_found':
        return this.deny(
          current, action, 404, 'RESOURCE_NOT_FOUND', 'Membership was not found',
        );
      // Not a 404: the caller owns this membership, so the reason the submission
      // is refused is a fact about their own role, not a concealed resource.
      case 'role_not_verifiable':
        return this.deny(
          current, action, 422, 'VALIDATION_FAILED',
          'This membership role has nothing to verify',
        );
      case 'document_awaiting_review':
        return this.deny(
          current, action, 409, 'VERIFICATION_DOCUMENT_AWAITING_REVIEW',
          'A document of this kind is already awaiting review',
        );
      case 'idempotency_reused':
        return this.deny(
          current, action, 409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused',
        );
      default:
        return this.actorFailure(current, action, result);
    }
  }

  private async finalizeResult(
    current: AuthenticatedSession,
    result: FinalizeVerificationDocumentResult,
  ): Promise<Record<string, unknown>> {
    if (typeof result !== 'string') {
      return result.replayed ? result.snapshot.body : documentResponse(result.record);
    }
    const action = 'verification.document.finalize';
    switch (result) {
      case 'not_found':
        return this.deny(
          current, action, 404, 'RESOURCE_NOT_FOUND', 'Verification document was not found',
        );
      case 'already_finalized':
        return this.deny(
          current, action, 409, 'VERIFICATION_DOCUMENT_ALREADY_FINALIZED',
          'Verification document is already finalized',
        );
      // Its own code, not a generic conflict: this is the one outcome that says
      // the stored bytes are not the bytes that were promised. A client cannot
      // retry its way out of it - the object is terminally rejected and a new
      // upload must be requested - and an integrity investigation needs the
      // distinction preserved in the audit trail.
      case 'checksum_mismatch':
        return this.deny(
          current, action, 409, 'OBJECT_CHECKSUM_MISMATCH',
          'Uploaded bytes do not match the declared checksum',
        );
      case 'idempotency_reused':
        return this.deny(
          current, action, 409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused',
        );
      default:
        return this.actorFailure(current, action, result);
    }
  }

  private async reviewFailure(
    current: AuthenticatedSession,
    result: Exclude<TransitionVerificationDocumentResult, VerificationDocumentRecord>,
  ): Promise<never> {
    const action = 'verification.document.review';
    switch (result) {
      case 'not_found':
        return this.deny(
          current, action, 404, 'RESOURCE_NOT_FOUND', 'Verification document was not found',
        );
      case 'version_conflict':
        return this.deny(
          current, action, 409, 'VERIFICATION_DOCUMENT_VERSION_CONFLICT',
          'Verification document version is stale',
        );
      // 409, not 422: the request is well formed, and whether the transition is
      // allowed depends on state the client cannot see - the current status, the
      // upload state and the malware verdict.
      case 'transition_invalid':
        return this.deny(
          current, action, 409, 'VERIFICATION_DOCUMENT_TRANSITION_INVALID',
          'Verification document transition is invalid',
        );
      // 422, not 409: the reason code and the status contradict each other in the
      // body itself, which is a fact about the request rather than about state.
      case 'reason_code_invalid':
        return this.deny(
          current, action, 422, 'VALIDATION_FAILED',
          'Reason code does not match the requested status',
        );
      case 'self_review_denied':
        return this.deny(
          current, action, 403, 'VERIFICATION_SELF_REVIEW_DENIED',
          'Reviewing your own verification document is not permitted',
        );
      case 'document_not_verifiable':
        return this.deny(
          current, action, 422, 'VALIDATION_FAILED',
          'This membership role has nothing to verify',
        );
      default:
        return this.actorFailure(current, action, result);
    }
  }

  private async actorFailure(
    current: AuthenticatedSession,
    action: string,
    result: 'actor_session_invalid' | 'actor_permission_denied' | 'actor_step_up_required',
  ): Promise<never> {
    switch (result) {
      case 'actor_session_invalid':
        return this.deny(
          current, action, 401, 'APP_SESSION_INVALID', 'The session is no longer valid',
        );
      case 'actor_permission_denied':
        return this.deny(
          current, action, 403, 'PERMISSION_DENIED', 'Access is not permitted',
        );
      case 'actor_step_up_required':
        return this.deny(
          current, action, 403, 'STEP_UP_REQUIRED', 'A current MFA step-up is required',
        );
    }
  }

  /**
   * Mints the upload capability for the object the document points at.
   *
   * The declared digest is bound into the signature, so the STORE refuses bytes
   * that hash to anything else - the platform never has to trust the client's
   * later report on its own.
   */
  private async mintUploadTarget(
    current: AuthenticatedSession,
    provider: PrivateFileStorageProvider,
    document: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const objectKey = document['object_key'];
    const contentType = document['content_type'];
    const declaredSha256 = document['declared_sha256'];
    if (
      typeof objectKey !== 'string' || typeof contentType !== 'string' ||
      typeof declaredSha256 !== 'string'
    ) {
      throw new Error('Verification document response is missing its object metadata');
    }
    try {
      const operation = await provider.createPresignedUploadUrl({
        key: objectKey,
        contentType,
        expectedSha256: declaredSha256,
      });
      return uploadTargetResponse(operation);
    } catch (error) {
      if (error instanceof ObjectStorageRequestError) {
        return this.deny(
          current, 'verification.document.request',
          503, 'DEPENDENCY_UNAVAILABLE', 'Object storage is unavailable',
        );
      }
      throw error;
    }
  }

  /**
   * Single denial path. `VerificationRepository` exposes no denial writer and is
   * not modified here, so refusals are audited through the session denial log,
   * which is the platform-wide record every guard already writes to.
   */
  private async deny(
    current: AuthenticatedSession,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    return this.authorization.deny(current, action, status, code, title);
  }
}

function activeMembership(current: AuthenticatedSession) {
  return current.aggregate.memberships.find(
    (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
  );
}

/** Permissions carried by a specific membership of the authenticated profile. */
function membershipPermissions(
  current: AuthenticatedSession,
  membershipId: string,
): readonly string[] {
  return current.aggregate.memberships.find(
    (membership) => membership.membershipId === membershipId,
  )?.permissions ?? [];
}

function selfActor(authorized: AuthenticatedSession): ActorAuthorizationContext {
  return {
    kind: 'self',
    sessionId: authorized.aggregate.session.sessionId,
    tokenHash: authorized.tokenHash,
  };
}

function administrativeActor(
  authorized: AuthenticatedSession,
  membershipId: string,
  roleId: string,
): ActorAuthorizationContext {
  return {
    kind: 'administrative',
    sessionId: authorized.aggregate.session.sessionId,
    tokenHash: authorized.tokenHash,
    membershipId,
    requiredPermission: reviewerPermission(roleId, 'review'),
    // A verification decision changes who the platform lets practise, so it sits
    // in the same class as a membership transition: a current MFA step-up is
    // required and re-proved inside the write transaction.
    requireStepUp: true,
  };
}

/**
 * Opaque, tenant-prefixed key. It carries generated ids only - never a name,
 * email or IC number - because a key appears in signed URLs and remote logs,
 * while PostgreSQL owns the mapping from a key back to a person.
 */
function verificationObjectKey(
  organizationId: string,
  membershipId: string,
  documentKind: string,
): string {
  const key = `verification/${organizationId}/${membershipId}/${documentKind}/${createUuidV7()}`;
  assertObjectKey(key);
  return key;
}

/** The document projection is the repository's, so a replay cannot differ. */
function documentResponse(record: VerificationDocumentRecord): Record<string, unknown> {
  return serializeDocument(record);
}

/**
 * The upload capability. `url` carries the signature, which is why every
 * verification response is `no-store`: a shared cache holding this would be
 * handing out the capability itself.
 */
function uploadTargetResponse(operation: PresignedObjectOperation): Record<string, unknown> {
  return {
    method: operation.method,
    url: operation.url.toString(),
    expires_at: operation.expiresAt.toISOString(),
    required_headers: { ...operation.requiredHeaders },
  };
}

function parsePath(value: unknown) {
  const result = membershipDocumentPathSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseOrganizationPath(value: unknown) {
  const result = organizationDocumentPathSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseListQuery(value: unknown) {
  const result = listVerificationDocumentsQuerySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseIdempotencyKey(value: unknown): string {
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseRequestUpload(value: unknown) {
  const result = requestVerificationUploadSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseFinalize(value: unknown) {
  const result = finalizeVerificationDocumentSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseTransition(value: unknown) {
  const result = transitionVerificationDocumentSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

/**
 * Request fingerprint for the idempotency key. An absent optional key and an
 * explicit null must fingerprint identically, otherwise a client that omits
 * `document_expires_at` on the retry would be told its key was reused.
 */
function requestFingerprint(value: Record<string, unknown>): string {
  const normalized = Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, entry === undefined ? null : entry] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
