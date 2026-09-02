/**
 * Minimal AWS Signature Version 4 signer for the Cloudflare R2 S3-compatible API.
 *
 * WHY THIS IS HAND-WRITTEN INSTEAD OF A DEPENDENCY
 * ------------------------------------------------
 * The project already rejected the Firebase Admin SDK because its resolved
 * dependency graph carried unresolved high-severity advisories through a large
 * transitive tree, and Firebase ID token verification turned out to be a small
 * amount of well-specified cryptography that Node's built-in `crypto` covers.
 * The same reasoning applies to object storage: `@aws-sdk/*` (or `aws4`) would
 * pull a broad transitive graph into a backend that needs five S3 verbs and one
 * documented signing algorithm. SigV4 is a fixed, published, testable recipe -
 * HMAC-SHA256 chaining over a canonical request - so implementing it here keeps
 * the supply-chain surface of the storage path at exactly zero third-party
 * packages while staying auditable against AWS's own published test vectors.
 *
 * The signer is deliberately transport-agnostic: it produces strings and headers
 * only. It never performs I/O, never logs and never returns the secret access
 * key. Callers pass a decoded path plus decoded query values so that canonical
 * URI/query encoding happens exactly once, in one place - double-encoding is the
 * most common cause of `SignatureDoesNotMatch` when a `URL` object's
 * already-percent-encoded parts are fed back into the canonical request.
 *
 * Scope limits: SigV4A (multi-region), chunked/streaming payload signing and STS
 * session tokens are intentionally not implemented. R2 needs none of them.
 */

import { createHash, createHmac } from 'node:crypto';

/** The only signing algorithm R2 accepts, and the only one implemented here. */
export const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256';

/** Payload placeholder for pre-signed URLs, whose body is not known at signing time. */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/** SHA-256 of the empty string, used as the payload hash of bodyless requests. */
export const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Terminator of the SigV4 credential scope; fixed by the specification. */
const SCOPE_TERMINATOR = 'aws4_request';

export interface SigV4Credentials {
  readonly accessKeyId: string;
  /**
   * Held only for the lifetime of a signing call. It is never placed in a
   * canonical request, an authorization header, a URL, a log line or an error.
   */
  readonly secretAccessKey: string;
}

export interface SigV4RequestTarget {
  readonly method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  /** Origin only, for example `https://<account>.r2.cloudflarestorage.com`. */
  readonly origin: string;
  /** Decoded, absolute path such as `/bucket/patients/01J.../scan.pdf`. */
  readonly path: string;
  /** Decoded query parameters; encoding is applied by this module. */
  readonly query?: Readonly<Record<string, string>> | undefined;
  /** Decoded header values. Must include `host`. */
  readonly headers: Readonly<Record<string, string>>;
  /** Hex SHA-256 of the body, {@link EMPTY_PAYLOAD_SHA256} or {@link UNSIGNED_PAYLOAD}. */
  readonly payloadHash: string;
}

export interface SigV4SigningParameters {
  readonly credentials: SigV4Credentials;
  readonly region: string;
  readonly service: string;
  readonly signedAt: Date;
}

export interface SigV4CanonicalRequest {
  readonly canonicalRequest: string;
  readonly canonicalUri: string;
  readonly canonicalQueryString: string;
  readonly canonicalHeaders: string;
  readonly signedHeaders: string;
}

export interface SigV4SignedHeaders {
  /** Headers to send, including `Authorization`. Excludes `host`, see below. */
  readonly headers: Readonly<Record<string, string>>;
  readonly authorization: string;
  readonly signature: string;
  readonly amzDate: string;
  readonly signedHeaders: string;
  /** Exposed for test-vector verification and debugging; contains no secret. */
  readonly canonicalRequest: string;
  readonly stringToSign: string;
}

export interface SigV4PresignedUrl {
  readonly url: URL;
  readonly signature: string;
  readonly amzDate: string;
  readonly signedHeaders: string;
  /** Exposed for test-vector verification and debugging; contains no secret. */
  readonly canonicalRequest: string;
  readonly stringToSign: string;
}

/**
 * Percent-encodes a value per RFC 3986, leaving only unreserved characters.
 *
 * `encodeURIComponent` leaves `!'()*` alone, which AWS requires to be encoded,
 * so those are fixed up explicitly.
 */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Encodes a decoded absolute path into a canonical URI.
 *
 * Each segment is encoded individually so `/` separators survive. S3 canonical
 * requests are single-encoded, so the caller must pass a decoded path.
 */
export function encodeCanonicalPath(path: string): string {
  if (!path.startsWith('/')) throw new TypeError('Canonical path must be absolute');
  return path.split('/').map(encodeRfc3986).join('/');
}

/** `YYYYMMDDTHHMMSSZ` basic-format timestamp used by every SigV4 field. */
export function formatAmzDate(signedAt: Date): string {
  const iso = signedAt.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** `YYYYMMDD` date stamp derived from an `X-Amz-Date` value. */
export function formatDateStamp(amzDate: string): string {
  return amzDate.slice(0, 8);
}

export function createCredentialScope(dateStamp: string, region: string, service: string): string {
  return `${dateStamp}/${region}/${service}/${SCOPE_TERMINATOR}`;
}

export function createCanonicalRequest(target: SigV4RequestTarget): SigV4CanonicalRequest {
  const canonicalUri = encodeCanonicalPath(target.path);
  const canonicalQueryString = createCanonicalQueryString(target.query ?? {});
  const { canonicalHeaders, signedHeaders } = createCanonicalHeaders(target.headers);
  const canonicalRequest = [
    target.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    target.payloadHash,
  ].join('\n');
  return Object.freeze({
    canonicalRequest,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
  });
}

export function createStringToSign(
  amzDate: string,
  credentialScope: string,
  canonicalRequest: string,
): string {
  return [
    SIGV4_ALGORITHM,
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n');
}

/**
 * Derives the date/region/service-scoped signing key.
 *
 * The chain exists so a leaked signature cannot be replayed against another day,
 * region or service, and so the long-lived secret is never used directly as an
 * HMAC key for request data.
 */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, SCOPE_TERMINATOR);
}

