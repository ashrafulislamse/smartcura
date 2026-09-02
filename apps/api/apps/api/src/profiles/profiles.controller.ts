import { Body, Controller, Delete, Get, Headers, HttpCode, Patch, Post, Res } from '@nestjs/common';
import {
  CurrentSession,
  type AuthenticatedSession,
  RequireCsrf,
  RequirePermission,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { ProfilesService } from './profiles.service.js';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me')
  @RequirePermission('profile:read:own', 'profile.read.own', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async getMine(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.profiles.getMine(current);
  }

  @Patch('me')
  @RequireCsrf('profile.update.own')
  @RequirePermission('profile:update:own', 'profile.update.own', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async updateMine(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/merge-patch+json') {
      throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Merge-patch content type is required');
    }
    return this.profiles.updateMine(current, body);
  }

  @Post('me/avatar')
  @HttpCode(201)
  @RequireCsrf('profile.avatar.upload')
  @RequirePermission('profile:update:own', 'profile.avatar.upload', {
    allowDuringOnboarding: false,
    allowWithoutActiveMembership: false,
  })
  async uploadAvatar(
    @CurrentSession() current: AuthenticatedSession,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.profiles.uploadAvatar(current, body);
  }

  @Delete('me/avatar')
  @RequireCsrf('profile.avatar.remove')
  @RequirePermission('profile:update:own', 'profile.avatar.remove', {
    allowDuringOnboarding: false,
    allowWithoutActiveMembership: false,
  })
  async removeAvatar(
    @CurrentSession() current: AuthenticatedSession,
  ): Promise<Record<string, unknown>> {
    return this.profiles.removeAvatar(current);
  }

  @Get('me/avatar')
  @RequirePermission('profile:read:own', 'profile.avatar.read', {
    allowDuringOnboarding: false,
    allowWithoutActiveMembership: false,
  })
  async downloadAvatar(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return { avatar_url: current.aggregate.profile.avatarUrl };
  }
}
