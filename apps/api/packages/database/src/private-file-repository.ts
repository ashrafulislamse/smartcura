import type { QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  FILE_SCAN_COMPLETED_EVENT_TYPE,
  FILE_SCAN_COMPLETED_EVENT_VERSION,
  type FileScanCompletionState,
} from './private-file-events.js';

export interface FileScanRecord {
  readonly objectId: string;
  readonly organizationId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly verifiedSha256: string;
}

export type ClaimFileScanResult = FileScanRecord | 'not_found' | 'ineligible' | 'terminal';
export type CompleteFileScanResult = 'completed' | 'already_completed' | 'not_found' | 'conflict';

export interface VerificationFileDownloadContext {
  readonly documentId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly ownerProfileId: string;
  readonly objectId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly verifiedSha256: string | null;
  readonly uploadState: string;
  readonly scanState: string;
  readonly downloadable: boolean;
}

interface ScanRow extends QueryResultRow {
  readonly objectId: string;
  readonly organizationId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: string;
  readonly declaredSha256: string;
  readonly verifiedSha256: string | null;
  readonly uploadState: string;
  readonly scanState: string;
}

interface DownloadRow extends QueryResultRow {
  readonly documentId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly ownerProfileId: string;
  readonly objectId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: string;
  readonly verifiedSha256: string | null;
  readonly uploadState: string;
  readonly scanState: string;
  readonly downloadable: boolean;
}

export class PrivateFileRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Claims a finalized object for scanning. `scanning` is reclaimable because a
   * worker may die after changing the row but before completing its leased outbox
   * event. Terminal verdicts are idempotent and never re-scanned by duplicate
   * delivery.
   */
  async claimScan(objectId: string, now: Date): Promise<ClaimFileScanResult> {
    return this.database.transaction(async (client) => {
      const result = await client.query<ScanRow>(
        `SELECT object_id AS "objectId", organization_id AS "organizationId",
         object_key AS "objectKey", media_type AS "contentType",
         byte_size AS "byteSize", declared_sha256 AS "declaredSha256",
         verified_sha256 AS "verifiedSha256", upload_status AS "uploadState",
         scan_state AS "scanState"
         FROM stored_objects WHERE object_id = $1 FOR UPDATE`,
        [objectId],
      );
      const row = result.rows[0];
      if (row === undefined) return 'not_found';
      if (row.scanState === 'clean' || row.scanState === 'infected' || row.scanState === 'scan_failed') {
        return 'terminal';
      }
      if (
        row.uploadState !== 'finalized' || row.verifiedSha256 === null ||
        row.verifiedSha256 !== row.declaredSha256
      ) return 'ineligible';
      await client.query(
        `UPDATE stored_objects SET scan_state = 'scanning', downloadable = false,
         scanned_at = NULL, version = version + 1, updated_at = $2
         WHERE object_id = $1`,
        [objectId, now],
      );
      return {
        objectId: row.objectId,
        organizationId: row.organizationId,
        objectKey: row.objectKey,
        contentType: row.contentType,
        byteSize: Number(row.byteSize),
        verifiedSha256: row.verifiedSha256,
      };
    });
  }

  /** Completes the verdict, quarantine/audit/event change atomically. */
  async completeScan(
    objectId: string,
    state: FileScanCompletionState,
    reasonCode: 'SCAN_CLEAN' | 'MALWARE_DETECTED' | 'FILE_SIGNATURE_MISMATCH' |
      'OBJECT_INTEGRITY_MISMATCH' | 'OBJECT_MISSING',
    now: Date,
    correlationId: string,
  ): Promise<CompleteFileScanResult> {
    return this.database.transaction(async (client) => {
      const result = await client.query<ScanRow>(
        `SELECT object_id AS "objectId", organization_id AS "organizationId",
         object_key AS "objectKey", media_type AS "contentType",
         byte_size AS "byteSize", declared_sha256 AS "declaredSha256",
         verified_sha256 AS "verifiedSha256", upload_status AS "uploadState",
         scan_state AS "scanState"
         FROM stored_objects WHERE object_id = $1 FOR UPDATE`,
        [objectId],
      );
      const row = result.rows[0];
      if (row === undefined) return 'not_found';
      if (row.scanState === state) return 'already_completed';
      if (
        row.scanState !== 'scanning' || row.uploadState !== 'finalized' ||
        row.verifiedSha256 === null || row.verifiedSha256 !== row.declaredSha256
      ) return 'conflict';

      const clean = state === 'clean';
      await client.query(
        `UPDATE stored_objects
         SET upload_status = $2::stored_object_status,
             scan_state = $3::malware_scan_state, downloadable = $4,
             scanned_at = $5, quarantined_at = $6,
             version = version + 1, updated_at = $5
         WHERE object_id = $1`,
        [objectId, clean ? 'finalized' : 'quarantined', state, clean, now, clean ? null : now],
      );
      await client.query(
        `INSERT INTO audit_logs
         (audit_id, organization_id, actor_profile_id, action, object_type,
          object_id, reason, correlation_id, metadata)
         VALUES (uuidv7(), $1, NULL, $2, 'stored_object', $3, $4, $5, $6)`,
        [
          row.organizationId,
          clean ? 'file.object.scan_clean' : 'file.object.quarantined',
          objectId,
          reasonCode,
          correlationId,
          { scan_state: state, downloadable: clean },
        ],
      );
      await client.query(
        `INSERT INTO outbox_events
         (event_id, event_type, event_version, aggregate_type, aggregate_id,
          aggregate_version, payload, correlation_id, occurred_at)
         SELECT uuidv7(), $1, $2, 'stored_object', object_id, version,
          $3, $4, $5 FROM stored_objects WHERE object_id = $6`,
        [
          FILE_SCAN_COMPLETED_EVENT_TYPE,
          FILE_SCAN_COMPLETED_EVENT_VERSION,
          { object_id: objectId, scan_state: state, downloadable: clean },
          correlationId,
          now,
          objectId,
        ],
      );
      return 'completed';
    });
  }

  /**
   * Resolves only a file linked through the verification document named by the
   * route. The composite database FK already guarantees the object and document
   * share an organization; this projection carries that relationship to policy.
   */
  async loadVerificationDownload(
    membershipId: string,
    documentId: string,
  ): Promise<VerificationFileDownloadContext | undefined> {
    const result = await this.database.query<DownloadRow>(
      `SELECT document.document_id AS "documentId",
       document.membership_id AS "membershipId",
       document.organization_id AS "organizationId",
       membership.profile_id AS "ownerProfileId",
       object.object_id AS "objectId", object.object_key AS "objectKey",
       object.media_type AS "contentType", object.byte_size AS "byteSize",
       object.verified_sha256 AS "verifiedSha256",
       object.upload_status AS "uploadState", object.scan_state AS "scanState",
       object.downloadable
       FROM verification_documents AS document
       JOIN organization_memberships AS membership
         ON membership.membership_id = document.membership_id
        AND membership.organization_id = document.organization_id
       JOIN stored_objects AS object
         ON object.object_id = document.object_id
        AND object.organization_id = document.organization_id
       WHERE document.membership_id = $1 AND document.document_id = $2`,
      [membershipId, documentId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : {
      documentId: row.documentId,
      membershipId: row.membershipId,
      organizationId: row.organizationId,
      ownerProfileId: row.ownerProfileId,
      objectId: row.objectId,
      objectKey: row.objectKey,
      contentType: row.contentType,
      byteSize: Number(row.byteSize),
      verifiedSha256: row.verifiedSha256,
      uploadState: row.uploadState,
      scanState: row.scanState,
      downloadable: row.downloadable,
    };
  }
}
