import { createHash } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  claimIdempotency,
  completeIdempotency,
  deleteIdempotency,
  loadIdempotency,
  type IdempotencyScope,
} from './idempotency.js';

/**
 * Doctor-authored clinical templates.
 *
 * A template is owned by the doctor (`author_membership_id`) who created it, within
 * their organization. No other actor may mutate it. The body is a JSONB document
 * (SOAP structure, fields, defaults) bounded to 64 KiB by a CHECK constraint in the
 * migration. Deletion is an archive (`status = 'archived'`), never a row removal, so a
 * consultation that referenced a template keeps resolving it. `version` is the
 * optimistic-concurrency currency for updates, matching `prescriptions` and
 * `clinical_notes`.
 */

export const CLINICAL_TEMPLATE_STATUSES = ['active', 'archived'] as const;
export type ClinicalTemplateStatus = (typeof CLINICAL_TEMPLATE_STATUSES)[number];

export interface ClinicalTemplateRecord {
  readonly templateId: string;
  readonly authorMembershipId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly specialty: string | null;
  readonly content: Record<string, unknown>;
  readonly status: ClinicalTemplateStatus;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ClinicalTemplateListInput {
  readonly authorMembershipId: string;
  readonly search: string | undefined;
  /** Cursor: (updatedAt, templateId) from the last row of the previous page. */
  readonly afterUpdatedAt: Date | undefined;
  readonly afterTemplateId: string | undefined;
  readonly status: ClinicalTemplateStatus | undefined;
  readonly limit: number;
}

export interface ClinicalTemplateCreateInput {
  readonly authorMembershipId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly specialty: string | null;
  readonly content: Record<string, unknown>;
  readonly actorProfileId: string;
  readonly now: Date;
  readonly correlationId: string;
  readonly idempotency: ClinicalTemplateIdempotency;
}

export interface ClinicalTemplateUpdateInput {
  readonly templateId: string;
  readonly authorMembershipId: string;
  readonly name: string;
  readonly description: string | null;
  readonly specialty: string | null;
  readonly content: Record<string, unknown>;
  readonly expectedVersion: number;
  readonly actorProfileId: string;
  readonly now: Date;
  readonly correlationId: string;
}

export interface ClinicalTemplateArchiveInput {
  readonly templateId: string;
  readonly authorMembershipId: string;
  readonly expectedVersion: number;
  readonly actorProfileId: string;
  readonly now: Date;
  readonly correlationId: string;
  readonly idempotency: ClinicalTemplateIdempotency;
}

export interface ClinicalTemplateIdempotency {
  readonly key: string;
  readonly requestHash: string;
  readonly operationId: string;
  readonly ttlMs: number;
}

export interface ClinicalTemplateReplay {
  readonly replayed: true;
  readonly body: Record<string, unknown>;
}

export type ClinicalTemplateCommandResult =
  | ClinicalTemplateRecord
  | ClinicalTemplateReplay
  | ClinicalTemplateFailure;

export type ClinicalTemplateFailure =
  | 'not_found'
  | 'version_conflict'
  | 'archived'
  | 'idempotency_reused'
  | 'idempotency_in_progress';

interface ClinicalTemplateRow extends QueryResultRow, ClinicalTemplateRecord {}

const projection = `template_id AS "templateId", author_membership_id AS "authorMembershipId",
  organization_id AS "organizationId", name, description, specialty, content,
  status, version, created_at AS "createdAt", updated_at AS "updatedAt"`;

export function serializeClinicalTemplate(record: ClinicalTemplateRecord): Record<string, unknown> {
  return {
    template_id: record.templateId,
    author_membership_id: record.authorMembershipId,
    organization_id: record.organizationId,
    name: record.name,
    description: record.description,
    specialty: record.specialty,
    content: record.content,
    status: record.status,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export class ClinicalTemplateRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * List a doctor's own templates, newest-updated first, with bounded pagination and
   * optional name search. Archived rows are excluded unless `status` is supplied, so the
   * default hot path never scans discarded templates.
   */
  async listTemplates(input: ClinicalTemplateListInput): Promise<ClinicalTemplateRecord[]> {
    const result = await this.database.query<ClinicalTemplateRow>(
      `SELECT ${projection} FROM clinical_templates
       WHERE author_membership_id = $1
         AND ($2::text IS NULL OR status = $2)
         AND ($3::text IS NULL OR name ILIKE '%' || $3 || '%')
         AND ($4::timestamptz IS NULL
              OR (updated_at, template_id) < ($4, $5::uuid))
       ORDER BY updated_at DESC, template_id DESC
       LIMIT $6`,
      [
        input.authorMembershipId,
        input.status ?? null,
        input.search ?? null,
        input.afterUpdatedAt ?? null,
        input.afterTemplateId ?? null,
        input.limit,
      ],
    );
    return result.rows;
  }

  /**
   * Read one template, verifying it belongs to the calling doctor. The
   * `clinical_templates_id_author_uq` unique index makes this a single index probe.
   * Returns `undefined` when the id does not exist OR it belongs to another author,
   * so a forbidden read is indistinguishable from a missing one (no id enumeration).
   */
  async getTemplate(
    templateId: string,
    authorMembershipId: string,
  ): Promise<ClinicalTemplateRecord | undefined> {
    const result = await this.database.query<ClinicalTemplateRow>(
      `SELECT ${projection} FROM clinical_templates
       WHERE template_id = $1 AND author_membership_id = $2`,
      [templateId, authorMembershipId],
    );
    return result.rows[0];
  }

  async createTemplate(
    input: ClinicalTemplateCreateInput,
  ): Promise<ClinicalTemplateCommandResult> {
    return this.database.transaction(async (client) => {
      const idempotency = await this.beginIdempotency(
        client,
        input.organizationId,
        input.actorProfileId,
        input.idempotency,
        input.now,
      );
      if (idempotency !== 'claimed') return idempotency;

      const row = (
        await client.query<ClinicalTemplateRow>(
          `INSERT INTO clinical_templates
             (author_membership_id, organization_id, name, description, specialty, content)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           RETURNING ${projection}`,
          [
            input.authorMembershipId,
            input.organizationId,
            input.name,
            input.description,
            input.specialty,
            JSON.stringify(input.content),
          ],
        )
      ).rows[0]!;

      await this.audit(
        client,
        row.organizationId,
        input.actorProfileId,
        'clinical_template.created',
        row.templateId,
        input.correlationId,
        input.now,
      );

      await this.finishIdempotency(
        client,
        input.organizationId,
        input.actorProfileId,
        input.idempotency,
        row,
        input.now,
      );
      return row;
    });
  }

  async updateTemplate(
    input: ClinicalTemplateUpdateInput,
  ): Promise<ClinicalTemplateRecord | ClinicalTemplateFailure> {
    return this.database.transaction(async (client) => {
      const current = await this.loadForUpdate(client, input.templateId, input.authorMembershipId);
      if (current === undefined) return 'not_found';
      if (current.status !== 'active') return 'archived';
      if (current.version !== input.expectedVersion) return 'version_conflict';

      const changed = (
        await client.query<ClinicalTemplateRow>(
          `UPDATE clinical_templates
             SET name = $2, description = $3, specialty = $4, content = $5::jsonb,
                 version = version + 1, updated_at = $6
           WHERE template_id = $1
           RETURNING ${projection}`,
          [
            current.templateId,
            input.name,
            input.description,
            input.specialty,
            JSON.stringify(input.content),
            input.now,
          ],
        )
      ).rows[0]!;

      await this.audit(
        client,
        changed.organizationId,
        input.actorProfileId,
        'clinical_template.updated',
        changed.templateId,
        input.correlationId,
        input.now,
      );
      return changed;
    });
  }

  async archiveTemplate(
    input: ClinicalTemplateArchiveInput,
  ): Promise<ClinicalTemplateCommandResult> {
    return this.database.transaction(async (client) => {
      // The idempotency scope needs an organizationId, but the archive input does not
      // carry one (ownership is by author_membership_id). Resolve it from the row
      // BEFORE claiming, so the scope matches the create/update scope for the same
      // actor. A not-found or version conflict before the claim is not a replay and
      // does not consume the key.
      const current = await this.loadForUpdate(client, input.templateId, input.authorMembershipId);
      if (current === undefined) return 'not_found';
      if (current.status !== 'active') return 'archived';
      if (current.version !== input.expectedVersion) return 'version_conflict';

      const idempotency = await this.beginIdempotency(
        client,
        current.organizationId,
        input.actorProfileId,
        input.idempotency,
        input.now,
      );
      if (idempotency !== 'claimed') return idempotency;

      const changed = (
        await client.query<ClinicalTemplateRow>(
          `UPDATE clinical_templates
             SET status = 'archived', version = version + 1, updated_at = $3
           WHERE template_id = $1
           RETURNING ${projection}`,
          [current.templateId, input.authorMembershipId, input.now],
        )
      ).rows[0]!;

      await this.audit(
        client,
        changed.organizationId,
        input.actorProfileId,
        'clinical_template.archived',
        changed.templateId,
        input.correlationId,
        input.now,
      );

      await this.finishIdempotency(
        client,
        changed.organizationId,
        input.actorProfileId,
        input.idempotency,
        changed,
        input.now,
      );
      return changed;
    });
  }

  private scope(
    organizationId: string,
    actorProfileId: string,
    input: ClinicalTemplateIdempotency,
  ): IdempotencyScope {
    return {
      organizationId,
      actorProfileId,
      operationId: input.operationId,
      idempotencyKey: input.key,
      requestHash: input.requestHash,
    };
  }

  private async beginIdempotency(
    client: PoolClient,
    organizationId: string,
    actorProfileId: string,
    input: ClinicalTemplateIdempotency,
    now: Date,
  ): Promise<'claimed' | ClinicalTemplateReplay | 'idempotency_reused' | 'idempotency_in_progress'> {
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
      client,
      scope,
      new Date(now.getTime() + input.ttlMs),
    );
    return claimed ? 'claimed' : 'idempotency_in_progress';
  }

  private async finishIdempotency(
    client: PoolClient,
    organizationId: string,
    actorProfileId: string,
    input: ClinicalTemplateIdempotency,
    record: ClinicalTemplateRecord,
    now: Date,
  ): Promise<void> {
    await completeIdempotency(
      client,
      this.scope(organizationId, actorProfileId, input),
      200,
      serializeClinicalTemplate(record),
      now,
    );
  }

  private async loadForUpdate(
    client: PoolClient,
    templateId: string,
    authorMembershipId: string,
  ): Promise<ClinicalTemplateRow | undefined> {
    const result = await client.query<ClinicalTemplateRow>(
      `SELECT ${projection} FROM clinical_templates
       WHERE template_id = $1 AND author_membership_id = $2
       FOR UPDATE`,
      [templateId, authorMembershipId],
    );
    return result.rows[0];
  }

  private async audit(
    client: PoolClient,
    organizationId: string,
    actorProfileId: string,
    action: string,
    objectId: string,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (audit_id, organization_id, actor_profile_id, action, object_type, object_id,
          correlation_id, occurred_at)
       VALUES (uuidv7(), $1, $2, $3, 'clinical_template', $4, $5, $6)`,
      [organizationId, actorProfileId, action, objectId, correlationId, now],
    );
  }
}

/**
 * Build an idempotency descriptor from a request key and the request body, matching
 * the `commandIdempotency` pattern in `clinical-care.service.ts`. The hash makes a
 * reused key with a different body a reuse error rather than a silent replay.
 */
export function clinicalTemplateIdempotency(
  key: string,
  operationId: string,
  value: Record<string, unknown>,
): ClinicalTemplateIdempotency {
  return {
    key,
    operationId,
    requestHash: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    ttlMs: 86_400_000,
  };
}
