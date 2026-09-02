import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ClinicalTemplateRepository,
  clinicalTemplateIdempotency,
  serializeClinicalTemplate,
  type ClinicalTemplateCommandResult,
} from '@smartcura/database/clinical-templates';
import type { ZodType } from 'zod';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  clinicalTemplateCreateSchema,
  clinicalTemplateListSchema,
  clinicalTemplateUpdateSchema,
  type ClinicalTemplateCreateRequest,
  type ClinicalTemplateUpdateRequest,
} from './doctor-templates.schemas.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `expected_version` for a DELETE is a query parameter (a DELETE has no body in this
 * API's convention), so it is parsed separately from the create/update bodies. Bounded
 * to a positive integer to match `expectedVersion` in the schemas file.
 */
const archiveQuerySchema = z
  .object({ expected_version: z.coerce.number().int().min(1) })
  .strict();

/**
 * Doctor-authored clinical template CRUD.
 *
 * Authority is derived from the session: the caller must hold an ACTIVE membership whose
 * role is `doctor`, and `author_membership_id` is always that membership's id — never
 * supplied by the request. This makes a template provably owned by the doctor who wrote
 * it, and a read-one for another doctor's template is a 404 (not a 403), so the API does
 * not enumerate which ids exist for other actors.
 */
@Injectable()
export class DoctorTemplatesService {
  constructor(private readonly repository: ClinicalTemplateRepository) {}

  async listTemplates(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(clinicalTemplateListSchema, queryValue);
    const doctor = this.doctor(current);
    const cursor =
      query.cursor === undefined ? undefined : decodeListCursor(query.cursor);
    const rows = await this.repository.listTemplates({
      authorMembershipId: doctor.membershipId,
      search: query.search,
      status: query.status,
      afterUpdatedAt: cursor?.updatedAt,
      afterTemplateId: cursor?.templateId,
      limit: query.page_size + 1,
    });
    const more = rows.length > query.page_size;
    const page = more ? rows.slice(0, query.page_size) : rows;
    const last = page.at(-1);
    return {
      data: page.map(serializeClinicalTemplate),
      page: {
        has_more: more,
        next_cursor:
          more && last
            ? encode({ updated_at: last.updatedAt.toISOString(), template_id: last.templateId })
            : null,
      },
    };
  }

  async getTemplate(current: AuthenticatedSession, idValue: string) {
    const templateId = id(idValue);
    const doctor = this.doctor(current);
    const row = await this.repository.getTemplate(templateId, doctor.membershipId);
    if (row === undefined) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Clinical template was not found');
    }
    return serializeClinicalTemplate(row);
  }

  async createTemplate(
    current: AuthenticatedSession,
    idempotencyKey: string,
    body: unknown,
  ) {
    const request = parse(clinicalTemplateCreateSchema, body);
    const doctor = this.doctor(current);
    const now = new Date();
    const result = await this.repository.createTemplate({
      authorMembershipId: doctor.membershipId,
      organizationId: doctor.organizationId,
      name: request.name,
      description: request.description,
      specialty: request.specialty,
      content: request.content,
      actorProfileId: current.aggregate.profile.profileId,
      now,
      correlationId: correlationId(),
      idempotency: clinicalTemplateIdempotency(
        idempotencyKey,
        'clinical_template.create',
        { author_membership_id: doctor.membershipId, request },
      ),
    });
    return this.commandResult(result);
  }

  async updateTemplate(
    current: AuthenticatedSession,
    idValue: string,
    body: unknown,
  ) {
    const templateId = id(idValue);
    const request = parse(clinicalTemplateUpdateSchema, body);
    const doctor = this.doctor(current);
    const now = new Date();
    const result = await this.repository.updateTemplate({
      templateId,
      authorMembershipId: doctor.membershipId,
      name: request.name,
      description: request.description,
      specialty: request.specialty,
      content: request.content,
      expectedVersion: request.expected_version,
      actorProfileId: current.aggregate.profile.profileId,
      now,
      correlationId: correlationId(),
    });
    return this.commandResult(result);
  }

  async archiveTemplate(
    current: AuthenticatedSession,
    idValue: string,
    queryValue: unknown,
    idempotencyKey: string,
  ) {
    const templateId = id(idValue);
    const query = parse(archiveQuerySchema, queryValue);
    const doctor = this.doctor(current);
    const now = new Date();
    const result = await this.repository.archiveTemplate({
      templateId,
      authorMembershipId: doctor.membershipId,
      expectedVersion: query.expected_version,
      actorProfileId: current.aggregate.profile.profileId,
      now,
      correlationId: correlationId(),
      idempotency: clinicalTemplateIdempotency(
        idempotencyKey,
        'clinical_template.archive',
        { template_id: templateId, expected_version: query.expected_version },
      ),
    });
    return this.commandResult(result);
  }

  private doctor(current: AuthenticatedSession) {
    const active = current.aggregate.memberships.find(
      (membership) => membership.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    if (active.roleId !== 'doctor') {
      throw problem(403, 'PERMISSION_DENIED', 'Doctor authority is required');
    }
    return active;
  }

  private commandResult(result: ClinicalTemplateCommandResult): Record<string, unknown> {
    if (typeof result === 'string') return this.failure(result);
    if ('replayed' in result) return result.body;
    return serializeClinicalTemplate(result);
  }

  private failure(value: string): never {
    if (value === 'not_found') {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Clinical template was not found');
    }
    if (value === 'version_conflict') {
      throw problem(409, 'CLINICAL_VERSION_CONFLICT', 'The clinical template changed');
    }
    if (value === 'archived') {
      throw problem(409, 'SIGNED_RECORD_IMMUTABLE', 'Archived clinical templates are immutable');
    }
    if (value === 'idempotency_reused') {
      throw problem(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused');
    }
    if (value === 'idempotency_in_progress') {
      throw problem(409, 'IDEMPOTENCY_IN_PROGRESS', 'Idempotent command is still processing');
    }
    throw problem(409, 'CLINICAL_TRANSITION_INVALID', 'Clinical template transition is not allowed');
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function id(value: string): string {
  if (!UUID_V7.test(value)) throw validationFailed();
  return value;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeListCursor(value: string): { updatedAt: Date; templateId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      typeof parsed.updated_at !== 'string' ||
      typeof parsed.template_id !== 'string' ||
      !UUID_V7.test(parsed.template_id)
    ) {
      throw new Error();
    }
    const updatedAt = new Date(parsed.updated_at);
    if (Number.isNaN(updatedAt.getTime())) throw new Error();
    return { updatedAt, templateId: parsed.template_id };
  } catch {
    throw validationFailed();
  }
}
