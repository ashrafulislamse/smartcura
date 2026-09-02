/**
 * Shared `Idempotency-Key` handling.
 *
 * The rules are the ones `MembershipRepository` established, restated here so the
 * verification routes cannot drift from them:
 *
 *   * a key is claimed inside the mutation transaction with
 *     `ON CONFLICT DO NOTHING`, so two concurrent requests cannot both proceed;
 *   * a completed key replays the STORED response snapshot, never a fresh read of
 *     current state - reloading would let a replay observe later mutations, which
 *     breaks the guarantee the header makes to the client;
 *   * a key whose request hash differs is a reuse error, not a replay;
 *   * an expired key carries no replay guarantee any more, so the row is
 *     reclaimed rather than blocking the caller forever.
 */

import type { PoolClient, QueryResultRow } from 'pg';

export interface IdempotencyScope {
  readonly organizationId: string;
  readonly actorProfileId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface IdempotencyRecord extends QueryResultRow {
  readonly requestHash: string;
  readonly state: string;
  readonly responseStatus: number | null;
  readonly responseBody: Record<string, unknown> | null;
  readonly expired: boolean;
}

export async function loadIdempotency(
  client: PoolClient,
  scope: IdempotencyScope,
  now: Date,
  lock: boolean,
): Promise<IdempotencyRecord | undefined> {
  const result = await client.query<IdempotencyRecord>(
    `SELECT request_hash AS "requestHash", state,
     response_status AS "responseStatus", response_body AS "responseBody",
     (expires_at <= $5) AS expired
     FROM idempotency_keys
     WHERE organization_id = $1 AND actor_profile_id = $2
       AND operation_id = $3 AND idempotency_key = $4
     ${lock ? 'FOR UPDATE' : ''}`,
    [scope.organizationId, scope.actorProfileId, scope.operationId, scope.idempotencyKey, now],
  );
  return result.rows[0];
}

export async function deleteIdempotency(
  client: PoolClient,
  scope: IdempotencyScope,
): Promise<void> {
  await client.query(
    `DELETE FROM idempotency_keys
     WHERE organization_id = $1 AND actor_profile_id = $2
       AND operation_id = $3 AND idempotency_key = $4`,
    [scope.organizationId, scope.actorProfileId, scope.operationId, scope.idempotencyKey],
  );
}

/** Returns false when another request already holds the key. */
export async function claimIdempotency(
  client: PoolClient,
  scope: IdempotencyScope,
  expiresAt: Date,
): Promise<boolean> {
  const claimed = await client.query(
    `INSERT INTO idempotency_keys
     (organization_id, actor_profile_id, operation_id, idempotency_key,
      request_hash, state, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'processing', $6)
     ON CONFLICT (organization_id, actor_profile_id, operation_id, idempotency_key)
     DO NOTHING RETURNING idempotency_key`,
    [
      scope.organizationId, scope.actorProfileId, scope.operationId,
      scope.idempotencyKey, scope.requestHash, expiresAt,
    ],
  );
  return claimed.rowCount === 1;
}

export async function completeIdempotency(
  client: PoolClient,
  scope: IdempotencyScope,
  responseStatus: number,
  responseBody: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys
     SET state = 'completed', response_status = $5, response_body = $6, updated_at = $7
     WHERE organization_id = $1 AND actor_profile_id = $2
       AND operation_id = $3 AND idempotency_key = $4`,
    [
      scope.organizationId, scope.actorProfileId, scope.operationId,
      scope.idempotencyKey, responseStatus, responseBody, now,
    ],
  );
}
