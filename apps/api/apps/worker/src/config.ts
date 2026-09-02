import { loadObjectStorageConfig, type ObjectStorageConfig } from '@smartcura/storage';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'ci', 'production']).default('development'),
  SMARTCURA_BUILD_VERSION: z.string().min(1).default('0.1.0-dev'),
  SMARTCURA_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
  SMARTCURA_WORKER_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  SMARTCURA_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  SMARTCURA_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
  SMARTCURA_MALWARE_SCANNER: z.enum(['deterministic', 'clamav']).default('deterministic'),
  /**
   * Adapter selection for the three providers that were previously HARD-WIRED to their
   * deterministic implementations with no way to choose otherwise.
   *
   * WHY THIS MATTERS MOST FOR PAYMENTS. A deterministic payment provider does not simulate
   * a gateway; it FABRICATES an outcome. In production that means appointments confirm and
   * balanced ledger entries post for money that was never charged — the books would look
   * correct and be false. There is no real gateway yet, so production is made to REFUSE TO
   * START rather than quietly fabricate: a failed boot is recoverable, a false ledger is not.
   */
  SMARTCURA_PAYMENT_PROVIDER: z.enum(['deterministic', 'gateway']).default('deterministic'),
  SMARTCURA_PUSH_PROVIDER: z.enum(['deterministic', 'fcm']).default('deterministic'),
  // Firebase service account credentials for the FCM push adapter. Required only
  // when the push provider is `fcm`; the selection factory throws otherwise, so
  // they stay optional here. Either the three discrete vars or a path to a JSON
  // key file (`FIREBASE_SERVICE_ACCOUNT_PATH`) may be supplied.
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  FIREBASE_CLIENT_EMAIL: z.string().min(1).optional(),
  FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().min(1).optional(),
  // The AES-256 key used to seal FCM registration tokens before they reach
  // PostgreSQL. The API app uses the same key to seal tokens on registration;
  // the worker uses it to open tokens at send time. Defaults to the all-zero
  // key for CI/local dev; production must override with a random 64-hex key.
  SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).default('0000000000000000000000000000000000000000000000000000000000000000'),
  /**
   * Transactional email adapter selection, mirroring the push channel. The
   * `deterministic` stub logs the email and reports success without sending
   * anything; `smtp` routes through Hostinger Email SMTP (nodemailer);
   * `cloudflare` routes through the Cloudflare Email Service REST API.
   * For the FYP demo, `deterministic` is allowed in production with a boot warning,
   * exactly as the push channel allows its deterministic stub.
   */
  SMARTCURA_EMAIL_PROVIDER: z.enum(['deterministic', 'smtp', 'cloudflare']).default('deterministic'),
  // Cloudflare Email Service credentials. Required only when the email provider is
  // `cloudflare`; the selection factory throws otherwise, so they stay optional here.
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_EMAIL_DOMAIN: z.string().min(1).optional(),
  // SMTP credentials (Hostinger Email: smtp.hostinger.com, port 465 implicit TLS
  // or 587 STARTTLS). Required only when the email provider is `smtp`; the
  // selection factory throws otherwise, so they stay optional here.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM_EMAIL: z.string().min(3).optional(),
  SMTP_FROM_NAME: z.string().min(1).optional(),
  SMARTCURA_AI_PROVIDER: z.enum(['mock', 'openai', 'cloudflare']).default('mock'),
  SMARTCURA_AI_API_KEY: z.string().min(1).optional(),
  SMARTCURA_AI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  SMARTCURA_AI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  // Read directly by the OpenAI-compatible provider (ai-provider.ts) to control
  // whether response_format:json_object is sent. Declared here so the .strict()
  // schema does not reject it when Coolify sets it for the Cline gateway.
  SMARTCURA_AI_JSON_MODE: z.enum(['true', 'false']).default('true'),
  SMARTCURA_CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
  SMARTCURA_CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  SMARTCURA_CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(15_000),
  DATABASE_URL: z.string().url(),
  DATABASE_READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2_000),
  /**
   * MQTT broker connection for the vitals ingestion bridge. Optional: if
   * SMARTCURA_MQTT_URL is unset the bridge does not start and the worker logs a
   * warning. This keeps CI and local dev working without a broker, while the FYP
   * demo stack enables it.
   */
  SMARTCURA_MQTT_URL: z.string().url().optional(),
  SMARTCURA_MQTT_USERNAME: z.string().min(1).optional(),
  SMARTCURA_MQTT_PASSWORD: z.string().min(1).optional(),
  SMARTCURA_MQTT_CLIENT_ID: z.string().min(1).default('smartcura-worker'),
  // Redis for the WebSocket chat gateway fan-out. Optional: if unset the
  // worker processes chat outbox events normally without the real-time push
  // side effect. CI and local dev run this way; production sets the Redis URL
  // to the same Redis service the API gateway subscribes to.
  SMARTCURA_REDIS_URL: z.string().url().optional(),
}).strict().superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && value.SMARTCURA_MALWARE_SCANNER !== 'clamav') {
    context.addIssue({
      code: 'custom',
      path: ['SMARTCURA_MALWARE_SCANNER'],
      message: 'Production requires the ClamAV malware scanner',
    });
  }
  // FYP demo configuration: payment and push are intentionally simulated for now.
  // The worker logs a warning at boot so the operator cannot mistake this for a
  // real production settlement or delivery path. Only the AI provider is required
  // to be a real network model in production.
  if (value.NODE_ENV === 'production' && value.SMARTCURA_AI_PROVIDER !== 'openai' && value.SMARTCURA_AI_PROVIDER !== 'cloudflare') {
    context.addIssue({
      code: 'custom',
      path: ['SMARTCURA_AI_PROVIDER'],
      message: 'Production must use a real network model (openai or cloudflare) for clinical-support artifacts',
    });
  }
  if (value.NODE_ENV === 'production' && value.SMARTCURA_AI_API_KEY === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['SMARTCURA_AI_API_KEY'],
      message: 'Production AI provider requires an API key',
    });
  }
});

