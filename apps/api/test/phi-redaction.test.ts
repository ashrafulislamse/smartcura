import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  LOG_FIELD_ALLOWLIST,
  METRIC_LABEL_ALLOWLIST,
  REDACTED_MARKER,
  formatSafeLog,
  httpStatusClass,
  routeLabel,
  safeErrorFields,
  safeLogFields,
  safeMetricLabels,
} from '@smartcura/observability';

const profileId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d70';

test('allowlisted identifiers survive and every unlisted key is withheld', () => {
  const record = safeLogFields({
    event: 'appointment.booked',
    correlation_id: profileId,
    profile_id: profileId,
    http_status: 201,
    duration_ms: 12,
    outcome: 'allowed',
  });
  assert.deepEqual(record, {
    correlation_id: profileId,
    duration_ms: 12,
    event: 'appointment.booked',
    http_status: 201,
    outcome: 'allowed',
    profile_id: profileId,
  });
  // A withheld key is reported rather than removed: during triage "withheld" and
  // "never set" are different facts.
  assert.equal(safeLogFields({ patient_name: 'Aisyah' }).patient_name, REDACTED_MARKER);
});

test('identity, clinical, vitals and credential fields never reach a log', () => {
  const dangerous = {
    patient_name: 'Aisyah binti Rahman',
    display_name: 'Aisyah',
    email: 'aisyah@example.test',
    phone_e164: '+60123456789',
    diagnosis: 'suspected pneumonia',
    medication: 'amoxicillin',
    dose_value: '500',
    content: 'I have chest pain',
    text_content: 'private message',
    note: 'clinical note body',
    rationale: 'because of the x-ray',
    value: 172,
    metric_value: 98.6,
    token: 'session-token-value',
    authorization: 'Bearer abc',
    cookie: '__Host-session=abc',
    secret: 'shhh',
    password: 'hunter2',
    object_key: 'verification/018f/abc.pdf',
    body: { anything: 'at all' },
    firebase_uid: 'uid-123',
  };
  const record = safeLogFields(dangerous);
  const serialized = formatSafeLog(dangerous);
  for (const key of Object.keys(dangerous)) {
    assert.equal(record[key], REDACTED_MARKER, `${key} must be withheld`);
  }
  // The serialized line must not contain any protected VALUE either.
  for (const leaked of [
    'Aisyah', 'aisyah@example.test', '+60123456789', 'pneumonia', 'amoxicillin',
    'chest pain', 'private message', 'clinical note body', 'x-ray', 'hunter2',
    'session-token-value', 'Bearer', '__Host-session', 'verification/', 'uid-123',
    '172', '98.6', '500',
  ]) {
    assert.equal(serialized.includes(leaked), false, `log must not contain "${leaked}"`);
  }
});

test('nested objects and arrays are withheld even under an allowlisted key', () => {
  // Nesting is exactly how a request body or clinical record reaches a log by
  // accident, so no allowlisted field may carry a structure.
  assert.equal(safeLogFields({ event: { nested: 'value' } }).event, REDACTED_MARKER);
  assert.equal(safeLogFields({ action: ['a', 'b'] }).action, REDACTED_MARKER);
  assert.equal(safeLogFields({ reason_code: { deep: { deeper: 'phi' } } }).reason_code, REDACTED_MARKER);
  const serialized = formatSafeLog({
    profile_id: profileId,
    metadata: { patient: { name: 'Aisyah', diagnosis: 'flu' } },
  });
  assert.equal(serialized.includes('Aisyah'), false);
  assert.equal(serialized.includes('flu'), false);
  assert.equal(serialized.includes(profileId), true);
});

test('an oversized or non-finite allowlisted value is withheld rather than truncated', () => {
  // Truncating would still emit the first 256 characters of a transcript.
  assert.equal(safeLogFields({ action: 'a'.repeat(257) }).action, REDACTED_MARKER);
  assert.equal(safeLogFields({ action: 'a'.repeat(256) }).action, 'a'.repeat(256));
  // NaN/Infinity serialize to null and would make a numeric field meaningless.
  assert.equal(safeLogFields({ duration_ms: Number.NaN }).duration_ms, REDACTED_MARKER);
  assert.equal(safeLogFields({ count: Number.POSITIVE_INFINITY }).count, REDACTED_MARKER);
  assert.equal(safeLogFields({ count: 0 }).count, 0);
  assert.equal(safeLogFields({ status: null }).status, null);
  assert.equal(safeLogFields({ outcome: false }).outcome, false);
});

