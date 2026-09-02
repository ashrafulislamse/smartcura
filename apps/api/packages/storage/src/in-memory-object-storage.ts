import { createHash } from 'node:crypto';
import { assertObjectKey } from './object-key.js';
import {
  ObjectChecksumMismatchError,
  ObjectNotFoundError,
  type ObjectStorageProvider,
  type PutObjectRequest,
  type StoredObject,
  type StoredObjectMetadata,
} from './object-storage.js';

interface MemoryEntry extends StoredObjectMetadata {
  readonly bytes: Uint8Array;
}

export class InMemoryObjectStorage implements ObjectStorageProvider {
  readonly #objects = new Map<string, MemoryEntry>();

  async put(request: PutObjectRequest): Promise<StoredObjectMetadata> {
    assertObjectKey(request.key);
    if (request.contentType.trim().length === 0) throw new TypeError('contentType is required');

    const bytes = Uint8Array.from(request.bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (request.expectedSha256 !== undefined && request.expectedSha256.toLowerCase() !== sha256) {
      throw new ObjectChecksumMismatchError();
    }

    const entry: MemoryEntry = Object.freeze({
      key: request.key,
      contentType: request.contentType,
      size: bytes.byteLength,
      sha256,
      etag: `sha256:${sha256}`,
      bytes,
    });
    this.#objects.set(request.key, entry);
    return metadataOf(entry);
  }

  async get(key: string): Promise<StoredObject> {
    const entry = this.#objects.get(key);
    if (entry === undefined) throw new ObjectNotFoundError(key);
    return Object.freeze({ ...metadataOf(entry), bytes: Uint8Array.from(entry.bytes) });
  }

  async head(key: string): Promise<StoredObjectMetadata | undefined> {
    const entry = this.#objects.get(key);
    return entry === undefined ? undefined : metadataOf(entry);
  }

  async delete(key: string): Promise<boolean> {
    return this.#objects.delete(key);
  }

  clear(): void {
    this.#objects.clear();
  }
}

function metadataOf(entry: MemoryEntry): StoredObjectMetadata {
  return Object.freeze({
    key: entry.key,
    contentType: entry.contentType,
    size: entry.size,
    sha256: entry.sha256,
    etag: entry.etag,
  });
}
