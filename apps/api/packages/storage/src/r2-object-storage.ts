/**
 * Cloudflare R2 object storage adapter over the S3-compatible REST API.
 *
 * WHY PRE-SIGNED URLS INSTEAD OF PROXYING BYTES
 * ---------------------------------------------
 * Clinical attachments (scans, reports, prescription images) are large relative to
 * anything else this API handles. Streaming them through NestJS would put file
 * bandwidth, buffering and timeout risk on the single VPS that also runs
 * PostgreSQL, MQTT and LiveKit - the exact contention the design record moves to
 * R2 to avoid. So bytes travel client <-> R2 directly, while authorization,
 * metadata, checksums, scan state, retention and audit stay in PostgreSQL.
 *
 * WHY CLIENTS NEVER SEE CREDENTIALS
 * ---------------------------------
 * ASSERTION: the R2 access key id and secret access key are server-only. The only
 * artefact that may cross the API boundary is a pre-signed URL, which authorizes
 * exactly one HTTP method against exactly one object key, with exactly the headers
 * that were signed, for a short bounded window. A pre-signed URL contains the
 * access key id and a derived signature - never the secret - and this adapter
 * never logs, returns, or embeds the secret in any error message. Bucket
 * credentials also stay minimum-privilege, so a leaked signature cannot be
 * escalated into bucket enumeration.
 *
 * WHY SIGV4 IS HAND-IMPLEMENTED
 * -----------------------------
 * See `aws-signature-v4.ts`. In short: the Firebase Admin SDK was rejected from
 * this project for carrying unresolved high-severity advisories through a large
 * transitive graph, and the same caution applies to `@aws-sdk/*`. SigV4 for the
 * five verbs used here is a contained, testable amount of code on top of Node's
 * built-in `crypto`, so the storage path adds zero third-party packages.
 *
 * R2 VERSIONING IS NOT A BACKUP
 * -----------------------------
 * R2 durability, bucket versioning and lifecycle rules are operational recovery
 * conveniences inside the same provider and credential failure domain. They do not
 * survive account loss, credential compromise or a mistaken lifecycle rule.
 * Independent backup means an encrypted export of required objects plus a
 * PostgreSQL-linked manifest to a separately credentialed destination, with a
 * rehearsed restore of both metadata and bytes. Nothing in this file provides that.
 */

import { createHash } from 'node:crypto';
import {
  EMPTY_PAYLOAD_SHA256,
  presignRequestUrl,
  signRequestWithAuthorizationHeader,
  UNSIGNED_PAYLOAD,
  encodeCanonicalPath,
  type SigV4Credentials,
  type SigV4RequestTarget,
} from './aws-signature-v4.js';
import { assertObjectKey } from './object-key.js';
import {
  ObjectChecksumMismatchError,
  ObjectChecksumUnavailableError,
  ObjectNotFoundError,
  ObjectStorageRequestError,
  type CopyObjectRequest,
  type PresignedObjectOperation,
  type PresignedUploadRequest,
  type PrivateFileStorageProvider,
  type PrivateObjectHead,
  type PutObjectRequest,
  type RemoteObjectStorageProvider,
  type StoredObject,
  type StoredObjectMetadata,
} from './object-storage.js';

/** R2 exposes a single global endpoint, so the signing region is always `auto`. */
export const R2_SIGNING_REGION = 'auto';

/** R2 speaks the S3 API, so the signing service name is `s3`. */
export const R2_SIGNING_SERVICE = 's3';

/** Short by default: a signature is a bearer capability, so it should die quickly. */
export const DEFAULT_PRESIGNED_EXPIRY_SECONDS = 300;

/**
 * Hard ceiling on any pre-signed URL, regardless of caller input.
 *
 * One hour is the longest window that can still be argued as "short lived" for a
 * capability that needs no further authorization once issued.
 */
export const MAXIMUM_PRESIGNED_EXPIRY_SECONDS = 3_600;

/**
 * Hard ceiling for the private FILE pipeline: fifteen minutes.
 *
 * Tighter than {@link MAXIMUM_PRESIGNED_EXPIRY_SECONDS} on purpose. A pre-signed
 * URL for a verification document is a bearer capability over identity evidence
 * (a licence, an IC scan). It needs to survive one upload or one viewer load on a
 * mobile connection, not an hour of forwarding, so the window is set by what the
 * operation needs rather than by what the signer permits.
 */
