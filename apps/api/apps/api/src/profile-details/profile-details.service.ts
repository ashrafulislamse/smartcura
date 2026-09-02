import { Injectable } from '@nestjs/common';
import {
  PatientProfileRepository,
  type DetailMutationFailure,
  type PatientAddressRecord,
  type PatientAllergyRecord,
  type PatientConditionRecord,
  type PatientDetailMutationContext,
  type PatientEmergencyContactRecord,
  type RemoveDetailResult,
} from '@smartcura/database/patient-profile-repository';
import type { ProfileDetailKind } from '@smartcura/database/profile-detail-events';
import {
  type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  createAddressSchema,
  createAllergySchema,
  createConditionSchema,
  createEmergencyContactSchema,
  profileDetailPathSchema,
  removeProfileDetailQuerySchema,
  updateAddressSchema,
  updateAllergySchema,
  updateConditionSchema,
  updateEmergencyContactSchema,
} from './profile-detail-request.schemas.js';

/**
 * Extended profile data for the authenticated profile.
 *
 * AUTHORIZATION IS DENY-BY-DEFAULT AND OWN-ONLY.
 *
 * The owning profile id is always taken from the session aggregate and never from
 * the request. There is no route, parameter or body field in this module that can
 * name another profile, so a cross-profile write is not merely rejected, it is
 * unrepresentable. `PatientProfileRepository` re-proves the same thing under lock
 * with `session.profile_id = $3`, because the guard runs before the write and a
 * session can be revoked in between.
 *
 * Reading ANOTHER profile's clinical detail is not exposed here at all. That path
 * requires `profile_detail:read:assigned`, whose object policy needs a live care
 * relationship rather than mere organization membership. The permission is seeded
 * by migration 0015 and granted to `doctor`, and it stays inert until the
 * care-access work package adds the endpoint that consumes it. Shipping the
 * endpoint before the assignment check exists would be the wrong order.
 */
@Injectable()
export class ProfileDetailsService {
  constructor(private readonly details: PatientProfileRepository) {}

  // -------------------------------------------------------------------------
  // Addresses
  // -------------------------------------------------------------------------

  async listAddresses(current: AuthenticatedSession): Promise<Record<string, unknown>> {
    const records = await this.details.listAddresses(profileId(current));
    return { data: records.map(addressResponse) };
  }

  async createAddress(
    current: AuthenticatedSession,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const request = parse(createAddressSchema, body);
    const result = await this.details.createAddress({
      ...context(current, request.reason_code),
      label: request.label,
      line1: request.line1,
      line2: request.line2,
      city: request.city,
      state: request.state,
      postcode: request.postcode,
      countryCode: request.country_code,
      isPrimary: request.is_primary,
      latitude: request.latitude,
      longitude: request.longitude,
    });
    if (typeof result === 'string') {
      return this.failure(current, 'address', null, 'create', result);
    }
    return addressResponse(result);
  }

  async updateAddress(
    current: AuthenticatedSession,
    detailIdValue: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const detailId = parsePath(detailIdValue);
    const request = parse(updateAddressSchema, body);
    const result = await this.details.updateAddress({
      ...context(current, request.reason_code),
      addressId: detailId,
      expectedVersion: request.expected_version,
      label: request.label,
      line1: request.line1,
      line2: request.line2,
      city: request.city,
      state: request.state,
      postcode: request.postcode,
      countryCode: request.country_code,
      isPrimary: request.is_primary,
      latitude: request.latitude,
      longitude: request.longitude,
    });
    if (typeof result === 'string') {
      return this.failure(current, 'address', detailId, 'update', result);
    }
    return addressResponse(result);
  }

  async removeAddress(
    current: AuthenticatedSession,
    detailIdValue: string,
    query: unknown,
  ): Promise<void> {
    const detailId = parsePath(detailIdValue);
    const request = parse(removeProfileDetailQuerySchema, query);
    const result = await this.details.removeAddress({
      ...context(current, request.reason_code),
      detailId,
      expectedVersion: request.expected_version,
    });
    await this.removal(current, 'address', detailId, result);
  }

  // -------------------------------------------------------------------------
  // Emergency contacts
  // -------------------------------------------------------------------------

  async listEmergencyContacts(current: AuthenticatedSession): Promise<Record<string, unknown>> {
    const records = await this.details.listEmergencyContacts(profileId(current));
    return { data: records.map(contactResponse) };
  }

  async createEmergencyContact(
    current: AuthenticatedSession,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const request = parse(createEmergencyContactSchema, body);
    const result = await this.details.createEmergencyContact({
      ...context(current, request.reason_code),
      name: request.name,
      relationship: request.relationship,
      phoneE164: request.phone_e164,
      isPrimary: request.is_primary,
    });
    if (typeof result === 'string') {
      return this.failure(current, 'emergency_contact', null, 'create', result);
    }
    return contactResponse(result);
  }

