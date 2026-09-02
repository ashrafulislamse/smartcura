import { loadObjectStorageConfig, type ObjectStorageConfig } from '@smartcura/storage';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'ci', 'production']).default('development'),
  SMARTCURA_BUILD_VERSION: z.string().min(1).default('0.1.0-dev'),
  SMARTCURA_API_HOST: z.string().min(1).default('127.0.0.1'),
  SMARTCURA_API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  SMARTCURA_API_WORKER_MAX_AGE_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  SMARTCURA_API_ALLOWED_ORIGINS: z.string().min(1).default('http://127.0.0.1:3001,http://localhost:3001'),
  SMARTCURA_SESSION_CSRF_SECRET: z.string().min(32).default('local-csrf-secret-not-for-production-0001'),
  DATABASE_URL: z.string().url(),
  DATABASE_READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2_000),
  SMARTCURA_IDENTITY_ADAPTER: z.enum(['local', 'firebase']).default('local'),
  SMARTCURA_LOCAL_IDENTITY_TOKEN: z.string().min(32).default('local-fixture-token-not-for-production'),
  SMARTCURA_LOCAL_IDENTITY_UID: z.string().min(1).default('local-fixture-user'),
  SMARTCURA_LOCAL_IDENTITY_EMAIL: z.string().email().default('local.user@smartcura.invalid'),
  SMARTCURA_LOCAL_IDENTITY_EMAIL_VERIFIED: z.enum(['true', 'false']).default('true'),
  SMARTCURA_LOCAL_IDENTITY_MFA: z.enum(['true', 'false']).default('true'),
  // A SECOND local fixture identity. Without one, a single profile held every
  // membership, so an actor was always also the patient and every two-party rule
  // - break-glass not-self, independent break-glass review, per-participant receipts
  // - was structurally unverifiable. This exists only under the local adapter,
  // which production cannot select, so it adds no production surface.
  SMARTCURA_LOCAL_IDENTITY_SECONDARY_TOKEN: z.string().min(32)
    .default('local-fixture-secondary-token-not-for-production'),
  SMARTCURA_LOCAL_IDENTITY_SECONDARY_UID: z.string().min(1).default('local-fixture-user-2'),
  SMARTCURA_LOCAL_IDENTITY_SECONDARY_EMAIL: z.string().email()
    .default('local.user2@smartcura.invalid'),
  SMARTCURA_FIREBASE_PROJECT_ID: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  SMARTCURA_VIDEO_ADAPTER: z.enum(['deterministic', 'livekit']).default('deterministic'),
  SMARTCURA_LIVEKIT_URL: z.string().url().default('ws://127.0.0.1:7880'),
  SMARTCURA_LIVEKIT_API_KEY: z.string().min(8).default('local-api-key'),
  SMARTCURA_LIVEKIT_API_SECRET: z.string().min(32).default('local-livekit-secret-not-for-production'),
  SMARTCURA_LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(300),
  SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).default('0000000000000000000000000000000000000000000000000000000000000000'),
  SMARTCURA_AI_PROVIDER: z.enum(['mock', 'openai', 'cloudflare']).default('mock'),
  SMARTCURA_AI_API_KEY: z.string().min(1).optional(),
  SMARTCURA_AI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  SMARTCURA_AI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  // Read directly by the OpenAI-compatible provider (ai-provider.ts) to control
  // whether response_format:json_object is sent. Declared here so the .strict()
  // schema does not reject it when Coolify injects it into the API container's
  // environment alongside the worker env vars.
  SMARTCURA_AI_JSON_MODE: z.enum(['true', 'false']).default('true'),
  // Redis for the WebSocket chat gateway and the per-route rate limiter:
  // pub/sub fan-out of outbox events the worker publishes, presence state keyed
  // by profile_id, and the @nestjs/throttler Redis-backed storage. Optional so
  // CI and local dev start without Redis; the gateway logs a warning and skips
  // pub/sub and presence when unset, while still authenticating connections and
  // routing room events within a single process, and the throttler falls back to
  // its in-memory storage so rate limiting still applies within one process.
  SMARTCURA_REDIS_URL: z.string().url().optional(),
}).strict().superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && value.SMARTCURA_IDENTITY_ADAPTER !== 'firebase') {
    context.addIssue({ code: 'custom', path: ['SMARTCURA_IDENTITY_ADAPTER'], message: 'Production requires Firebase identity' });
  }
  if (
    value.NODE_ENV === 'production' &&
    value.SMARTCURA_SESSION_CSRF_SECRET === 'local-csrf-secret-not-for-production-0001'
  ) {
    context.addIssue({ code: 'custom', path: ['SMARTCURA_SESSION_CSRF_SECRET'], message: 'Production requires a deployment CSRF secret' });
  }
  if (value.NODE_ENV === 'production' && value.SMARTCURA_VIDEO_ADAPTER !== 'livekit') {
    context.addIssue({ code: 'custom', path: ['SMARTCURA_VIDEO_ADAPTER'], message: 'Production requires LiveKit video' });
  }
  if (value.NODE_ENV === 'production' && value.SMARTCURA_LIVEKIT_API_SECRET === 'local-livekit-secret-not-for-production') {
    context.addIssue({ code: 'custom', path: ['SMARTCURA_LIVEKIT_API_SECRET'], message: 'Production requires a deployment LiveKit secret' });
  }
  if (value.NODE_ENV === 'production' && value.SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY === '0000000000000000000000000000000000000000000000000000000000000000') {
    context.addIssue({ code: 'custom', path: ['SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY'], message: 'Production requires a deployment push-token encryption key' });
  }
  const origins = value.SMARTCURA_API_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim()).filter((origin) => origin.length > 0);
  if (origins.length === 0 || origins.includes('*')) {
    context.addIssue({ code: 'custom', path: ['SMARTCURA_API_ALLOWED_ORIGINS'], message: 'At least one exact CORS origin is required; wildcard is forbidden' });
  }
  if (value.SMARTCURA_IDENTITY_ADAPTER === 'firebase' && value.SMARTCURA_FIREBASE_PROJECT_ID === undefined) {
    context.addIssue({ code: 'custom', path: ['SMARTCURA_FIREBASE_PROJECT_ID'], message: 'Firebase project ID is required' });
  }
});