export const MAXIMUM_PRIVATE_FILE_PRESIGNED_EXPIRY_SECONDS = 900;

/** Default private-file window: long enough for a slow upload, short enough to expire. */
export const DEFAULT_PRIVATE_FILE_PRESIGNED_EXPIRY_SECONDS = 300;

/** Every request is bounded; a hung storage call must not hold an API worker. */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Ceiling on a server-side download, so a large object cannot exhaust heap. */
const DEFAULT_MAX_DOWNLOAD_BYTES = 32 * 1_024 * 1_024;

/** User metadata key holding the hex SHA-256 the platform recorded for an object. */
const SHA256_METADATA_HEADER = 'x-amz-meta-sha256';

const HEX_SHA256 = /^[0-9a-f]{64}$/;

export interface R2ObjectStorageOptions {
  readonly accountId: string;
  readonly bucket: string;
  readonly endpoint: URL;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Default pre-signed lifetime; clamped by {@link MAXIMUM_PRESIGNED_EXPIRY_SECONDS}. */
  readonly presignedUrlExpirySeconds?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly maxDownloadBytes?: number | undefined;
  /** Injectable for tests; production uses the global `fetch`. */
  readonly fetchImpl?: typeof fetch | undefined;
  readonly now?: (() => Date) | undefined;
}

interface RemoteObjectStat {
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly etag: string;
  /** Undefined when the object carries no recorded checksum metadata. */
  readonly sha256: string | undefined;
}