  async updateEmergencyContact(
    current: AuthenticatedSession,
    detailIdValue: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const detailId = parsePath(detailIdValue);
    const request = parse(updateEmergencyContactSchema, body);
    const result = await this.details.updateEmergencyContact({
      ...context(current, request.reason_code),
      contactId: detailId,
      expectedVersion: request.expected_version,
      name: request.name,
      relationship: request.relationship,
      phoneE164: request.phone_e164,
      isPrimary: request.is_primary,
    });
    if (typeof result === 'string') {
      return this.failure(current, 'emergency_contact', detailId, 'update', result);
    }
    return contactResponse(result);
  }

  async removeEmergencyContact(
    current: AuthenticatedSession,
    detailIdValue: string,
    query: unknown,
  ): Promise<void> {
    const detailId = parsePath(detailIdValue);
    const request = parse(removeProfileDetailQuerySchema, query);
    const result = await this.details.removeEmergencyContact({
      ...context(current, request.reason_code),
      detailId,
      expectedVersion: request.expected_version,
    });
    await this.removal(current, 'emergency_contact', detailId, result);
  }

  // -------------------------------------------------------------------------
  // Allergies
  // -------------------------------------------------------------------------

  async listAllergies(current: AuthenticatedSession): Promise<Record<string, unknown>> {
    const records = await this.details.listAllergies(profileId(current));
    return { data: records.map(allergyResponse) };
  }

  async createAllergy(
    current: AuthenticatedSession,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const request = parse(createAllergySchema, body);
    const now = new Date();
    const result = await this.details.createAllergy({
      ...context(current, request.reason_code, now),
      substance: request.substance,
      reaction: request.reaction,
      severity: request.severity,
      recordedAt: request.recorded_at === undefined ? now : new Date(request.recorded_at),
      // Attribution comes from the session, never the request: see the schema.
      notedByProfileId: profileId(current),
    });
    if (typeof result === 'string') {
      return this.failure(current, 'allergy', null, 'create', result);
    }
    return allergyResponse(result);
  }

  async updateAllergy(
    current: AuthenticatedSession,
    detailIdValue: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const detailId = parsePath(detailIdValue);
    const request = parse(updateAllergySchema, body);
    const now = new Date();
    const result = await this.details.updateAllergy({
      ...context(current, request.reason_code, now),
      allergyId: detailId,
      expectedVersion: request.expected_version,
      substance: request.substance,
      reaction: request.reaction,
      severity: request.severity,
      recordedAt: request.recorded_at === undefined ? now : new Date(request.recorded_at),
      notedByProfileId: profileId(current),
    });
    if (typeof result === 'string') {
      return this.failure(current, 'allergy', detailId, 'update', result);
    }
    return allergyResponse(result);
  }

  /** Soft delete in the repository: an allergy a clinician saw is history. */
  async removeAllergy(
    current: AuthenticatedSession,
    detailIdValue: string,
    query: unknown,
  ): Promise<void> {
    const detailId = parsePath(detailIdValue);
    const request = parse(removeProfileDetailQuerySchema, query);
    const result = await this.details.removeAllergy({
      ...context(current, request.reason_code),
      detailId,
      expectedVersion: request.expected_version,
    });
    await this.removal(current, 'allergy', detailId, result);
  }

  // -------------------------------------------------------------------------
  // Conditions
  // -------------------------------------------------------------------------

  async listConditions(current: AuthenticatedSession): Promise<Record<string, unknown>> {
    const records = await this.details.listConditions(profileId(current));
    return { data: records.map(conditionResponse) };
  }

  async createCondition(
    current: AuthenticatedSession,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const request = parse(createConditionSchema, body);
    const result = await this.details.createCondition({
      ...context(current, request.reason_code),
      conditionName: request.condition_name,
      status: request.status,
      onsetDate: request.onset_date,
      resolvedDate: request.resolved_date,
      notes: request.notes,
    });
    if (typeof result === 'string') {
      return this.failure(current, 'condition', null, 'create', result);
    }
    return conditionResponse(result);
  }

  async updateCondition(
    current: AuthenticatedSession,
    detailIdValue: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const detailId = parsePath(detailIdValue);
    const request = parse(updateConditionSchema, body);
    const result = await this.details.updateCondition({
      ...context(current, request.reason_code),
      conditionId: detailId,
      expectedVersion: request.expected_version,
      conditionName: request.condition_name,
      status: request.status,
      onsetDate: request.onset_date,
      resolvedDate: request.resolved_date,
      notes: request.notes,
    });
    if (typeof result === 'string') {
      return this.failure(current, 'condition', detailId, 'update', result);
    }
    return conditionResponse(result);
  }