export type IdentityConfig = Readonly<{
  adapter: 'local';
  token: string;
  uid: string;
  email: string;
  emailVerified: boolean;
  mfaSatisfied: boolean;
  /**
   * A second fixture subject, so two-party rules can be verified at all. One profile
   * holding every membership made the actor always also the patient, which no
   * break-glass or independent-review boundary can express.
   */
  secondary: Readonly<{ token: string; uid: string; email: string }>;
} | {
  adapter: 'firebase';
  projectId: string;
}>;

export type ApiConfig = Readonly<{
  environment: 'development' | 'test' | 'ci' | 'production';
  buildVersion: string;
  host: string;
  port: number;
  workerMaxAgeMs: number;
  allowedOrigins: readonly string[];
  csrfSecret: string;
  pushTokenEncryptionKey: string;
  databaseUrl: string;
  databaseReadinessTimeoutMs: number;
  objectStorage: ObjectStorageConfig;
  identity: IdentityConfig;
  video: Readonly<{
    adapter: 'deterministic' | 'livekit';
    url: string;
    apiKey: string;
    apiSecret: string;
    tokenTtlSeconds: number;
  }>;
  ai: Readonly<{
    provider: 'mock' | 'openai' | 'cloudflare';
    apiKey: string | undefined;
    baseUrl: string;
    model: string;
  }>;
  /**
   * Redis for the WebSocket chat gateway and the per-route rate limiter.
   * Undefined when SMARTCURA_REDIS_URL is not set, in which case the gateway
   * authenticates connections and routes room events within a single process
   * but skips cross-process pub/sub fan-out and shared presence, and the
   * throttler falls back to in-memory storage so rate limiting still applies
   * within one process. Production sets this to the Redis service URL.
   */
  redis: { url: string } | undefined;
}>;

