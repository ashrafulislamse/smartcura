import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  CurrentSession,
  type AuthenticatedSession,
  RequireCsrf,
  RequirePermission,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { ProfileDetailsService } from './profile-details.service.js';

/**
 * Extended profile data for the authenticated profile only.
 *
 * Every route is under `/profiles/me`, so no route can name another profile. That
 * is the primary own-only control; the permission requirement below is the second,
 * and the repository's under-lock `session.profile_id` check is the third.
 *
 * `allowDuringOnboarding` is true because addresses and emergency contacts are
 * collected before a profile becomes active — the emergency-contact and medical-id
 * onboarding screens depend on it. `allowWithoutActiveMembership` is true because
 * a patient may hold no membership at all; the `own` scope, not a membership, is
 * what authorizes these rows. The repository still refuses a suspended or
 * deactivated profile.
 *
 * Every response is `no-store`: this is health data, and a shared cache holding a
 * patient's allergy list is a disclosure, not a performance win.
 */
@Controller('profiles/me')
export class ProfileDetailsController {
  constructor(private readonly details: ProfileDetailsService) {}

  // -------------------------------------------------------------------------
  // Addresses
  // -------------------------------------------------------------------------

  @Get('addresses')
  @RequirePermission('profile_detail:read:own', 'profile_detail.address.list', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async listAddresses(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.details.listAddresses(current);
  }

  @Post('addresses')
  @HttpCode(201)
  @RequireCsrf('profile_detail.address.create')
  @RequirePermission('profile_detail:write:own', 'profile_detail.address.create', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async createAddress(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.details.createAddress(current, body);
  }

  @Put('addresses/:detailId')
  @RequireCsrf('profile_detail.address.update')
  @RequirePermission('profile_detail:write:own', 'profile_detail.address.update', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async updateAddress(
    @CurrentSession() current: AuthenticatedSession,
    @Param('detailId') detailId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.details.updateAddress(current, detailId, body);
  }

  /** Hard delete; see `PatientProfileRepository.removeAddress`. */
  @Delete('addresses/:detailId')
  @HttpCode(204)
  @RequireCsrf('profile_detail.address.remove')
  @RequirePermission('profile_detail:write:own', 'profile_detail.address.remove', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async removeAddress(
    @CurrentSession() current: AuthenticatedSession,
    @Param('detailId') detailId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<void> {
    noStore(response);
    await this.details.removeAddress(current, detailId, query);
  }

  // -------------------------------------------------------------------------
  // Emergency contacts
  // -------------------------------------------------------------------------

  @Get('emergency-contacts')
  @RequirePermission('profile_detail:read:own', 'profile_detail.emergency_contact.list', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async listEmergencyContacts(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.details.listEmergencyContacts(current);
  }

  @Post('emergency-contacts')
  @HttpCode(201)
  @RequireCsrf('profile_detail.emergency_contact.create')
  @RequirePermission('profile_detail:write:own', 'profile_detail.emergency_contact.create', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async createEmergencyContact(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.details.createEmergencyContact(current, body);
  }

  @Put('emergency-contacts/:detailId')
  @RequireCsrf('profile_detail.emergency_contact.update')
  @RequirePermission('profile_detail:write:own', 'profile_detail.emergency_contact.update', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async updateEmergencyContact(
    @CurrentSession() current: AuthenticatedSession,
    @Param('detailId') detailId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.details.updateEmergencyContact(current, detailId, body);
  }

  /** Hard delete: a removed emergency contact must genuinely stop being called. */
  @Delete('emergency-contacts/:detailId')
  @HttpCode(204)
  @RequireCsrf('profile_detail.emergency_contact.remove')
  @RequirePermission('profile_detail:write:own', 'profile_detail.emergency_contact.remove', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async removeEmergencyContact(
    @CurrentSession() current: AuthenticatedSession,
    @Param('detailId') detailId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<void> {
    noStore(response);
    await this.details.removeEmergencyContact(current, detailId, query);
  }

  // -------------------------------------------------------------------------
  // Allergies
  // -------------------------------------------------------------------------

  @Get('allergies')
  @RequirePermission('profile_detail:read:own', 'profile_detail.allergy.list', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async listAllergies(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.details.listAllergies(current);
  }

  @Post('allergies')
  @HttpCode(201)
  @RequireCsrf('profile_detail.allergy.create')
  @RequirePermission('profile_detail:write:own', 'profile_detail.allergy.create', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async createAllergy(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.details.createAllergy(current, body);
  }

  @Put('allergies/:detailId')
  @RequireCsrf('profile_detail.allergy.update')
  @RequirePermission('profile_detail:write:own', 'profile_detail.allergy.update', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async updateAllergy(
    @CurrentSession() current: AuthenticatedSession,
    @Param('detailId') detailId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.details.updateAllergy(current, detailId, body);
  }

  /** Soft delete: an allergy a clinician has seen is clinical history. */
  @Delete('allergies/:detailId')
  @HttpCode(204)
  @RequireCsrf('profile_detail.allergy.remove')
  @RequirePermission('profile_detail:write:own', 'profile_detail.allergy.remove', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async removeAllergy(
    @CurrentSession() current: AuthenticatedSession,
    @Param('detailId') detailId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<void> {
    noStore(response);
    await this.details.removeAllergy(current, detailId, query);
  }

  // -------------------------------------------------------------------------
  // Conditions
  // -------------------------------------------------------------------------

  @Get('conditions')
  @RequirePermission('profile_detail:read:own', 'profile_detail.condition.list', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async listConditions(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.details.listConditions(current);
  }

  @Post('conditions')
  @HttpCode(201)
  @RequireCsrf('profile_detail.condition.create')
  @RequirePermission('profile_detail:write:own', 'profile_detail.condition.create', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async createCondition(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.details.createCondition(current, body);
  }

  @Put('conditions/:detailId')
  @RequireCsrf('profile_detail.condition.update')
  @RequirePermission('profile_detail:write:own', 'profile_detail.condition.update', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async updateCondition(
    @CurrentSession() current: AuthenticatedSession,
    @Param('detailId') detailId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.details.updateCondition(current, detailId, body);
  }

  /** Soft delete, for the same reason as an allergy. */
  @Delete('conditions/:detailId')
  @HttpCode(204)
  @RequireCsrf('profile_detail.condition.remove')
  @RequirePermission('profile_detail:write:own', 'profile_detail.condition.remove', {
    allowDuringOnboarding: true,
    allowWithoutActiveMembership: true,
  })
  async removeCondition(
    @CurrentSession() current: AuthenticatedSession,
    @Param('detailId') detailId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<void> {
    noStore(response);
    await this.details.removeCondition(current, detailId, query);
  }
}

/**
 * Rejects a body whose media type was not declared as JSON. Nest would otherwise
 * hand the handler an empty object for an unparsed body, which a `.strict()`
 * schema turns into a confusing VALIDATION_FAILED instead of the accurate 415.
 */
function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON content type is required');
  }
}
