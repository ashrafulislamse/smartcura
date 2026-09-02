/**
 * Shared object-key validation.
 *
 * Keys are part of a signed URL and part of a remote HTTP path, so a key that
 * traverses (`..`), starts or ends with `/`, carries a backslash or has untrimmed
 * whitespace is rejected before it can be signed. Rejecting at the adapter
 * boundary keeps the in-memory and R2 adapters behaviourally identical, which is
 * the point of having a deterministic local adapter at all.
 *
 * Keys must also stay opaque: PostgreSQL owns the mapping from a key to a
 * patient, so keys carry generated ids only, never names, emails or IC numbers.
 * That rule is enforced by the callers that mint keys; this function enforces the
 * structural half.
 */
export function assertObjectKey(key: string): void {
  const segments = key.split('/');
  if (
    key.length === 0 ||
    key.length > 1_024 ||
    key !== key.trim() ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.includes('\\') ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new TypeError('Object key must be a normalized private key');
  }
}