test('error paths log a classification and never a driver message quoting a value', () => {
  // PostgreSQL unique-violation messages quote the offending value, which is how a
  // real address ends up in a log line.
  const driverError = Object.assign(
    new Error('duplicate key value violates unique constraint "profiles_email_uq" (email)=(aisyah@example.test)'),
    { code: '23505' },
  );
  const record = safeErrorFields(driverError);
  assert.equal(record.code, '23505');
  assert.equal(record.outcome, 'error');
  assert.equal(JSON.stringify(record).includes('aisyah@example.test'), false);
  assert.equal(JSON.stringify(record).includes('duplicate key'), false);
  // Without a driver code, the class name is the classification.
  assert.equal(safeErrorFields(new TypeError('patient Aisyah is invalid')).code, 'TypeError');
  assert.equal(
    JSON.stringify(safeErrorFields(new TypeError('patient Aisyah is invalid'))).includes('Aisyah'),
    false,
  );
  // A thrown non-Error must not be stringified into the log.
  assert.equal(safeErrorFields({ diagnosis: 'pneumonia' }).code, 'non_error_thrown');
  assert.equal(safeErrorFields('raw string with phi').code, 'non_error_thrown');
});

test('no controller duplicates the global api/v1 prefix', () => {
  // Found by real deployment: six controllers declared `@Controller('api/v1/...')`
  // while main.ts already calls setGlobalPrefix('api/v1'), so every WP-06 and WP-08
  // route was served at /api/v1/api/v1/... and was unreachable at its documented
  // path. Contract validation could not catch this because the contract describes
  // the intended path, not the mounted one.
  const main = readFileSync(new URL('../apps/api/src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /setGlobalPrefix\('api\/v1'\)/);
  const controllers = globSyncControllers();
  assert.ok(controllers.length >= 10, 'expected to find controller files');
  for (const { file, source } of controllers) {
    for (const match of source.matchAll(/@Controller\('([^']*)'\)/g)) {
      assert.doesNotMatch(
        match[1]!, /^api\/v1/,
        `${file} declares '${match[1]}', which the global prefix already provides`,
      );
    }
  }
});

function globSyncControllers(): readonly { file: string; source: string }[] {
  const root = new URL('../apps/api/src/', import.meta.url);
  const found: { file: string; source: string }[] = [];
  const walk = (dir: URL): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir));
      else if (entry.name.endsWith('.controller.ts')) {
        found.push({
          file: entry.name,
          source: readFileSync(new URL(entry.name, dir), 'utf8'),
        });
      }
    }
  };
  walk(root);
  return found;
}