  /** Soft delete in the repository, for the same reason as an allergy. */
  async removeCondition(
    current: AuthenticatedSession,
    detailIdValue: string,
    query: unknown,
  ): Promise<void> {
    const detailId = parsePath(detailIdValue);
    const request = parse(removeProfileDetailQuerySchema, query);
    const result = await this.details.removeCondition({
      ...context(current, request.reason_code),
      detailId,
      expectedVersion: request.expected_version,
    });
    await this.removal(current, 'condition', detailId, result);
  }

  private async removal(
    current: AuthenticatedSession,
    kind: ProfileDetailKind,
    detailId: string,
    result: RemoveDetailResult,
  ): Promise<void> {
    if (result === 'removed') return;
    await this.failure(current, kind, detailId, 'remove', result);
  }

  /**
   * Maps a repository outcome to a problem response, recording the refusal in the
   * audit log first. Every denial on health data is audited, following the
   * deny-and-audit pattern in `MembershipsService`.
   */
  private async failure(
    current: AuthenticatedSession,
    kind: ProfileDetailKind,
    detailId: string | null,
    verb: 'create' | 'update' | 'remove',
    result: DetailMutationFailure,
  ): Promise<never> {
    const action = `profile_detail.${kind}.${verb}`;
    switch (result) {
      case 'actor_session_invalid':
      case 'profile_blocked':
        return this.deny(
          current, kind, detailId, action,
          401, 'APP_SESSION_INVALID', 'Application session is invalid',
        );
      case 'not_found':
        return this.deny(
          current, kind, detailId, action,
          404, 'RESOURCE_NOT_FOUND', 'Profile detail row was not found',
        );
      case 'version_conflict':
        return this.deny(
          current, kind, detailId, action,
          409, 'RESOURCE_VERSION_CONFLICT', 'Profile detail version is stale',
        );
      case 'duplicate':
        return this.deny(
          current, kind, detailId, action,
          409, 'PROFILE_DETAIL_DUPLICATE', 'An equivalent live entry already exists',
        );
    }
  }

  private async deny(
    current: AuthenticatedSession,
    kind: ProfileDetailKind,
    detailId: string | null,
    action: string,
    status: number,
    code: string,
    title: string,
  ): Promise<never> {
    const requestCorrelationId = correlationId();
    await this.details.recordDenial(
      profileId(current), kind, detailId, action, code, requestCorrelationId,
    );
    throw problem(status, code, title, requestCorrelationId);
  }
}

/**
 * The owning profile. Always the session's own profile: this single function is
 * the only place the owner is decided, so there is one place to audit that no
 * request value reaches it.
 */
function profileId(current: AuthenticatedSession): string {
  return current.aggregate.profile.profileId;
}

function context(
  current: AuthenticatedSession,
  reasonCode: PatientDetailMutationContext['reasonCode'],
  now: Date = new Date(),
): PatientDetailMutationContext {
  return {
    profileId: profileId(current),
    // Re-proved under lock inside the write transaction, not trusted from here.
    actor: {
      sessionId: current.aggregate.session.sessionId,
      tokenHash: current.tokenHash,
    },
    reasonCode,
    now,
    correlationId: correlationId(),
  };
}

function parsePath(value: string): string {
  const result = profileDetailPathSchema.safeParse({ detailId: value });
  if (!result.success) throw validationFailed();
  return result.data.detailId;
}

function parse<Output>(
  schema: { safeParse: (value: unknown) => { success: true; data: Output } | { success: false } },
  value: unknown,
): Output {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function addressResponse(record: PatientAddressRecord): Record<string, unknown> {
  return {
    id: record.addressId,
    profile_id: record.profileId,
    label: record.label,
    line1: record.line1,
    line2: record.line2,
    city: record.city,
    state: record.state,
    postcode: record.postcode,
    country_code: record.countryCode,
    is_primary: record.isPrimary,
    latitude: record.latitude,
    longitude: record.longitude,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function contactResponse(record: PatientEmergencyContactRecord): Record<string, unknown> {
  return {
    id: record.contactId,
    profile_id: record.profileId,
    name: record.name,
    relationship: record.relationship,
    phone_e164: record.phoneE164,
    is_primary: record.isPrimary,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function allergyResponse(record: PatientAllergyRecord): Record<string, unknown> {
  return {
    id: record.allergyId,
    profile_id: record.profileId,
    substance: record.substance,
    reaction: record.reaction,
    severity: record.severity,
    recorded_at: record.recordedAt.toISOString(),
    noted_by_profile_id: record.notedByProfileId,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function conditionResponse(record: PatientConditionRecord): Record<string, unknown> {
  return {
    id: record.conditionId,
    profile_id: record.profileId,
    condition_name: record.conditionName,
    status: record.status,
    onset_date: record.onsetDate,
    resolved_date: record.resolvedDate,
    notes: record.notes,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
