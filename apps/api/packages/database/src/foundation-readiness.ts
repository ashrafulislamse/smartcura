import { PostgresConnection } from './connection.js';

export const FOUNDATION_SCHEMA_VERSION = 1;
/**
 * Must equal the `identity` row written by the newest identity migration.
 * Readiness deliberately requires an exact match so a deployment whose code and
 * schema disagree reports unready instead of serving traffic against a schema it
 * was not built for. Bump this in the same change as the migration.
 *
 * 28 is written by `0040_dead_letter_replay_history`; 27 came from `0039_schema_compatibility_monotonic`, which also stops this row
 * moving backwards. That migration exists because the Stage 11 migrations restarted
 * the sequence at 23 and 24 — values 0031 and 0033 had already consumed — so
 * applying 0035 to a database at 24 regressed the recorded version to 23. The end
 * state of a full run was still correct, which is why nothing failed locally; a
 * partial run would have left the schema newer than the number describing it.
 *
 * 29 is written by `0043_clinical_templates`, which adds the doctor-authored clinical
 * template table and its author-scoped indexes.
 *
 * 30 is written by `0050_unified_communication`, which adds notification priority
 * and expires_at, disables push devices on membership/profile revocation, and
 * grants notification permissions to every role.
 *
 * `test/schema-compatibility.test.ts` asserts this constant equals the highest
 * identity version any migration writes, so the two cannot drift again.
 */
export const IDENTITY_SCHEMA_VERSION = 30;
/**
 * The profile-detail schema introduced alongside verification and patient data.
 * Checked on the same exact-match basis as the other components: a component with
 * no compatibility row, or the wrong version, means this build was not written
 * against the schema in front of it.
 */
export const PROFILES_SCHEMA_VERSION = 3;

export interface FoundationReadinessCheck {
  readonly name: 'migrations' | 'worker';
  readonly ready: boolean;
}

export class FoundationReadinessRepository {
  constructor(private readonly database: PostgresConnection) {}

  async recordWorkerHeartbeat(workerId: string, buildVersion: string): Promise<void> {
    await this.database.query(
      `INSERT INTO worker_heartbeats (worker_id, build_version, last_seen_at)
       VALUES ($1, $2, now())
       ON CONFLICT (worker_id) DO UPDATE
       SET build_version = EXCLUDED.build_version, last_seen_at = now()`,
      [workerId, buildVersion],
    );
  }

  async check(workerMaxAgeMs: number): Promise<ReadonlyArray<FoundationReadinessCheck>> {
    const result = await this.database.query<{ migrationsReady: boolean; workerReady: boolean }>(
      `SELECT
         (EXISTS (
           SELECT 1 FROM schema_compatibility
           WHERE component = 'foundation' AND version = $1
         ) AND EXISTS (
           SELECT 1 FROM schema_compatibility
           WHERE component = 'identity' AND version = $2
         ) AND EXISTS (
           SELECT 1 FROM schema_compatibility
           WHERE component = 'profiles' AND version = $3
         )) AS "migrationsReady",
         EXISTS (
           SELECT 1 FROM worker_heartbeats
           WHERE last_seen_at >= now() - ($4::text || ' milliseconds')::interval
         ) AS "workerReady"`,
      [
        FOUNDATION_SCHEMA_VERSION,
        IDENTITY_SCHEMA_VERSION,
        PROFILES_SCHEMA_VERSION,
        workerMaxAgeMs,
      ],
    );
    const state = result.rows[0];
    return [
      { name: 'migrations', ready: state?.migrationsReady === true },
      { name: 'worker', ready: state?.workerReady === true },
    ];
  }
}
