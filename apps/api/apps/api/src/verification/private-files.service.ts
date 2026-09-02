import { Injectable } from '@nestjs/common';
import {
  PrivateFileRepository,
  type VerificationFileDownloadContext,
} from '@smartcura/database';
import { evaluatePermission } from '@smartcura/policy';
import {
  ObjectStorageRequestError,
  supportsPrivateFilePipeline,
  type ObjectStorageProvider,
  type PresignedObjectOperation,
  type PrivateFileStorageProvider,
} from '@smartcura/storage';
import type { ApiConfig } from '../config.js';
import {
  type AuthenticatedSession,
  SessionAuthorizationService,
} from '../platform/request-authorization.js';
import { membershipDocumentPathSchema } from './verification-request.schemas.js';
import { validationFailed } from '../platform/problems.js';

const DOWNLOAD_EXPIRY_SECONDS = 60;

@Injectable()
export class PrivateFilesService {
  constructor(
    private readonly files: PrivateFileRepository,
    private readonly authorization: SessionAuthorizationService,
    private readonly storage: ObjectStorageProvider,
    private readonly config: ApiConfig,
  ) {}

  async downloadVerificationDocument(
    current: AuthenticatedSession,
    membershipIdValue: string,
    documentIdValue: string,
  ): Promise<Record<string, unknown>> {
    const parsed = membershipDocumentPathSchema.safeParse({
      membershipId: membershipIdValue,
      documentId: documentIdValue,
    });
    if (!parsed.success || parsed.data.documentId === undefined) throw validationFailed();

    const authorized = await this.authorization.touch(current);
    const context = await this.files.loadVerificationDownload(
      parsed.data.membershipId, parsed.data.documentId,
    );
    if (context === undefined || !verificationFileAccessAllowed(authorized, context)) {
      return this.deny(
        authorized, 404, 'RESOURCE_NOT_FOUND', 'Verification document was not found',
      );
    }
    if (
      !context.downloadable || context.uploadState !== 'finalized' ||
      context.scanState !== 'clean' || context.verifiedSha256 === null
    ) {
      return this.deny(
        authorized, 409, 'OBJECT_NOT_DOWNLOADABLE',
        'Verification document file is not available for download',
      );
    }
    if (this.config.objectStorage.provider !== 'r2' || !supportsPrivateFilePipeline(this.storage)) {
      return this.deny(
        authorized, 503, 'DEPENDENCY_UNAVAILABLE', 'Private file storage is unavailable',
      );
    }
    const operation = await this.mint(authorized, this.storage, context.objectKey);
    return {
      object: {
        object_id: context.objectId,
        content_type: context.contentType,
        byte_size: context.byteSize,
        sha256: context.verifiedSha256,
      },
      download: operationResponse(operation),
    };
  }

  private async mint(
    current: AuthenticatedSession,
    provider: PrivateFileStorageProvider,
    objectKey: string,
  ): Promise<PresignedObjectOperation> {
    try {
      return await provider.createPresignedDownloadUrl(objectKey, DOWNLOAD_EXPIRY_SECONDS);
    } catch (error) {
      if (error instanceof ObjectStorageRequestError) {
        return this.deny(
          current, 503, 'DEPENDENCY_UNAVAILABLE', 'Private file storage is unavailable',
        );
      }
      throw error;
    }
  }

  private async deny(
    current: AuthenticatedSession,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    return this.authorization.deny(current, 'file.object.download', status, code, title);
  }
}

export function verificationFileAccessAllowed(
  current: AuthenticatedSession,
  context: VerificationFileDownloadContext,
): boolean {
  if (
    current.aggregate.profile.status !== 'active' ||
    current.aggregate.profile.onboardingCompletedAt === null
  ) return false;

  if (context.ownerProfileId === current.aggregate.profile.profileId) {
    const target = current.aggregate.memberships.find(
      (membership) => membership.membershipId === context.membershipId,
    );
    return target !== undefined && evaluatePermission(
      target.permissions,
      'file.object:read:own',
      {
        actorProfileId: current.aggregate.profile.profileId,
        ownerProfileId: context.ownerProfileId,
      },
    ).allowed;
  }

  const active = current.aggregate.memberships.find(
    (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
  );
  if (active === undefined || active.status !== 'active') return false;
  const permission = active.roleId === 'super_admin'
    ? 'file.object:read:global'
    : active.roleId === 'admin'
      ? 'file.object:read:organization'
      : undefined;
  return permission !== undefined && evaluatePermission(
    active.permissions,
    permission,
    {
      actorProfileId: current.aggregate.profile.profileId,
      membershipOrganizationId: active.organizationId,
      resourceOrganizationId: context.organizationId,
      globalAllowed: active.roleId === 'super_admin',
    },
  ).allowed;
}

function operationResponse(operation: PresignedObjectOperation): Record<string, unknown> {
  return {
    method: operation.method,
    url: operation.url.toString(),
    expires_at: operation.expiresAt.toISOString(),
    required_headers: { ...operation.requiredHeaders },
  };
}
