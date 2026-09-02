import { Injectable } from '@nestjs/common';
import {
  ProfileRepository,
  type SessionProfileRecord,
  type UpdateOwnProfileInput,
} from '@smartcura/database';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { SessionAuthorizationService } from '../platform/request-authorization.js';
import { createHash } from 'node:crypto';
import { correlationId, sessionInvalid, validationFailed } from '../platform/problems.js';
import {
  updateMyProfileSchema,
  type UpdateMyProfileRequest,
  uploadAvatarSchema,
  type UploadAvatarRequest,
} from './profile-request.schemas.js';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly authorization: SessionAuthorizationService,
  ) {}

  async getMine(current: AuthenticatedSession): Promise<Record<string, unknown>> {
    const profile = await this.profiles.findById(current.aggregate.profile.profileId);
    if (profile === undefined) throw sessionInvalid();
    if (profile.status === 'suspended' || profile.status === 'deactivated') {
      await this.authorization.deny(
        current, 'profile.read.own', 401, 'APP_SESSION_INVALID',
        'Application session is invalid',
      );
    }
    return profileResponse(profile);
  }

  async updateMine(
    current: AuthenticatedSession,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    const request = parseUpdate(value);
    const result = await this.profiles.updateOwn(updateInput(current, request));
    if (result === 'profile_not_found') throw sessionInvalid();
    if (result === 'profile_blocked') {
      return this.authorization.deny(
        current, 'profile.update.own', 401, 'APP_SESSION_INVALID',
        'Application session is invalid',
      );
    }
    return profileResponse(result);
  }

  async uploadAvatar(
    current: AuthenticatedSession,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    const request = parseAvatarUpload(value);
    const bytes = Buffer.from(request.bytes_base64, 'base64');
    if (request.declared_sha256 !== undefined) {
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual.toLowerCase() !== request.declared_sha256.toLowerCase()) {
        throw validationFailed();
      }
    }
    await this.profiles.setAvatar(
      current.aggregate.profile.profileId,
      bytes,
      request.media_type,
    );
    return this.getMine(current);
  }

  async removeAvatar(current: AuthenticatedSession): Promise<Record<string, unknown>> {
    await this.profiles.setAvatar(current.aggregate.profile.profileId, null, null);
    return this.getMine(current);
  }

  async getAvatar(current: AuthenticatedSession): Promise<Record<string, unknown> | null> {
    return current.aggregate.profile.avatarUrl === null
      ? null
      : { avatar_url: current.aggregate.profile.avatarUrl };
  }
}
function parseUpdate(value: unknown): UpdateMyProfileRequest {
  const result = updateMyProfileSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function parseAvatarUpload(value: unknown): UploadAvatarRequest {
  const result = uploadAvatarSchema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function updateInput(
  current: AuthenticatedSession,
  request: UpdateMyProfileRequest,
): UpdateOwnProfileInput {
  return {
    profileId: current.aggregate.profile.profileId,
    ...(request.display_name !== undefined ? { displayName: request.display_name } : {}),
    ...(request.phone_e164 !== undefined ? { phoneE164: request.phone_e164 } : {}),
    ...(request.preferred_locale !== undefined
      ? { preferredLocale: request.preferred_locale }
      : {}),
    ...(request.timezone !== undefined ? { timezone: request.timezone } : {}),
    ...(request.complete_onboarding === true ? { completeOnboarding: true as const } : {}),
    now: new Date(),
    correlationId: correlationId(),
  };
}

function profileResponse(profile: SessionProfileRecord): Record<string, unknown> {
  return {
    id: profile.profileId,
    status: profile.status,
    display_name: profile.displayName,
    email: profile.email,
    phone_e164: profile.phoneE164,
    preferred_locale: profile.preferredLocale,
    timezone: profile.timezone,
    onboarding_completed_at: profile.onboardingCompletedAt?.toISOString() ?? null,
    avatar_url: profile.avatarUrl,
    created_at: profile.createdAt.toISOString(),
    updated_at: profile.updatedAt.toISOString(),
  };
}