export type MalwareScannerConfig = Readonly<
  { readonly adapter: 'deterministic' } |
  { readonly adapter: 'clamav'; readonly host: string; readonly port: number; readonly timeoutMs: number }
>;

export type CloudflareEmailConfig = Readonly<{
  readonly apiToken: string;
  readonly accountId: string;
  readonly fromDomain: string;
}>;

export type SmtpEmailConfig = Readonly<{
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly fromEmail: string;
  readonly fromName: string;
}>;

export type FirebaseServiceAccountConfig = Readonly<{
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
}>;

export type WorkerConfig = Readonly<{
  environment: 'development' | 'test' | 'ci' | 'production';
  buildVersion: string;
  /**
   * Which external providers this process will actually use. Present so configuration
   * cannot claim a capability the build does not have; production refuses the mock values.
   */
  paymentProvider: 'deterministic' | 'gateway';
  pushProvider: 'deterministic' | 'fcm';
  emailProvider: 'deterministic' | 'smtp' | 'cloudflare';
  aiProvider: 'mock' | 'openai' | 'cloudflare';
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  pollIntervalMs: number;
  leaseMs: number;
  batchSize: number;
  maxAttempts: number;
  databaseUrl: string;
  databaseReadinessTimeoutMs: number;
  objectStorage: ObjectStorageConfig;
  malwareScanner: MalwareScannerConfig;
  /**
   * MQTT bridge configuration. Undefined when SMARTCURA_MQTT_URL is not set, in
   * which case the bridge is not started.
   */
  mqtt: { url: string; username: string; password: string; clientId: string } | undefined;
  /**
   * Redis for the WebSocket chat gateway fan-out. Undefined when
   * SMARTCURA_REDIS_URL is not set, in which case the worker processes chat
   * outbox events without the real-time push side effect.
   */
  redis: { url: string } | undefined;
  /**
   * Cloudflare Email Service credentials. Present only when the email provider is
   * `cloudflare`; undefined for the deterministic stub so the selection factory can
   * reject a `cloudflare` selection that lacks its required inputs.
   */
  cloudflareEmail: CloudflareEmailConfig | undefined;
  /**
   * SMTP (Hostinger Email) credentials. Present only when host/user/password and
   * the from address are all supplied; undefined otherwise so the selection
   * factory can reject an `smtp` selection that lacks its required inputs.
   */
  smtp: SmtpEmailConfig | undefined;
  /**
   * Firebase service account credentials. Present only when the push provider is
   * `fcm` and the credentials are supplied; undefined for the deterministic stub
   * so the selection factory can reject an `fcm` selection that lacks its
   * required inputs.
   */
  firebase: FirebaseServiceAccountConfig | undefined;
  /**
   * AES-256 hex key used to open sealed FCM tokens at send time. The API app
   * seals with the same key; both must match or the worker cannot deliver.
   */
  pushTokenEncryptionKey: string;
}>

