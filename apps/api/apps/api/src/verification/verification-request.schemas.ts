import { z } from 'zod';
import {
  REVIEWABLE_VERIFICATION_STATUSES,
  VERIFICATION_DOCUMENT_KINDS,
  VERIFICATION_REASON_CODES,
} from '@smartcura/database';

/**
 * Same local definition as every other feature folder (`memberships`,
 * `profile-details`). Ids are uuidv7 or nothing: a v4 id here would still index,
 * but it would break the time-ordered ordering and lock ordering the
 * repositories rely on.
 */
const uuidV7 = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

/**
 * 64 LOWERCASE hex characters, matching `stored_objects_declared_sha256_check`
 * and `stored_objects_verified_sha256_check`. Mixed case is rejected rather than
 * folded: two spellings of one digest that compare unequal would silently defeat
 * the whole integrity check, and the store binds the lowercase form into the
 * pre-signed signature.
 */
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const idempotencyKeySchema = z.string().trim().min(16).max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);

export const membershipDocumentPathSchema = z.object({
  membershipId: uuidV7,
  documentId: uuidV7.optional(),
}).strict();

export const organizationDocumentPathSchema = z.object({
  organizationId: uuidV7,
  documentId: uuidV7,
}).strict();

/**
 * Listing is bounded even though only a handful of document kinds exist per
 * membership: an unbounded read is an unbounded read regardless of today's row
 * count. `page_size` mirrors `#/components/parameters/PageSize` so the contract
 * and the validator cannot drift.
 */
export const listVerificationDocumentsQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

/**
 * The only media types accepted for an identity or licence document.
 *
 * An open media type on the byte stream a reviewer will later open is an attack
 * surface, not a convenience: `text/html` or `image/svg+xml` in a private bucket
 * is a stored-XSS primitive the moment a signed URL is opened in a browser, and
 * the value is bound into the pre-signed signature so the store enforces exactly
 * what was declared here.
 */
export const VERIFICATION_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

/**
 * 10 MiB. A licence scan or an identity photograph does not need more, an
 * unbounded declared size would let a client reserve arbitrary retention cost
 * before uploading a byte, and the cap keeps `byte_size` far below
 * `Number.MAX_SAFE_INTEGER` so the repository's bigint narrowing stays exact.
 */
export const MAXIMUM_VERIFICATION_BYTE_SIZE = 10_485_760;

/**
 * The upload intent.
 *
 * Note what is NOT here: the object key. It is derived server-side from the
 * organization, membership and a fresh id, because a client-supplied key is a
 * direct route into another tenant's prefix. There is no reason code either - an
 * applicant's own submission is not a review decision, and only decisions carry
 * one.
 */
export const requestVerificationUploadSchema = z.object({
  document_kind: z.enum(VERIFICATION_DOCUMENT_KINDS),
  content_type: z.enum(VERIFICATION_CONTENT_TYPES),
  byte_size: z.number().int().min(1).max(MAXIMUM_VERIFICATION_BYTE_SIZE),
  declared_sha256: sha256,
  // Optional and nullable: most kinds carry a printed expiry, a national id may
  // not, and an absent key must mean the same thing as an explicit null so a
  // replayed request fingerprint cannot depend on which spelling was used.
  document_expires_at: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

/**
 * `reported_sha256` is what the CLIENT claims it uploaded. It is deliberately
 * not sufficient on its own: the repository requires it to agree with both the
 * digest declared at request time and the digest the STORE reports, which is the
 * one the client cannot forge.
 */
export const finalizeVerificationDocumentSchema = z.object({
  reported_sha256: sha256,
}).strict();

/**
 * The reviewer's decision. Structured reason codes only, never operator free
 * text: review outcomes are shown to the applicant and retained in broadly
 * readable history, so identity and clinical detail must have no route in. The
 * repository additionally binds `approved_verified` to `approved` and refuses
 * every other pairing.
 */
export const transitionVerificationDocumentSchema = z.object({
  status: z.enum(REVIEWABLE_VERIFICATION_STATUSES),
  reason_code: z.enum(VERIFICATION_REASON_CODES),
  expected_version: z.number().int().min(0),
}).strict();

export type MembershipDocumentPath = z.infer<typeof membershipDocumentPathSchema>;
export type OrganizationDocumentPath = z.infer<typeof organizationDocumentPathSchema>;
export type ListVerificationDocumentsQuery =
  z.infer<typeof listVerificationDocumentsQuerySchema>;
export type RequestVerificationUploadRequest = z.infer<typeof requestVerificationUploadSchema>;
export type FinalizeVerificationDocumentRequest =
  z.infer<typeof finalizeVerificationDocumentSchema>;
export type TransitionVerificationDocumentRequest =
  z.infer<typeof transitionVerificationDocumentSchema>;
