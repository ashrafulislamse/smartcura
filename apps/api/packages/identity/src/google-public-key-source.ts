/**
 * Fetches and caches Google's public signing certificates for Firebase ID tokens.
 *
 * Firebase signs ID tokens with rotating Google-held private keys and publishes
 * the matching X.509 certificates at a well-known endpoint, keyed by `kid`. This
 * module is the only network dependency of Firebase token verification, which is
 * why verification needs no vendor SDK.
 *
 * Caching honours the endpoint's `Cache-Control: max-age`, because refetching per
 * request would add latency and rate-limit exposure to every authenticated call,
 * while never refetching would break verification the moment Google rotates keys.
 */

export const GOOGLE_SECURE_TOKEN_CERTIFICATE_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface PublicKeySource {
  /** Returns the PEM certificate for a key id, or undefined when unknown. */
  certificateFor(keyId: string): Promise<string | undefined>;
}

interface CacheEntry {
  readonly certificates: Readonly<Record<string, string>>;
  readonly expiresAt: number;
}

/** Shortest and longest time a fetched key set is trusted, regardless of headers. */
const MINIMUM_CACHE_MS = 60_000;
const MAXIMUM_CACHE_MS = 21_600_000;
const FETCH_TIMEOUT_MS = 5_000;

export class GooglePublicKeySource implements PublicKeySource {
  #cache: CacheEntry | undefined;
  #inFlight: Promise<CacheEntry> | undefined;

  constructor(
    private readonly url: string = GOOGLE_SECURE_TOKEN_CERTIFICATE_URL,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async certificateFor(keyId: string): Promise<string | undefined> {
    const cached = this.#cache;
    if (cached !== undefined && cached.expiresAt > this.now()) {
      const certificate = cached.certificates[keyId];
      if (certificate !== undefined) return certificate;
      // An unknown key id against a still-valid cache usually means rotation
      // happened early, so one forced refresh is attempted before rejecting.
    }
    const refreshed = await this.refresh();
    return refreshed.certificates[keyId];
  }

  /** Coalesces concurrent refreshes so a key rotation causes one fetch, not many. */
  private async refresh(): Promise<CacheEntry> {
    if (this.#inFlight !== undefined) return this.#inFlight;
    this.#inFlight = this.fetchCertificates()
      .then((entry) => {
        this.#cache = entry;
        return entry;
      })
      .finally(() => {
        this.#inFlight = undefined;
      });
    return this.#inFlight;
  }

  private async fetchCertificates(): Promise<CacheEntry> {
    const response = await fetch(this.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Public key fetch failed with status ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Public key response was not an object');
    }
    const certificates: Record<string, string> = {};
    for (const [keyId, certificate] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof certificate === 'string' && certificate.includes('BEGIN CERTIFICATE')) {
        certificates[keyId] = certificate;
      }
    }
    if (Object.keys(certificates).length === 0) {
      throw new Error('Public key response contained no certificates');
    }
    return {
      certificates: Object.freeze(certificates),
      expiresAt: this.now() + cacheDurationMs(response.headers.get('cache-control')),
    };
  }
}

function cacheDurationMs(cacheControl: string | null): number {
  const match = cacheControl?.match(/max-age=(\d+)/);
  if (match === null || match === undefined) return MINIMUM_CACHE_MS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return MINIMUM_CACHE_MS;
  return Math.min(MAXIMUM_CACHE_MS, Math.max(MINIMUM_CACHE_MS, seconds * 1_000));
}