test('every controller declares route authorization', () => {
  // Found by real deployment: PermissionGuard is DEFAULT-DENY, refusing any route
  // with neither @RequirePermission nor @AuthenticatedOnly and reporting
  // `route.authorization.missing`. All eight new WP-06/WP-08 controllers omitted
  // both, so every one of their routes was refused with PERMISSION_DENIED. The
  // guard behaved correctly; the controllers were incomplete.
  const guard = readFileSync(new URL(
    '../apps/api/src/platform/request-authorization.ts', import.meta.url,
  ), 'utf8');
  assert.match(guard, /route\.authorization\.missing/);
  for (const { file, source } of globSyncControllers()) {
    // A controller with no routes at all is vacuous; every real one must declare.
    if (!/@(?:Get|Post|Put|Patch|Delete)\(/.test(source)) continue;
    assert.ok(
      source.includes('@AuthenticatedOnly()') ||
      source.includes('@RequirePermission(') ||
      // A deliberately public route (health, readiness) needs no authorization, and
      // the guard treats @PublicRoute as an explicit declaration rather than an
      // omission.
      source.includes('@PublicRoute()'),
      `${file} declares no route authorization, so the default-deny guard refuses it`,
    );
  }
});

test('no repository reuses a bind parameter inside a SQL comparison', () => {
  // Found by real execution, three times, in three different syntaxes:
  // `CASE WHEN $2 = '...'`, `CASE WHEN $2 IN (...)`. PostgreSQL cannot infer one
  // type for a parameter used both as an enum value and against an untyped literal,
  // and raises `42P08 ambiguous parameter type`. Casting the comparison does not
  // help, because the parameter's own type still cannot be resolved. The fix is to
  // decide in TypeScript, which is also unit-testable.
  //
  // This asserts the RULE rather than hunting each syntax, because searching by
  // pattern is exactly how the `IN (...)` form was missed the first time.
  const root = new URL('../packages/database/src/', import.meta.url);
  const offenders: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const source = readFileSync(new URL(entry.name, root), 'utf8');
    for (const match of source.matchAll(/CASE\s+WHEN\s+\$\d+\s*(?:=|<>|IN)\s/gi)) {
      offenders.push(`${entry.name}: ${match[0].trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `bind parameters reused in comparisons: ${offenders.join('; ')}`);
});

test('the allowlist itself contains no identity, clinical, credential or key field', () => {
  for (const forbidden of [
    'patient_name', 'display_name', 'email', 'phone', 'phone_e164', 'firebase_uid',
    'content', 'text_content', 'summary', 'note', 'rationale', 'diagnosis',
    'medication', 'dose', 'dose_value', 'value', 'metric_value',
    'token', 'authorization', 'cookie', 'secret', 'password',
    'object_key', 'body', 'payload', 'params',
  ]) {
    assert.equal(LOG_FIELD_ALLOWLIST.has(forbidden), false, `${forbidden} must not be allowlisted`);
  }
  // Opaque identifiers are permitted: they are the minimum needed to correlate an
  // incident and carry no clinical meaning alone.
  for (const permitted of ['correlation_id', 'profile_id', 'event', 'action', 'code']) {
    assert.equal(LOG_FIELD_ALLOWLIST.has(permitted), true);
  }
});

test('metric labels drop identifiers, unbounded values and unlisted dimensions', () => {
  const labels = safeMetricLabels({
    route: '/api/v1/appointments/:id',
    method: 'POST',
    http_status_class: '2xx',
    outcome: 'allowed',
    // Identifiers are refused outright: one series per user exhausts memory long
    // before it becomes useful, and a metrics endpoint is scraped more broadly
    // than the record an identifier points at.
    profile_id: profileId,
    patient_id: profileId,
    correlation_id: profileId,
    email: 'aisyah@example.test',
    object_key: 'verification/abc.pdf',
  });
  assert.deepEqual(labels, {
    http_status_class: '2xx',
    method: 'POST',
    outcome: 'allowed',
    route: '/api/v1/appointments/:id',
  });
  // Unsafe labels are DROPPED, not marked: a `[redacted]` value would still
  // create a series and would still be wrong.
  assert.equal('profile_id' in labels, false);
});

test('an identifier smuggled through a permitted label name is still refused', () => {
  assert.deepEqual(safeMetricLabels({ route: `/api/v1/patients/${profileId}` }), {});
  assert.deepEqual(safeMetricLabels({ outcome: '1234567890' }), {});
  assert.deepEqual(safeMetricLabels({ code: 'a'.repeat(65) }), {});
  assert.deepEqual(safeMetricLabels({ code: '' }), {});
  assert.deepEqual(safeMetricLabels({ role: 'patient name here' }), {});
  assert.deepEqual(safeMetricLabels({ role: 'patient' }), { role: 'patient' });
});

test('route and status labels collapse to bounded value spaces', () => {
  // A raw path is per-resource and therefore per-user.
  assert.equal(routeLabel(`/api/v1/appointments/${profileId}`), '/api/v1/appointments/:id');
  assert.equal(routeLabel('/api/v1/appointments/42/status'), '/api/v1/appointments/:id/status');
  assert.equal(routeLabel('/api/v1/health?verbose=true'), '/api/v1/health');
  assert.equal(routeLabel(`/api/v1/${'x'.repeat(80)}`), 'unknown');
  assert.equal(httpStatusClass(201), '2xx');
  assert.equal(httpStatusClass(404), '4xx');
  assert.equal(httpStatusClass(503), '5xx');
  assert.equal(httpStatusClass(42), 'unknown');
});

test('the metric allowlist contains no identifier or free-text dimension', () => {
  for (const forbidden of [
    'profile_id', 'patient_id', 'appointment_id', 'device_id', 'consultation_id',
    'correlation_id', 'session_id', 'object_id', 'object_key', 'email', 'reason_code',
  ]) {
    assert.equal(METRIC_LABEL_ALLOWLIST.has(forbidden), false, `${forbidden} must not be a label`);
  }
  for (const permitted of ['route', 'method', 'http_status_class', 'outcome']) {
    assert.equal(METRIC_LABEL_ALLOWLIST.has(permitted), true);
  }
});

test('worker log sites route through the allowlist rather than raw serialization', () => {
  for (const file of ['outbox.processor.ts', 'worker.runtime.ts']) {
    const source = readFileSync(new URL(`../apps/worker/src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /formatSafeLog/, `${file} must use the allowlist boundary`);
    // A raw object literal handed to a logger bypasses the boundary entirely.
    assert.doesNotMatch(source, /\.(?:error|warn|log)\(JSON\.stringify\(\{/, file);
  }
});