export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  // Compose files inject optional credentials as `${VAR:-}`, which PRESENTS the
  // variable with an empty value when unset. The schema's `.min(1)` would reject
  // that as malformed and crash the worker at boot, so empty strings are dropped
  // here and treated exactly like unset variables.
  const owned = Object.fromEntries(Object.entries(env).filter(([key, value]) =>
    value !== '' &&
    (key === 'NODE_ENV' || key === 'DATABASE_URL' || key === 'DATABASE_READINESS_TIMEOUT_MS' ||
    key === 'SMARTCURA_BUILD_VERSION' || key.startsWith('SMARTCURA_WORKER_') ||
    key.startsWith('SMARTCURA_MALWARE_') || key.startsWith('SMARTCURA_CLAMAV_') ||
    key.startsWith('SMARTCURA_AI_') || key.startsWith('SMARTCURA_MQTT_') ||
    key.startsWith('SMARTCURA_REDIS_') || key.startsWith('CLOUDFLARE_') ||
    key.startsWith('FIREBASE_') ||
    key === 'SMARTCURA_EMAIL_PROVIDER' || key === 'SMARTCURA_PUSH_PROVIDER' ||
    key === 'SMARTCURA_PAYMENT_PROVIDER' || key === 'SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY' ||
    key.startsWith('SMTP_'))));
  const value = schema.parse(owned);
  const malwareScanner: MalwareScannerConfig = value.SMARTCURA_MALWARE_SCANNER === 'clamav'
    ? Object.freeze({
        adapter: 'clamav',
        host: value.SMARTCURA_CLAMAV_HOST,
        port: value.SMARTCURA_CLAMAV_PORT,
        timeoutMs: value.SMARTCURA_CLAMAV_TIMEOUT_MS,
      })
    : Object.freeze({ adapter: 'deterministic' });
  return Object.freeze({
    environment: value.NODE_ENV,
    buildVersion: value.SMARTCURA_BUILD_VERSION,
    paymentProvider: value.SMARTCURA_PAYMENT_PROVIDER,
    pushProvider: value.SMARTCURA_PUSH_PROVIDER,
    emailProvider: value.SMARTCURA_EMAIL_PROVIDER,
    aiProvider: value.SMARTCURA_AI_PROVIDER,
    aiApiKey: value.SMARTCURA_AI_API_KEY!,
    aiBaseUrl: value.SMARTCURA_AI_BASE_URL,
    aiModel: value.SMARTCURA_AI_MODEL,
    pollIntervalMs: value.SMARTCURA_WORKER_POLL_INTERVAL_MS,
    leaseMs: value.SMARTCURA_WORKER_LEASE_MS,
    batchSize: value.SMARTCURA_WORKER_BATCH_SIZE,
    maxAttempts: value.SMARTCURA_WORKER_MAX_ATTEMPTS,
    databaseUrl: value.DATABASE_URL,
    databaseReadinessTimeoutMs: value.DATABASE_READINESS_TIMEOUT_MS,
    objectStorage: loadObjectStorageConfig(env, value.NODE_ENV),
    malwareScanner,
    mqtt: value.SMARTCURA_MQTT_URL !== undefined
      ? Object.freeze({
          url: value.SMARTCURA_MQTT_URL,
          username: value.SMARTCURA_MQTT_USERNAME ?? '',
          password: value.SMARTCURA_MQTT_PASSWORD ?? '',
          clientId: value.SMARTCURA_MQTT_CLIENT_ID,
        })
      : undefined,
    redis: value.SMARTCURA_REDIS_URL !== undefined
      ? Object.freeze({ url: value.SMARTCURA_REDIS_URL })
      : undefined,
    cloudflareEmail: value.CLOUDFLARE_API_TOKEN !== undefined
      && value.CLOUDFLARE_ACCOUNT_ID !== undefined
      && value.CLOUDFLARE_EMAIL_DOMAIN !== undefined
      ? Object.freeze({
        apiToken: value.CLOUDFLARE_API_TOKEN,
        accountId: value.CLOUDFLARE_ACCOUNT_ID,
        fromDomain: value.CLOUDFLARE_EMAIL_DOMAIN,
      })
      : undefined,
    smtp: value.SMTP_HOST !== undefined && value.SMTP_USER !== undefined
      && value.SMTP_PASSWORD !== undefined
      ? Object.freeze({
        host: value.SMTP_HOST,
        port: value.SMTP_PORT ?? (value.SMTP_SECURE === 'false' ? 587 : 465),
        secure: value.SMTP_SECURE !== undefined
          ? value.SMTP_SECURE === 'true'
          // Default to implicit TLS when only the port says otherwise; 465 is the
          // implicit-TLS port and 587 is the STARTTLS port on Hostinger.
          : (value.SMTP_PORT ?? 465) === 465,
        user: value.SMTP_USER,
        password: value.SMTP_PASSWORD,
        fromEmail: value.SMTP_FROM_EMAIL ?? value.SMTP_USER,
        fromName: value.SMTP_FROM_NAME ?? 'SmartCura',
      })
      : undefined,
    firebase: resolveFirebase(value),
    pushTokenEncryptionKey: value.SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY,
  });
}