export class R2ObjectStorage implements RemoteObjectStorageProvider, PrivateFileStorageProvider {
  readonly #origin: string;
  readonly #bucket: string;
  readonly #credentials: SigV4Credentials;
  readonly #defaultExpirySeconds: number;
  readonly #timeoutMs: number;
  readonly #maxDownloadBytes: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  /**
   * Fails closed on configuration. A backend that starts with a blank bucket or a
   * plaintext endpoint would look healthy and silently lose or expose files, so
   * construction is the last point where that can be refused cheaply.
   *
   * Validation messages never echo a supplied value, because one of those values
   * is the secret access key.
   */
  constructor(options: R2ObjectStorageOptions) {
    requirePresent(options.accountId, 'R2 account id');
    this.#bucket = requirePresent(options.bucket, 'R2 bucket');
    this.#credentials = Object.freeze({
      accessKeyId: requirePresent(options.accessKeyId, 'R2 access key id'),
      secretAccessKey: requirePresent(options.secretAccessKey, 'R2 secret access key'),
    });

    const endpoint = options.endpoint;
    if (endpoint.protocol !== 'https:') {
      throw new Error('R2 endpoint must use HTTPS');
    }
    if (endpoint.hostname.length === 0) {
      throw new Error('R2 endpoint must have a hostname');
    }
    if (endpoint.username.length > 0 || endpoint.password.length > 0) {
      // Credentials belong in signed requests, not in a URL that could be logged.
      throw new Error('R2 endpoint must not embed credentials');
    }
    this.#origin = endpoint.origin;

    this.#defaultExpirySeconds = boundedExpiry(
      options.presignedUrlExpirySeconds ?? DEFAULT_PRESIGNED_EXPIRY_SECONDS,
    );
    this.#timeoutMs = positiveInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      'R2 request timeout',
    );
    this.#maxDownloadBytes = positiveInteger(
      options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES,
      'R2 maximum download size',
    );
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Uploads bytes from the server.
   *
   * Used for backend-generated artefacts (exports, manifests, thumbnails). Normal
   * user uploads go through {@link createUploadOperation} instead, so user bytes
   * never transit the API. The payload hash is the real body hash - not
   * `UNSIGNED-PAYLOAD` - so the signature itself covers the bytes, and
   * `x-amz-checksum-sha256` asks R2 to reject a corrupted transfer server-side.
   */
  async put(request: PutObjectRequest): Promise<StoredObjectMetadata> {
    assertObjectKey(request.key);
    if (request.contentType.trim().length === 0) throw new TypeError('contentType is required');

    const bytes = Uint8Array.from(request.bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (request.expectedSha256 !== undefined && request.expectedSha256.toLowerCase() !== sha256) {
      throw new ObjectChecksumMismatchError();
    }

    const response = await this.#send(
      'put',
      {
        method: 'PUT',
        origin: this.#origin,
        path: this.#objectPath(request.key),
        headers: {
          host: this.#host(),
          'content-type': request.contentType,
          'x-amz-content-sha256': sha256,
          'x-amz-checksum-sha256': hexToBase64(sha256),
          [SHA256_METADATA_HEADER]: sha256,
        },
        payloadHash: sha256,
      },
      bytes,
    );

    if (response.status === 404) throw new ObjectNotFoundError(request.key);
    if (!response.ok) throw new ObjectStorageRequestError('put', 'status', response.status);

    return Object.freeze({
      key: request.key,
      contentType: request.contentType,
      size: bytes.byteLength,
      sha256,
      etag: normalizeEtag(response.headers.get('etag')) ?? `sha256:${sha256}`,
    });
  }

  /**
   * Downloads an object and verifies it on the way through.
   *
   * The checksum is always recomputed from the received bytes. When the object
   * carries recorded checksum metadata and the two disagree, the read is rejected
   * rather than returned, because a silent mismatch is how corrupted or swapped
   * clinical files reach a chart.
   */
  async get(key: string): Promise<StoredObject> {
    assertObjectKey(key);
    const response = await this.#send('get', {
      method: 'GET',
      origin: this.#origin,
      path: this.#objectPath(key),
      headers: { host: this.#host(), 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256 },
      payloadHash: EMPTY_PAYLOAD_SHA256,
    });

    if (response.status === 404) throw new ObjectNotFoundError(key);
    if (!response.ok) throw new ObjectStorageRequestError('get', 'status', response.status);

    const declaredSize = parseSize(response.headers.get('content-length'));
    if (declaredSize !== undefined && declaredSize > this.#maxDownloadBytes) {
      throw new ObjectStorageRequestError('get', 'protocol');
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new ObjectStorageRequestError('get', 'network');
    }
    if (bytes.byteLength > this.#maxDownloadBytes) {
      throw new ObjectStorageRequestError('get', 'protocol');
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const recorded = readRecordedSha256(response.headers.get(SHA256_METADATA_HEADER));
    if (recorded !== undefined && recorded !== sha256) throw new ObjectChecksumMismatchError();

    return Object.freeze({
      key,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      size: bytes.byteLength,
      sha256,
      etag: normalizeEtag(response.headers.get('etag')) ?? `sha256:${sha256}`,
      bytes,
    });
  }

  /**
   * Stats an object without transferring it.
   *
   * Returns `undefined` for a missing object, matching the in-memory adapter. An
   * object that exists but has no recorded checksum raises
   * {@link ObjectChecksumUnavailableError}: the shared metadata shape promises a
   * SHA-256, and fabricating one would be worse than failing.
   */
  async head(key: string): Promise<StoredObjectMetadata | undefined> {
    const stat = await this.#stat(key, 'head');
    if (stat === undefined) return undefined;
    if (stat.sha256 === undefined) throw new ObjectChecksumUnavailableError(key);
    return Object.freeze({
      key: stat.key,
      contentType: stat.contentType,
      size: stat.size,
      sha256: stat.sha256,
      etag: stat.etag,
    });
  }

  /**
   * Deletes an object, reporting whether it existed.
   *
   * S3 DELETE is idempotent and answers 204 either way, so existence is checked
   * first to keep the boolean contract of the provider interface. That costs one
   * extra cheap metadata call and is only used on the delete path.
   */
  async delete(key: string): Promise<boolean> {
    const existing = await this.#stat(key, 'delete');
    if (existing === undefined) return false;

    const response = await this.#send('delete', {
      method: 'DELETE',
      origin: this.#origin,
      path: this.#objectPath(key),
      headers: { host: this.#host(), 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256 },
      payloadHash: EMPTY_PAYLOAD_SHA256,
    });

    if (response.status === 404) return false;
    if (response.status !== 204 && response.status !== 200) {
      throw new ObjectStorageRequestError('delete', 'status', response.status);
    }
    return true;
  }

  /**
   * Mints a short-lived pre-signed PUT for a client upload.
   *
   * The signature binds the method, the object key and `content-type`, so a client
   * cannot repoint the capability at another key or smuggle a different declared
   * type. When the intent declared a checksum, `x-amz-checksum-sha256` and the
   * recorded metadata header are bound too, which makes R2 reject bytes that do
   * not hash to the declared value and leaves the checksum queryable afterwards.
   *
   * The returned URL carries the access key id and a derived signature only. No
   * secret leaves the server.
   */
  async createUploadOperation(
    key: string,
    contentType: string,
    expiresInSeconds: number = this.#defaultExpirySeconds,
    expectedSha256?: string,
  ): Promise<PresignedObjectOperation> {
    assertObjectKey(key);
    if (contentType.trim().length === 0) throw new TypeError('contentType is required');
    const expiry = boundedExpiry(expiresInSeconds);

    const requiredHeaders: Record<string, string> = { 'content-type': contentType };
    if (expectedSha256 !== undefined) {
      const declared = expectedSha256.toLowerCase();
      if (!HEX_SHA256.test(declared)) {
        throw new TypeError('expectedSha256 must be a lowercase hex SHA-256 digest');
      }
      requiredHeaders['x-amz-checksum-sha256'] = hexToBase64(declared);
      requiredHeaders[SHA256_METADATA_HEADER] = declared;
    }

    return this.#presign('PUT', key, requiredHeaders, expiry);
  }

  /**
   * Mints a short-lived pre-signed GET for a client download.
   *
   * Authorization is decided by NestJS before this is called; the URL is the
   * narrow, expiring result of that decision, not a substitute for it.
   */
  async createDownloadOperation(
    key: string,
    expiresInSeconds: number = this.#defaultExpirySeconds,
  ): Promise<PresignedObjectOperation> {
    assertObjectKey(key);
    return this.#presign('GET', key, {}, boundedExpiry(expiresInSeconds));
  }

  /**
   * Copies an object inside the bucket without moving bytes through the API.
   *
   * Used for finalize/quarantine promotion and retention snapshots. Passing
   * `contentType` or `sha256` switches R2 to metadata REPLACE, which is also how a
   * checksum verified during finalize becomes permanently recorded metadata;
   * otherwise source metadata (including any recorded checksum) is inherited.
   */
  async copy(request: CopyObjectRequest): Promise<StoredObjectMetadata> {
    assertObjectKey(request.sourceKey);
    assertObjectKey(request.destinationKey);
    if (request.sourceKey === request.destinationKey && request.contentType === undefined &&
      request.sha256 === undefined) {
      throw new TypeError('A same-key copy must replace content type or checksum metadata');
    }

    const headers: Record<string, string> = {
      host: this.#host(),
      'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256,
      'x-amz-copy-source': encodeCanonicalPath(this.#objectPath(request.sourceKey)),
    };
    if (request.contentType !== undefined || request.sha256 !== undefined) {
      headers['x-amz-metadata-directive'] = 'REPLACE';
    }
    if (request.contentType !== undefined) {
      if (request.contentType.trim().length === 0) throw new TypeError('contentType is required');
      headers['content-type'] = request.contentType;
    }
    if (request.sha256 !== undefined) {
      const declared = request.sha256.toLowerCase();
      if (!HEX_SHA256.test(declared)) {
        throw new TypeError('sha256 must be a lowercase hex SHA-256 digest');
      }
      headers[SHA256_METADATA_HEADER] = declared;
    }

    const response = await this.#send('copy', {
      method: 'PUT',
      origin: this.#origin,
      path: this.#objectPath(request.destinationKey),
      headers,
      payloadHash: EMPTY_PAYLOAD_SHA256,
    });

    if (response.status === 404) throw new ObjectNotFoundError(request.sourceKey);
    if (!response.ok) throw new ObjectStorageRequestError('copy', 'status', response.status);

    // CopyObject can answer 200 and still carry a failure in its XML body, so the
    // body is inspected before the copy is reported as successful.
    let body: string;
    try {
      body = await response.text();
    } catch {
      throw new ObjectStorageRequestError('copy', 'network');
    }
    if (body.includes('<Error')) throw new ObjectStorageRequestError('copy', 'protocol');

    const destination = await this.head(request.destinationKey);
    if (destination === undefined) throw new ObjectStorageRequestError('copy', 'protocol');
    return destination;
  }

  /**
   * Confirms a stored object still hashes to the checksum PostgreSQL recorded.
   *
   * This is the integrity challenge used by finalize and by restore rehearsal. It
   * intentionally reads the bytes: metadata alone proves only what was declared,
   * not what is stored. A mismatch raises the package's existing
   * {@link ObjectChecksumMismatchError} so callers treat store corruption and
   * upload corruption the same way.
   */
  async verifySha256(key: string, expectedSha256: string): Promise<StoredObjectMetadata> {
    const expected = expectedSha256.toLowerCase();
    if (!HEX_SHA256.test(expected)) {
      throw new TypeError('expectedSha256 must be a lowercase hex SHA-256 digest');
    }
    const stored = await this.get(key);
    if (stored.sha256 !== expected) throw new ObjectChecksumMismatchError();
    return Object.freeze({
      key: stored.key,
      contentType: stored.contentType,
      size: stored.size,
      sha256: stored.sha256,
      etag: stored.etag,
    });
  }

  /**
   * Mints the upload capability handed to a client for a private file.
   *
   * The declared checksum is mandatory here, unlike on
   * {@link createUploadOperation}: this is the entry point for user-supplied
   * identity evidence, and binding `x-amz-checksum-sha256` into the signature is
   * what makes the store itself refuse bytes that hash to anything else. Without
   * it the platform would record a digest it never had the chance to enforce.
   *
   * Expiry is capped at {@link MAXIMUM_PRIVATE_FILE_PRESIGNED_EXPIRY_SECONDS}
   * regardless of what the caller asks for.
   */
  async createPresignedUploadUrl(
    request: PresignedUploadRequest,
  ): Promise<PresignedObjectOperation> {
    if (!HEX_SHA256.test(request.expectedSha256.toLowerCase())) {
      throw new TypeError('expectedSha256 must be a lowercase hex SHA-256 digest');
    }
    return this.createUploadOperation(
      request.key,
      request.contentType,
      privateFileExpiry(request.expiresInSeconds),
      request.expectedSha256.toLowerCase(),
    );
  }

  /**
   * Mints the download capability for a private file.
   *
   * Authorization, finalize state and scan state are decided by PostgreSQL before
   * this is reached. The URL is the narrow, expiring result of that decision and
   * never a substitute for it.
   */
  async createPresignedDownloadUrl(
    key: string,
    expiresInSeconds?: number,
  ): Promise<PresignedObjectOperation> {
    return this.createDownloadOperation(key, privateFileExpiry(expiresInSeconds));
  }

  /**
   * Stats an object for the finalize path, reporting a missing checksum as
   * `undefined` instead of raising.
   *
   * `head` fails closed when an object carries no recorded SHA-256 because its
   * return type promises one. Finalize needs the weaker answer: "the store has no
   * checksum for this key" is a legitimate outcome that must be treated as a
   * mismatch and audited, not turned into a 500.
   */
  async headObject(key: string): Promise<PrivateObjectHead | undefined> {
    const stat = await this.#stat(key, 'headObject');
    if (stat === undefined) return undefined;
    return Object.freeze({
      key: stat.key,
      contentType: stat.contentType,
      size: stat.size,
      etag: stat.etag,
      sha256: stat.sha256,
    });
  }

  async #stat(key: string, operation: string): Promise<RemoteObjectStat | undefined> {
    assertObjectKey(key);
    const response = await this.#send(operation, {
      method: 'HEAD',
      origin: this.#origin,
      path: this.#objectPath(key),
      headers: { host: this.#host(), 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256 },
      payloadHash: EMPTY_PAYLOAD_SHA256,
    });

    if (response.status === 404) return undefined;
    if (!response.ok) throw new ObjectStorageRequestError(operation, 'status', response.status);

    return Object.freeze({
      key,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      size: parseSize(response.headers.get('content-length')) ?? 0,
      etag: normalizeEtag(response.headers.get('etag')) ?? '',
      sha256: readRecordedSha256(response.headers.get(SHA256_METADATA_HEADER)),
    });
  }

  #presign(
    method: 'GET' | 'PUT',
    key: string,
    requiredHeaders: Readonly<Record<string, string>>,
    expiresInSeconds: number,
  ): PresignedObjectOperation {
    const signedAt = this.#now();
    const presigned = presignRequestUrl(
      {
        method,
        origin: this.#origin,
        path: this.#objectPath(key),
        // `host` is signed so the capability cannot be replayed against another
        // endpoint; the remaining signed headers are the ones the client must send.
        headers: { host: this.#host(), ...requiredHeaders },
        payloadHash: UNSIGNED_PAYLOAD,
      },
      {
        credentials: this.#credentials,
        region: R2_SIGNING_REGION,
        service: R2_SIGNING_SERVICE,
        signedAt,
      },
      expiresInSeconds,
    );

    return Object.freeze({
      method,
      url: presigned.url,
      expiresAt: new Date(signedAt.getTime() + expiresInSeconds * 1_000),
      requiredHeaders: Object.freeze({ ...requiredHeaders }),
    });
  }

  /**
   * Performs one signed request with a hard timeout.
   *
   * Every transport outcome collapses into {@link ObjectStorageRequestError}: the
   * raw `fetch` rejection is not attached, because its message repeats the request
   * target and request targets here can contain signatures.
   */
  async #send(
    operation: string,
    target: SigV4RequestTarget,
    body?: Uint8Array,
  ): Promise<Response> {
    const signed = signRequestWithAuthorizationHeader(target, {
      credentials: this.#credentials,
      region: R2_SIGNING_REGION,
      service: R2_SIGNING_SERVICE,
      signedAt: this.#now(),
    });

    const url = new URL(`${target.origin}${encodeCanonicalPath(target.path)}`);
    for (const [name, value] of Object.entries(target.query ?? {})) {
      url.searchParams.set(name, value);
    }

    try {
      return await this.#fetch(url, {
        method: target.method,
        headers: { ...signed.headers },
        ...(body === undefined ? {} : { body: bodyOf(body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
        // A storage redirect would move a signed request to an unsigned host.
        redirect: 'error',
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network';
      throw new ObjectStorageRequestError(operation, reason);
    }
  }

  #objectPath(key: string): string {
    // R2 uses path-style addressing: /<bucket>/<key>.
    return `/${this.#bucket}/${key}`;
  }

  #host(): string {
    return new URL(this.#origin).host;
  }
}

function requirePresent(value: string, label: string): string {
  const trimmed = value.trim();
  // Never interpolate the value: one of these labels covers the secret access key.
  if (trimmed.length === 0) throw new Error(`${label} is required`);
  return trimmed;
}

function boundedExpiry(expiresInSeconds: number): number {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new RangeError('Pre-signed expiry must be a positive whole number of seconds');
  }
  if (expiresInSeconds > MAXIMUM_PRESIGNED_EXPIRY_SECONDS) {
    throw new RangeError(
      `Pre-signed expiry must not exceed ${MAXIMUM_PRESIGNED_EXPIRY_SECONDS} seconds`,
    );
  }
  return expiresInSeconds;
}

