export type ObjectStorageEnvironment = 'development' | 'test' | 'ci' | 'production';

export type ObjectStorageConfig =
  | Readonly<{ provider: 'memory' }>
  | Readonly<{
      provider: 'r2';
      accountId: string;
      bucket: string;
      endpoint: URL;
      accessKeyId: string;
      secretAccessKey: string;
    }>;

export function loadObjectStorageConfig(
  env: NodeJS.ProcessEnv,
  environment: ObjectStorageEnvironment,
): ObjectStorageConfig {
  const provider = env.SMARTCURA_OBJECT_STORAGE_PROVIDER ??
    (environment === 'production' ? undefined : 'memory');

  if (provider === 'memory') {
    if (environment === 'production') {
      throw new Error('Memory object storage is forbidden in production');
    }
    return Object.freeze({ provider: 'memory' });
  }

  if (provider !== 'r2') {
    throw new Error('SMARTCURA_OBJECT_STORAGE_PROVIDER must be memory or r2');
  }

  const accountId = required(env, 'SMARTCURA_R2_ACCOUNT_ID');
  const bucket = required(env, 'SMARTCURA_R2_BUCKET');
  const endpoint = parseR2Endpoint(required(env, 'SMARTCURA_R2_ENDPOINT'));
  const accessKeyId = required(env, 'SMARTCURA_R2_ACCESS_KEY_ID');
  const secretAccessKey = required(env, 'SMARTCURA_R2_SECRET_ACCESS_KEY');

  return Object.freeze({
    provider: 'r2',
    accountId,
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
  });
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${key} is required for R2`);
  return value;
}

function parseR2Endpoint(value: string): URL {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    endpoint.search.length > 0 ||
    endpoint.hash.length > 0 ||
    !endpoint.hostname.endsWith('.r2.cloudflarestorage.com')
  ) {
    throw new Error('SMARTCURA_R2_ENDPOINT must be a clean Cloudflare R2 HTTPS endpoint');
  }
  return endpoint;
}