export function loadApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const owned = Object.fromEntries(Object.entries(env).filter(([key]) =>
    key === 'NODE_ENV' || key === 'DATABASE_URL' || key === 'DATABASE_READINESS_TIMEOUT_MS' ||
    key === 'SMARTCURA_BUILD_VERSION' || key.startsWith('SMARTCURA_API_') ||
    key === 'SMARTCURA_SESSION_CSRF_SECRET' ||
    key.startsWith('SMARTCURA_IDENTITY_') || key.startsWith('SMARTCURA_LOCAL_IDENTITY_') ||
    key === 'SMARTCURA_FIREBASE_PROJECT_ID' || key === 'SMARTCURA_VIDEO_ADAPTER' ||
    key === 'SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY' || key.startsWith('SMARTCURA_LIVEKIT_') ||
    key.startsWith('SMARTCURA_AI_') || key.startsWith('SMARTCURA_REDIS_')));
  const value = schema.parse(owned);
  const identity: IdentityConfig = value.SMARTCURA_IDENTITY_ADAPTER === 'local'
    ? Object.freeze({
        adapter: 'local',
        token: value.SMARTCURA_LOCAL_IDENTITY_TOKEN,
        uid: value.SMARTCURA_LOCAL_IDENTITY_UID,
        email: value.SMARTCURA_LOCAL_IDENTITY_EMAIL,
        emailVerified: value.SMARTCURA_LOCAL_IDENTITY_EMAIL_VERIFIED === 'true',
        mfaSatisfied: value.SMARTCURA_LOCAL_IDENTITY_MFA === 'true',
        secondary: Object.freeze({
          token: value.SMARTCURA_LOCAL_IDENTITY_SECONDARY_TOKEN,
          uid: value.SMARTCURA_LOCAL_IDENTITY_SECONDARY_UID,
          email: value.SMARTCURA_LOCAL_IDENTITY_SECONDARY_EMAIL,
        }),
      })
    : Object.freeze({ adapter: 'firebase', projectId: value.SMARTCURA_FIREBASE_PROJECT_ID! });
  return Object.freeze({
    environment: value.NODE_ENV,
    buildVersion: value.SMARTCURA_BUILD_VERSION,
    host: value.SMARTCURA_API_HOST,
    port: value.SMARTCURA_API_PORT,
    workerMaxAgeMs: value.SMARTCURA_API_WORKER_MAX_AGE_MS,
    allowedOrigins: Object.freeze(value.SMARTCURA_API_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim()).filter((origin) => origin.length > 0)),
    csrfSecret: value.SMARTCURA_SESSION_CSRF_SECRET,
    pushTokenEncryptionKey: value.SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY,
    databaseUrl: value.DATABASE_URL,
    databaseReadinessTimeoutMs: value.DATABASE_READINESS_TIMEOUT_MS,
    objectStorage: loadObjectStorageConfig(env, value.NODE_ENV),
    identity,
    ai: Object.freeze({
      provider: value.SMARTCURA_AI_PROVIDER,
      apiKey: value.SMARTCURA_AI_API_KEY,
      baseUrl: value.SMARTCURA_AI_BASE_URL,
      model: value.SMARTCURA_AI_MODEL,
    }),
    video: Object.freeze({
      adapter: value.SMARTCURA_VIDEO_ADAPTER,
      url: value.SMARTCURA_LIVEKIT_URL,
      apiKey: value.SMARTCURA_LIVEKIT_API_KEY,
      apiSecret: value.SMARTCURA_LIVEKIT_API_SECRET,
      tokenTtlSeconds: value.SMARTCURA_LIVEKIT_TOKEN_TTL_SECONDS,
    }),
    redis: value.SMARTCURA_REDIS_URL !== undefined
      ? Object.freeze({ url: value.SMARTCURA_REDIS_URL })
      : undefined,
  });
}