/**
 * Clamps a private-file window to fifteen minutes.
 *
 * A caller asking for longer is refused rather than quietly shortened: silently
 * issuing a URL that expires before the caller expects produces failures that
 * look like storage faults, and the caller has stated an intent that this
 * pipeline will not honour.
 */
function privateFileExpiry(expiresInSeconds: number | undefined): number {
  const requested = expiresInSeconds ?? DEFAULT_PRIVATE_FILE_PRESIGNED_EXPIRY_SECONDS;
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new RangeError('Pre-signed expiry must be a positive whole number of seconds');
  }
  if (requested > MAXIMUM_PRIVATE_FILE_PRESIGNED_EXPIRY_SECONDS) {
    throw new RangeError(
      `Private file pre-signed expiry must not exceed ${MAXIMUM_PRIVATE_FILE_PRESIGNED_EXPIRY_SECONDS} seconds`,
    );
  }
  return requested;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function hexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

function readRecordedSha256(header: string | null): string | undefined {
  const value = header?.trim().toLowerCase();
  return value !== undefined && HEX_SHA256.test(value) ? value : undefined;
}

function normalizeEtag(header: string | null): string | undefined {
  const value = header?.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseSize(header: string | null): number | undefined {
  if (header === null) return undefined;
  const size = Number(header);
  return Number.isInteger(size) && size >= 0 ? size : undefined;
}

/** Copies into a plain buffer so the request body cannot alias caller memory. */
function bodyOf(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}
