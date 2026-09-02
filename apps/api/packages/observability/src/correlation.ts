import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

const storage = new AsyncLocalStorage<Readonly<{ correlationId: string }>>();
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(value: string): boolean {
  return uuidV7Pattern.test(value);
}

export function createUuidV7(): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function withCorrelation<Result>(correlationId: string, operation: () => Result): Result {
  return storage.run(Object.freeze({ correlationId }), operation);
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
