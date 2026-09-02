import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = '__Host-smartcura_session';

export function createOpaqueSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function deriveCsrfToken(sessionToken: string, csrfSecret: string): string {
  return createHmac('sha256', csrfSecret).update(sessionToken, 'utf8').digest('base64url');
}

export function secretMatchesHash(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function extractBearer(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value);
  return match?.[1];
}

export function extractSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) return item.slice(separator + 1).trim() || undefined;
  }
  return undefined;
}

export function sessionCookie(secret: string): string {
  return `${SESSION_COOKIE_NAME}=${secret}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}
