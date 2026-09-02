import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  PrivateFileRepository,
  type FileScanCompletionState,
  type FileScanRecord,
} from '@smartcura/database';
import {
  hasExpectedFileSignature,
  MalwareScannerUnavailableError,
  ObjectChecksumMismatchError,
  ObjectNotFoundError,
  ObjectStorageRequestError,
  type MalwareScanner,
  type ObjectStorageProvider,
  type StoredObject,
} from '@smartcura/storage';
import { createUuidV7 } from '@smartcura/observability';

@Injectable()
export class PrivateFileScanHandler {
  constructor(
    private readonly files: PrivateFileRepository,
    private readonly storage: ObjectStorageProvider,
    private readonly scanner: MalwareScanner,
  ) {}

  /** False asks the outbox runtime to retry with bounded backoff. */
  async handle(objectId: string): Promise<boolean> {
    const claimed = await this.files.claimScan(objectId, new Date());
    if (claimed === 'terminal') return true;
    if (claimed === 'not_found' || claimed === 'ineligible') return false;

    let stored: StoredObject;
    try {
      stored = await this.storage.get(claimed.objectKey);
    } catch (error) {
      if (error instanceof ObjectStorageRequestError) return false;
      if (error instanceof ObjectNotFoundError) {
        return this.complete(claimed, 'scan_failed', 'OBJECT_MISSING');
      }
      if (error instanceof ObjectChecksumMismatchError) {
        return this.complete(claimed, 'scan_failed', 'OBJECT_INTEGRITY_MISMATCH');
      }
      throw error;
    }

    const digest = createHash('sha256').update(stored.bytes).digest('hex');
    if (
      digest !== claimed.verifiedSha256 || stored.sha256 !== claimed.verifiedSha256 ||
      stored.size !== claimed.byteSize || stored.bytes.byteLength !== claimed.byteSize ||
      stored.contentType !== claimed.contentType
    ) {
      return this.complete(claimed, 'scan_failed', 'OBJECT_INTEGRITY_MISMATCH');
    }
    if (!hasExpectedFileSignature(claimed.contentType, stored.bytes)) {
      return this.complete(claimed, 'scan_failed', 'FILE_SIGNATURE_MISMATCH');
    }

    try {
      const result = await this.scanner.scan(stored.bytes);
      return result.verdict === 'clean'
        ? this.complete(claimed, 'clean', 'SCAN_CLEAN')
        : this.complete(claimed, 'infected', 'MALWARE_DETECTED');
    } catch (error) {
      if (error instanceof MalwareScannerUnavailableError) return false;
      throw error;
    }
  }

  private async complete(
    record: FileScanRecord,
    state: FileScanCompletionState,
    reason: 'SCAN_CLEAN' | 'MALWARE_DETECTED' | 'FILE_SIGNATURE_MISMATCH' |
      'OBJECT_INTEGRITY_MISMATCH' | 'OBJECT_MISSING',
  ): Promise<boolean> {
    const result = await this.files.completeScan(
      record.objectId, state, reason, new Date(), createUuidV7(),
    );
    return result === 'completed' || result === 'already_completed';
  }
}
