import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Rate-limiting configuration and behaviour.
 *
 * WHY THIS EXISTS. Rate limiting was added as CODING_TASKS task 4.1. The throttler
 * is configured at the module level and applied via decorators, so a regression
 * — removing a `@Throttle`, changing the default budget, or reverting the
 * `problem+json` 429 — would not be caught by any functional test because the
 * routes still work under the limit. These tests assert the CONFIGURATION and the
 * GUARD SHAPE by reading the source, in the same tradition as `csrf-coverage`
 * and `route-contract`, because that is what a guard is: source that is present
 * and says the right thing.
 */

const SRC = new URL('../apps/api/src/', import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, SRC), 'utf8');
}

/**
 * Removes comments so that decorators quoted inside doc comments are not counted
 * as real decorators. Reuses the same scanner as route-contract.test.ts because a
 * `@Throttle` quoted in prose would otherwise look like a real guard.
 */
function withoutComments(source: string): string {
  let output = '';
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (quote !== null) {
      output += char;
      if (char === '\\') { output += next ?? ''; index += 2; continue; }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      output += ' ';
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

test('the throttler module is registered with a default budget of 100 per 60 seconds', () => {
  const source = withoutComments(read('app.module.ts'));
  // The default throttler: 100 requests per 60_000 ms (60 s). Both values are
  // load-bearing — changing the limit or the TTL changes the contract a client
  // can rely on.
  assert.match(source, /throttlers:\s*\[\s*\{\s*name:\s*'default'[^}]*\}\s*\]/,
    'a named default throttler must be configured');
  assert.match(source, /limit:\s*100\b/, 'the default limit must be 100 requests');
  assert.match(source, /ttl:\s*60_000\b/, 'the default TTL must be 60_000 ms (60 seconds)');
});

test('the throttler uses Redis storage when SMARTCURA_REDIS_URL is configured', () => {
  const source = withoutComments(read('app.module.ts'));
  // The storage must be created from config.redis.url when present. The fallback
  // to undefined (in-memory) is acceptable for local dev but production must use
  // Redis so the budget is shared across instances.
  assert.match(source, /ThrottlerStorageRedisService\(config\.redis\.url\)/,
    'the Redis storage service must be constructed from config.redis.url');
  assert.match(source, /config\.redis\s*!==\s*undefined/,
    'the storage must only be created when Redis is configured');
});

test('the RateLimitGuard is registered as an APP_GUARD between integrity and permission guards', () => {
  const source = withoutComments(read('app.module.ts'));
  // Guard order is load-bearing: the tracker needs the session, so it must run
  // after SessionAuthenticationGuard. It must run before PermissionGuard so a
  // flood of forbidden requests is throttled before reaching the policy engine.
  const guardLines = source
    .split('\n')
    .filter((line) => line.includes('APP_GUARD'))
    .map((line) => line.trim());
  const guardClasses = guardLines.map((line) => {
    const match = /useClass:\s*(\w+)/.exec(line);
    return match?.[1] ?? '';
  });
  assert.ok(guardClasses.includes('RateLimitGuard'),
    'RateLimitGuard must be registered as an APP_GUARD');
  const rateLimitIndex = guardClasses.indexOf('RateLimitGuard');
  const sessionIndex = guardClasses.indexOf('SessionAuthenticationGuard');
  const integrityIndex = guardClasses.indexOf('RequestIntegrityGuard');
  const permissionIndex = guardClasses.indexOf('PermissionGuard');
  assert.ok(sessionIndex >= 0 && integrityIndex >= 0 && rateLimitIndex >= 0 && permissionIndex >= 0,
    'all four guards must be registered');
  assert.ok(rateLimitIndex > sessionIndex,
    'RateLimitGuard must run after SessionAuthenticationGuard so the tracker can use the profile id');
  assert.ok(rateLimitIndex > integrityIndex,
    'RateLimitGuard must run after RequestIntegrityGuard so rejected requests do not consume the budget');
  assert.ok(rateLimitIndex < permissionIndex,
    'RateLimitGuard must run before PermissionGuard so forbidden floods are throttled early');
});

test('the custom guard keys authenticated requests by profile id, not IP', () => {
  const source = withoutComments(read('platform/rate-limit.guard.ts'));
  // The tracker must read smartcuraSession (attached by SessionAuthenticationGuard)
  // and key on profile.profileId. This is the core requirement: authenticated
  // routes are rate-limited per actor, not per IP.
  assert.match(source, /req\.smartcuraSession/,
    'the tracker must read the smartcuraSession attached by the auth guard');
  assert.match(source, /session\.aggregate\.profile\.profileId/,
    'the tracker must key on the profile id from the session aggregate');
  assert.match(source, /return\s+`profile:\$\{.*profileId\}`/,
    'the tracker must prefix the profile id with a "profile:" namespace');
  // The IP fallback for unauthenticated routes must also be present.
  assert.match(source, /req\.ip/,
    'the tracker must fall back to IP for unauthenticated requests');
});

test('the 429 response is a structured problem+json with TOO_MANY_REQUESTS code', () => {
  const source = withoutComments(read('platform/rate-limit.guard.ts'));
  // The default ThrottlerException is a bare string; the API's filter would map
  // it to a generic VALIDATION_FAILED. The override must throw a ProblemDetailsException
  // with the TOO_MANY_REQUESTS code so the 429 matches every other error shape.
  assert.match(source, /throwThrottlingException/,
    'throwThrottlingException must be overridden');
  assert.match(source, /problem\(\s*429\s*,\s*'TOO_MANY_REQUESTS'/,
    'the 429 must use problem(429, "TOO_MANY_REQUESTS", ...) to match the problem+json shape');
});

test('the session creation route has a stricter throttle than the default', () => {
  const source = withoutComments(read('sessions/sessions.controller.ts'));
  // POST /sessions is public (IP-keyed) and must have a strict limit to cap
  // credential-stuffing. The limit must be lower than the default 100.
  assert.match(source, /@Throttle\(\s*\{\s*default:\s*\{\s*limit:\s*(\d+)\s*,\s*ttl:\s*60_000\s*\}\s*\}\s*\)/,
    'POST /sessions must carry a @Throttle decorator with a default limit');
  const limits = [...source.matchAll(/@Throttle\(\s*\{\s*default:\s*\{\s*limit:\s*(\d+)\s*,\s*ttl:\s*60_000\s*\}\s*\}\s*\)/g)]
    .map((match) => Number(match[1]!));
  assert.ok(limits.length >= 3,
    `expected at least 3 throttled session routes, found ${limits.length}`);
  assert.ok(limits.every((limit) => limit < 100),
    `all session-route limits must be stricter than the default 100, found ${limits.join(', ')}`);
  // The sign-in route specifically should be 5 — the tightest budget.
  assert.ok(limits.includes(5),
    `the sign-in route must have a limit of 5, found ${limits.join(', ')}`);
});

test('the appointment booking routes have a stricter throttle than the default', () => {
  const source = withoutComments(read('appointments/appointments.controller.ts'));
  // Booking, holding and rescheduling must have stricter limits than the default.
  const limits = [...source.matchAll(/@Throttle\(\s*\{\s*default:\s*\{\s*limit:\s*(\d+)\s*,\s*ttl:\s*60_000\s*\}\s*\}\s*\)/g)]
    .map((match) => Number(match[1]!));
  assert.ok(limits.length >= 3,
    `expected at least 3 throttled appointment routes (hold, book, reschedule), found ${limits.length}`);
  assert.ok(limits.every((limit) => limit < 100),
    `all appointment-route limits must be stricter than the default 100, found ${limits.join(', ')}`);
});

test('REDIS_URL is accepted by the config schema and ownership filter', () => {
  const source = read('config.ts');
  // SMARTCURA_REDIS_URL must be in the zod schema and the ownership filter so
  // the .strict() schema does not reject it when Coolify injects it.
  assert.match(source, /SMARTCURA_REDIS_URL:\s*z\.string\(\)\.url\(\)\.optional\(\)/,
    'SMARTCURA_REDIS_URL must be an optional URL in the zod schema');
  assert.match(source, /key\.startsWith\('SMARTCURA_REDIS_'\)/,
    'the ownership filter must pass SMARTCURA_REDIS_* env vars through to the schema');
  // The ApiConfig type must expose redis as { url: string } | undefined.
  assert.match(source, /redis:\s*\{\s*url:\s*string\s*\}\s*\|\s*undefined/,
    'the ApiConfig type must expose redis as { url: string } | undefined');
});

test('the production compose files set SMARTCURA_REDIS_URL on the API container', () => {
  const compose = readFileSync(new URL('../compose.prod.yaml', import.meta.url), 'utf8');
  const coolifyCompose = readFileSync(new URL('../docker-compose.prod.yaml', import.meta.url), 'utf8');
  // Both production compose files must set SMARTCURA_REDIS_URL on the api service
  // so the throttler uses Redis-backed storage in production.
  assert.match(compose, /SMARTCURA_REDIS_URL:\s*redis:\/\/redis:6379/,
    'compose.prod.yaml must set SMARTCURA_REDIS_URL on the api service');
  assert.match(coolifyCompose, /SMARTCURA_REDIS_URL:\s*redis:\/\/redis:6379/,
    'docker-compose.prod.yaml must set SMARTCURA_REDIS_URL on the api service');
});
