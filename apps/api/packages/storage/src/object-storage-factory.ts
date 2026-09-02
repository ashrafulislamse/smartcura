/**
 * Provider selection for object storage.
 *
 * Domain code depends on `ObjectStorageProvider`, never on R2. This factory is the
 * single place where `SMARTCURA_OBJECT_STORAGE_PROVIDER` becomes a concrete
 * adapter, which is what keeps a future storage move a one-file change.
 *
 * The production rule is repeated here on purpose: `loadObjectStorageConfig`
 * already refuses `memory` in production, and so does this factory. Configuration
 * loading and adapter construction can be reached independently (tests, scripts,
 * bootstrap ordering), so the rule that production must never run on a volatile
 * in-process store is enforced at both gates rather than assumed at one.
 */

import {
  loadObjectStorageConfig,
  type ObjectStorageConfig,
  type ObjectStorageEnvironment,
} from './config.js';
import { InMemoryObjectStorage } from './in-memory-object-storage.js';
import type {
  ObjectStorageProvider,
  PresignedObjectStorageProvider,
  PrivateFileStorageProvider,
} from './object-storage.js';
import { R2ObjectStorage } from './r2-object-storage.js';

export interface ObjectStorageProviderOptions {
  /** Default pre-signed lifetime in seconds; hard-capped by the R2 adapter. */
  readonly presignedUrlExpirySeconds?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly maxDownloadBytes?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly now?: (() => Date) | undefined;
}

export function createObjectStorageProvider(
  config: ObjectStorageConfig,
  environment: ObjectStorageEnvironment,
  options: ObjectStorageProviderOptions = {},
): ObjectStorageProvider {
  if (config.provider === 'memory') {
    if (environment === 'production') {
      throw new Error('Memory object storage is forbidden in production');
    }
    return new InMemoryObjectStorage();
  }

  return new R2ObjectStorage({
    accountId: config.accountId,
    bucket: config.bucket,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    presignedUrlExpirySeconds: options.presignedUrlExpirySeconds,
    requestTimeoutMs: options.requestTimeoutMs,
    maxDownloadBytes: options.maxDownloadBytes,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });
}

/** Convenience wrapper: read configuration from the environment, then build. */
export function createObjectStorageProviderFromEnv(
  env: NodeJS.ProcessEnv,
  environment: ObjectStorageEnvironment,
  options: ObjectStorageProviderOptions = {},
): ObjectStorageProvider {
  return createObjectStorageProvider(
    loadObjectStorageConfig(env, environment),
    environment,
    options,
  );
}

/**
 * Narrows a provider to one that can mint pre-signed operations.
 *
 * The deterministic in-memory adapter deliberately has no signing capability, so
 * callers that need a pre-signed URL must check rather than cast. Failing that
 * check is a configuration problem worth surfacing, not something to paper over
 * by streaming bytes through the API.
 */
export function supportsPresignedOperations(
  provider: ObjectStorageProvider,
): provider is PresignedObjectStorageProvider {
  const candidate = provider as Partial<PresignedObjectStorageProvider>;
  return (
    typeof candidate.createUploadOperation === 'function' &&
    typeof candidate.createDownloadOperation === 'function'
  );
}

/**
 * Narrows a provider to one that can run the private file pipeline.
 *
 * Same reasoning as {@link supportsPresignedOperations}, one level narrower: the
 * verification and download routes also need a checksum-bound upload capability
 * and a stat that can report "no recorded checksum". The deterministic in-memory
 * adapter has neither, so a deployment configured for `memory` fails the check
 * and the routes answer with a configuration problem instead of inventing a URL
 * that leads nowhere or streaming private bytes through the API.
 */
export function supportsPrivateFilePipeline(
  provider: ObjectStorageProvider,
): provider is PrivateFileStorageProvider {
  const candidate = provider as Partial<PrivateFileStorageProvider>;
  return (
    typeof candidate.createPresignedUploadUrl === 'function' &&
    typeof candidate.createPresignedDownloadUrl === 'function' &&
    typeof candidate.headObject === 'function'
  );
}