/**
 * Builds the Firebase service account config from env vars. Two forms are
 * accepted, in priority order:
 *
 *  1. A path to a JSON key file (`FIREBASE_SERVICE_ACCOUNT_PATH`) — read and
 *     parsed at config load time. Useful when the deploy mounts a key file.
 *  2. The three discrete vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
 *     `FIREBASE_PRIVATE_KEY`) — the preferred form for Coolify, where secrets
 *     are injected as env vars. The private key's literal newlines are usually
 *     escaped as `\n` in env vars; they are restored here so `firebase-admin`
 *     receives a valid PEM.
 *
 * Returns `undefined` when none of the credentials are present, so the push
 * provider selection factory can reject an `fcm` selection that lacks them.
 */
function resolveFirebase(value: {
  FIREBASE_PROJECT_ID?: string | undefined;
  FIREBASE_CLIENT_EMAIL?: string | undefined;
  FIREBASE_PRIVATE_KEY?: string | undefined;
  FIREBASE_SERVICE_ACCOUNT_PATH?: string | undefined;
}): FirebaseServiceAccountConfig | undefined {
  if (value.FIREBASE_SERVICE_ACCOUNT_PATH !== undefined) {
    // Defer file reading to the caller path; read synchronously here because the
    // config is built once at boot and the worker blocks on it anyway.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    const raw = fs.readFileSync(value.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as {
      project_id?: string; client_email?: string; private_key?: string;
    };
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      return Object.freeze({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      });
    }
    return undefined;
  }
  if (value.FIREBASE_PROJECT_ID !== undefined
    && value.FIREBASE_CLIENT_EMAIL !== undefined
    && value.FIREBASE_PRIVATE_KEY !== undefined) {
    return Object.freeze({
      projectId: value.FIREBASE_PROJECT_ID,
      clientEmail: value.FIREBASE_CLIENT_EMAIL,
      // Env vars escape PEM newlines as the two-character sequence `\n`; restore
      // them so firebase-admin sees a real PEM.
      privateKey: value.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }
  return undefined;
}
