export interface StoredObjectMetadata {
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
  readonly etag: string;
}

export interface StoredObject extends StoredObjectMetadata {
  readonly bytes: Uint8Array;
}

export interface PutObjectRequest {
  readonly key: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly expectedSha256?: string;
}

export interface ObjectStorageProvider {
  put(request: PutObjectRequest): Promise<StoredObjectMetadata>;
  get(key: string): Promise<StoredObject>;
  head(key: string): Promise<StoredObjectMetadata | undefined>;
  delete(key: string): Promise<boolean>;
}

export interface PresignedObjectOperation {
  readonly method: 'GET' | 'PUT';
  readonly url: URL;
  readonly expiresAt: Date;
  readonly requiredHeaders: Readonly<Record<string, string>>;
}

export interface PresignedObjectStorageProvider extends ObjectStorageProvider {
  createUploadOperation(key: string, contentType: string, expiresInSeconds: number): Promise<PresignedObjectOperation>;
  createDownloadOperation(key: string, expiresInSeconds: number): Promise<PresignedObjectOperation>;
}

/**
 * A stat of a stored object that does NOT promise a checksum.
 *
 * {@link ObjectStorageProvider.head} raises when an object carries no recorded
 * SHA-256, because its metadata shape promises one. The private file pipeline
 * needs the opposite behaviour: at finalize time "the store has no checksum for
 * this key" is a legitimate answer that must be reported as a mismatch, not as
 * an exception, so the object can be moved to a rejected state and audited.
 */
export interface PrivateObjectHead {
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly etag: string;
  readonly sha256: string | undefined;
}

export interface PresignedUploadRequest {
  readonly key: string;
  readonly contentType: string;
  /**
   * Hex SHA-256 the client declared before uploading. It is bound INTO the
   * signature, so the store itself rejects bytes that hash to anything else.
   * Required: an unbound upload capability would let a client swap the file
   * after the platform had already recorded what it was told to expect.
   */
  readonly expectedSha256: string;
  readonly expiresInSeconds?: number | undefined;
}

/**
 * The narrow capability the verification and download routes depend on.
 *
 * Bytes must travel client <-> store directly, so a provider that cannot mint a
 * pre-signed capability cannot serve this pipeline at all. Callers narrow with
 * `supportsPrivateFilePipeline` rather than casting, so a misconfigured
 * deployment fails loudly instead of silently streaming files through the API.
 */
export interface PrivateFileStorageProvider extends ObjectStorageProvider {
  createPresignedUploadUrl(request: PresignedUploadRequest): Promise<PresignedObjectOperation>;
  createPresignedDownloadUrl(
    key: string,
    expiresInSeconds?: number,
  ): Promise<PresignedObjectOperation>;
  headObject(key: string): Promise<PrivateObjectHead | undefined>;
}

export interface CopyObjectRequest {
  readonly sourceKey: string;
  readonly destinationKey: string;
  /** When set, the destination is written with this content type instead of the source's. */
  readonly contentType?: string | undefined;
  /** When set, the destination records this hex SHA-256 as its checksum metadata. */
  readonly sha256?: string | undefined;
}

/**
 * A provider backed by a remote service, which can additionally copy bytes
 * server-side and re-confirm a stored object's checksum.
 *
 * Server-side copy exists so finalize/retention flows never stream an object down
 * to the API and back up again; verification exists because PostgreSQL owns the
 * authoritative checksum and must be able to challenge the store at any time.
 */
export interface RemoteObjectStorageProvider extends PresignedObjectStorageProvider {
  copy(request: CopyObjectRequest): Promise<StoredObjectMetadata>;
  verifySha256(key: string, expectedSha256: string): Promise<StoredObjectMetadata>;
}

export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
  }
}

export class ObjectChecksumMismatchError extends Error {
  constructor() {
    super('Object checksum does not match the expected SHA-256');
    this.name = 'ObjectChecksumMismatchError';
  }
}

/**
 * Raised when a stored object carries no recorded SHA-256.
 *
 * Fail closed rather than inventing a checksum: an object whose integrity cannot
 * be stated is not usable clinical evidence. Recording happens on upload, or on a
 * finalize step that verifies the bytes and copies the checksum into metadata.
 */
export class ObjectChecksumUnavailableError extends Error {
  constructor(readonly key: string) {
    super('Object has no recorded SHA-256 checksum');
    this.name = 'ObjectChecksumUnavailableError';
  }
}

export type ObjectStorageFailureReason = 'timeout' | 'network' | 'protocol' | 'status';

/**
 * Single typed failure for every remote-store transport problem.
 *
 * The underlying `fetch` rejection is deliberately not attached as `cause`: its
 * message and properties echo the request target, and request targets in this
 * package can carry pre-signed query signatures. A reason plus an HTTP status is
 * enough to triage without ever copying credentials, signatures or response
 * bodies into an error that may be logged.
 */
export class ObjectStorageRequestError extends Error {
  constructor(
    readonly operation: string,
    readonly reason: ObjectStorageFailureReason,
    readonly status?: number,
  ) {
    super(
      `Object storage ${operation} failed (${reason}${status === undefined ? '' : `, status ${status}`})`,
    );
    this.name = 'ObjectStorageRequestError';
  }
}
