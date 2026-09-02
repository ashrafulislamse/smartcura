import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Seals FCM registration tokens before they reach PostgreSQL.
 *
 * A registration token is a provider credential that can push to a real device,
 * so it is treated like a secret rather than a business field: the row stores
 * ciphertext plus a lookup hash, and no route ever returns it. AES-256-GCM is
 * used so a tampered ciphertext fails to open instead of decrypting to garbage.
 *
 * Shared between the API app (which seals tokens on registration) and the worker
 * (which opens tokens at send time) so both sides use the exact same algorithm
 * and key format. The key is a 32-byte hex string
 * (`SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY`).
 */
export class PushTokenCipher {
  readonly #key: Buffer;

  constructor(hexKey: string) {
    this.#key = Buffer.from(hexKey, 'hex');
    if (this.#key.byteLength !== 32) throw new TypeError('Push token key must be 32 bytes');
  }

  seal(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const sealed = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [
      iv.toString('base64url'),
      sealed.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }

  open(value: string): string {
    const [iv, sealed, tag] = value.split('.');
    if (iv === undefined || sealed === undefined || tag === undefined) {
      throw new TypeError('Malformed sealed push token');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
