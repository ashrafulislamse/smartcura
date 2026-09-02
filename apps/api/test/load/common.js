const SESSION_COOKIE_NAME = '__Host-smartcura_session';

export const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
export const ORIGIN = __ENV.ORIGIN || 'http://127.0.0.1:3001';

export function csv(name, { required = true } = {}) {
  const values = (__ENV[name] || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (required && values.length === 0) throw new Error(`${name} must be a comma-separated list`);
  return values;
}

export function integerEnv(name, fallback, minimum = 1) {
  const raw = __ENV[name] || String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

export function requireEnv(name) {
  const value = (__ENV[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function actors({ count, distinct = false } = {}) {
  const cookies = csv('SESSION_COOKIES');
  const csrfTokens = csv('CSRF_TOKENS');
  if (cookies.length !== csrfTokens.length) {
    throw new Error('SESSION_COOKIES and CSRF_TOKENS must contain the same number of entries');
  }
  if (distinct && count !== undefined && cookies.length < count) {
    throw new Error(`This race needs at least ${count} distinct session/CSRF pairs`);
  }
  return cookies.map((cookie, index) => ({ cookie, csrf: csrfTokens[index] }));
}

export function actorAt(allActors, zeroBasedIndex) {
  return allActors[zeroBasedIndex % allActors.length];
}

export function requestParams(actor, { idempotencyKey, tags = {} } = {}) {
  const headers = {
    Cookie: `${SESSION_COOKIE_NAME}=${actor.cookie}`,
    'X-CSRF-Token': actor.csrf,
    Origin: ORIGIN,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
  return { headers, tags };
}

export function parseJson(response) {
  try {
    return response.json();
  } catch (_) {
    return undefined;
  }
}

export function summaryOutput(data, fallbackName) {
  const path = __ENV.K6_SUMMARY_PATH || fallbackName;
  return { [path]: JSON.stringify(data, null, 2) };
}
