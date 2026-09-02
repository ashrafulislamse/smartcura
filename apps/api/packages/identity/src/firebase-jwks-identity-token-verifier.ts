/**
 * Verifies Firebase ID tokens directly against Google's published signing keys.
 *
 * This exists instead of the Firebase Admin SDK because that SDK's resolved
 * dependency graph carried unresolved high-severity advisories through its Google
 * Cloud transitive packages, and no pinned combination cleared them without an
 * inappropriate breaking downgrade. Verification of a Firebase ID token needs
 * only RS256 signature checking plus claim validation, both of which Node's
 * built-in `crypto` provides, so the vendor SDK adds risk without adding
 * capability here.
 *
 * Deliberate limitation: the Admin SDK can additionally check whether a user has
 * been disabled or had their tokens revoked server-side, which requires a
 * privileged Identity Toolkit call. This verifier does not do that, so a revoked
 * user stays accepted until their short-lived ID token expires (one hour at
 * most). Application sessions are independently revocable, and membership or
 * profile suspension ends live sessions immediately, so the exposure is bounded
 * to token lifetime for the identity layer only. Anything needing
 * stricter-than-one-hour identity revocation must not rely on this verifier
 * alone.
 */

import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto';
import {
  IdentityTokenVerificationError,
  type IdentityTokenVerifier,
  type VerifiedIdentity,
} from './identity-token-verifier.js';
import type { PublicKeySource } from './google-public-key-source.js';

interface TokenHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
}

interface TokenClaims {
  readonly aud?: unknown;
  readonly iss?: unknown;
  readonly sub?: unknown;
  readonly iat?: unknown;
  readonly exp?: unknown;
  readonly auth_time?: unknown;
  readonly email?: unknown;
  readonly email_verified?: unknown;
  readonly firebase?: unknown;
}

/** Absorbs benign clock skew between this host and Google's signing service. */
const CLOCK_SKEW_SECONDS = 60;

/** Firebase ID tokens are always RS256; accepting anything else invites confusion attacks. */
const REQUIRED_ALGORITHM = 'RS256';

export class FirebaseJwksIdentityTokenVerifier implements IdentityTokenVerifier {
  constructor(
    private readonly keys: PublicKeySource,
    private readonly projectId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (projectId.trim().length === 0) {
      throw new Error('A Firebase project id is required to verify identity tokens');
    }
  }

  async verify(idToken: string): Promise<VerifiedIdentity> {
    try {
      return await this.verifyToken(idToken);
    } catch (error) {
      if (error instanceof IdentityTokenVerificationError) throw error;
      // Network, parsing and cryptographic failures are all reported as a single
      // opaque failure so a caller cannot probe why a token was rejected.
      throw new IdentityTokenVerificationError();
    }
  }

  private async verifyToken(idToken: string): Promise<VerifiedIdentity> {
    const segments = idToken.split('.');
    if (segments.length !== 3) throw new IdentityTokenVerificationError();
    const [encodedHeader, encodedPayload, encodedSignature] = segments as [string, string, string];

    const header = decodeJson<TokenHeader>(encodedHeader);
    if (header.alg !== REQUIRED_ALGORITHM) throw new IdentityTokenVerificationError();
    if (typeof header.kid !== 'string' || header.kid.length === 0) {
      throw new IdentityTokenVerificationError();
    }

    const certificate = await this.keys.certificateFor(header.kid);
    if (certificate === undefined) throw new IdentityTokenVerificationError();

    // Signature is checked before any claim is trusted.
    if (!verifySignature(`${encodedHeader}.${encodedPayload}`, encodedSignature, certificate)) {
      throw new IdentityTokenVerificationError();
    }

    return this.normalizeClaims(decodeJson<TokenClaims>(encodedPayload));
  }

  private normalizeClaims(claims: TokenClaims): VerifiedIdentity {
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);

    if (
      typeof claims.aud !== 'string' ||
      !constantTimeEquals(claims.aud, this.projectId) ||
      typeof claims.iss !== 'string' ||
      !constantTimeEquals(claims.iss, `https://securetoken.google.com/${this.projectId}`)
    ) throw new IdentityTokenVerificationError();

    if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 128) {
      throw new IdentityTokenVerificationError();
    }

    if (
      typeof claims.exp !== 'number' || claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS ||
      typeof claims.iat !== 'number' || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
      typeof claims.auth_time !== 'number' || claims.auth_time > nowSeconds + CLOCK_SKEW_SECONDS
    ) throw new IdentityTokenVerificationError();

    if (typeof claims.email !== 'string' || claims.email.length === 0) {
      throw new IdentityTokenVerificationError();
    }

    const firebase = claims.firebase;
    const secondFactor = firebase !== null && typeof firebase === 'object'
      ? (firebase as { readonly sign_in_second_factor?: unknown }).sign_in_second_factor
      : undefined;

    return Object.freeze({
      uid: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true,
      authTime: Object.freeze(new Date(claims.auth_time * 1_000)),
      mfaSatisfied: typeof secondFactor === 'string' && secondFactor.length > 0,
    });
  }
}

function decodeJson<T>(segment: string): T {
  const json = Buffer.from(segment, 'base64url').toString('utf8');
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new IdentityTokenVerificationError();
  }
  return parsed as T;
}

function verifySignature(signingInput: string, encodedSignature: string, certificate: string): boolean {
  const publicKey = createPublicKey(certificate);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput, 'utf8');
  verifier.end();
  return verifier.verify(publicKey, Buffer.from(encodedSignature, 'base64url'));
}

/** Compares equal-purpose strings without leaking length or content through timing. */
function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