export function calculateSignature(signingKey: Buffer, stringToSign: string): string {
  return createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
}

/**
 * Signs a request with an `Authorization` header (server-to-R2 calls).
 *
 * `host` is signed but deliberately omitted from the returned headers: Node's
 * `fetch` sets `Host` itself from the URL, and passing it explicitly is either
 * ignored or rejected depending on the runtime.
 */
export function signRequestWithAuthorizationHeader(
  target: SigV4RequestTarget,
  parameters: SigV4SigningParameters,
): SigV4SignedHeaders {
  const amzDate = formatAmzDate(parameters.signedAt);
  const headersToSign: Record<string, string> = { ...target.headers };
  if (findHeader(headersToSign, 'host') === undefined) {
    throw new TypeError('A host header is required to sign a request');
  }
  if (findHeader(headersToSign, 'x-amz-date') === undefined) {
    headersToSign['x-amz-date'] = amzDate;
  }

  const canonical = createCanonicalRequest({ ...target, headers: headersToSign });
  const dateStamp = formatDateStamp(findHeader(headersToSign, 'x-amz-date') ?? amzDate);
  const credentialScope = createCredentialScope(dateStamp, parameters.region, parameters.service);
  const stringToSign = createStringToSign(
    findHeader(headersToSign, 'x-amz-date') ?? amzDate,
    credentialScope,
    canonical.canonicalRequest,
  );
  const signature = calculateSignature(
    deriveSigningKey(
      parameters.credentials.secretAccessKey,
      dateStamp,
      parameters.region,
      parameters.service,
    ),
    stringToSign,
  );
  const authorization =
    `${SIGV4_ALGORITHM} Credential=${parameters.credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${canonical.signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(headersToSign)) {
    if (name.toLowerCase() !== 'host') headers[name] = value;
  }
  headers.Authorization = authorization;

  return Object.freeze({
    headers: Object.freeze(headers),
    authorization,
    signature,
    amzDate: findHeader(headersToSign, 'x-amz-date') ?? amzDate,
    signedHeaders: canonical.signedHeaders,
    canonicalRequest: canonical.canonicalRequest,
    stringToSign,
  });
}

/**
 * Produces a query-signed URL that carries its own authorization.
 *
 * This is the only artefact that may ever be handed to a client: it grants one
 * method, one object key and any signed headers, for a short bounded window, and
 * it contains no secret material - only the access key id, the scope and the
 * derived signature.
 */
export function presignRequestUrl(
  target: SigV4RequestTarget,
  parameters: SigV4SigningParameters,
  expiresInSeconds: number,
): SigV4PresignedUrl {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new RangeError('Pre-signed expiry must be a positive whole number of seconds');
  }

  const amzDate = formatAmzDate(parameters.signedAt);
  const dateStamp = formatDateStamp(amzDate);
  const credentialScope = createCredentialScope(dateStamp, parameters.region, parameters.service);
  const { signedHeaders } = createCanonicalHeaders(target.headers);

  const query: Record<string, string> = {
    ...(target.query ?? {}),
    'X-Amz-Algorithm': SIGV4_ALGORITHM,
    'X-Amz-Credential': `${parameters.credentials.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  };

  const canonical = createCanonicalRequest({ ...target, query });
  const stringToSign = createStringToSign(amzDate, credentialScope, canonical.canonicalRequest);
  const signature = calculateSignature(
    deriveSigningKey(
      parameters.credentials.secretAccessKey,
      dateStamp,
      parameters.region,
      parameters.service,
    ),
    stringToSign,
  );

  const url = new URL(
    `${target.origin}${canonical.canonicalUri}?${canonical.canonicalQueryString}` +
      `&X-Amz-Signature=${signature}`,
  );

  return Object.freeze({
    url,
    signature,
    amzDate,
    signedHeaders: canonical.signedHeaders,
    canonicalRequest: canonical.canonicalRequest,
    stringToSign,
  });
}

function createCanonicalQueryString(query: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(query).map(
    ([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const,
  );
  pairs.sort((left, right) =>
    left[0] === right[0] ? compareBytes(left[1], right[1]) : compareBytes(left[0], right[0]),
  );
  return pairs.map(([name, value]) => `${name}=${value}`).join('&');
}

function createCanonicalHeaders(headers: Readonly<Record<string, string>>): {
  canonicalHeaders: string;
  signedHeaders: string;
} {
  const normalized = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase().trim(), collapseWhitespace(value)] as const)
    .sort((left, right) => compareBytes(left[0], right[0]));
  return {
    canonicalHeaders: normalized.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders: normalized.map(([name]) => name).join(';'),
  };
}

/** AWS canonicalization trims header values and collapses internal runs of space. */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function findHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  for (const [candidate, value] of Object.entries(headers)) {
    if (candidate.toLowerCase() === name) return value;
  }
  return undefined;
}

function compareBytes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}
