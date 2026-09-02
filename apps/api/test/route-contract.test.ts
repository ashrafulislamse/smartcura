import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

/**
 * Route/contract agreement.
 *
 * WHY THIS EXISTS. Six controllers once served every WP-06 and WP-08 route at
 * `/api/v1/api/v1/...`, and later the WP-10/WP-11 routes existed with no contract at
 * all. Neither was caught, because contract validation checks the document against
 * itself and never against what NestJS actually mounts. This test compares the two.
 *
 * Paths are compared as SHAPES: every parameter segment collapses to `*`, because
 * controllers name parameters in camelCase (`:siteId`) while the contract uses
 * snake_case (`{site_id}`). The shape is what a client actually calls.
 */

interface MountedRoute {
  readonly file: string;
  readonly method: string;
  readonly shape: string;
}

const HTTP_DECORATOR = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
const CONTROLLER_DECORATOR = /@Controller\(\s*(?:'([^']*)')?\s*\)/g;

/**
 * Comments are removed before any decorator is matched, by a scanner that tracks
 * string state rather than by a regex.
 *
 * WHY THIS EXISTS AT ALL. `logistics.controller.ts` documents a past defect by
 * QUOTING `@Get('earnings')` inside a doc comment. A parser that reads comments
 * counted that prose as a mounted route and reported 187 routes for 186 operations.
 * It happened to pass because the phantom collided with the real route, but a
 * decorator named only in a comment could equally have MASKED a genuinely missing
 * one, and the entire value of this file is that it reads what is actually served.
 *
 * WHY NOT A REGEX. The first version stripped `/*...*\/` with a regex and dropped
 * lines beginning `//` or `*`. That is wrong in the other direction: a `/*` inside a
 * string literal would start a phantom comment and swallow the real code after it,
 * which is a FALSE NEGATIVE — a route silently disappearing from the comparison.
 * A guard that can lose a route is worse than no guard, because it reports success.
 * So string, template and escape state are tracked explicitly.
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

test('the comment scanner removes comments without losing code inside string literals', () => {
  // A false negative here would silently drop a route from the comparison, so both
  // directions are pinned.
  assert.equal(withoutComments("x /* @Get('ghost') */ y").includes('ghost'), false);
  assert.equal(withoutComments("// @Get('ghost')").includes('ghost'), false);
  assert.equal(withoutComments("@Get('real') // @Get('ghost')").includes('ghost'), false);
  assert.match(withoutComments("@Get('real') // trailing note"), /@Get\('real'\)/);
  // The regex version treated these as comment markers and swallowed the rest.
  assert.match(withoutComments("@Get('a/*b')\n@Post('keep')"), /@Post\('keep'\)/);
  assert.match(withoutComments("@Get('https://example.test')"), /https:\/\/example\.test/);
  assert.match(withoutComments('@Get("a//b")'), /@Get\("a\/\/b"\)/);
  assert.match(withoutComments("const x = `a/*b`;\n@Get('keep')"), /@Get\('keep'\)/);
  // An escaped quote must not end the string and start reading code as comment.
  assert.match(withoutComments("const x = 'it\\'s /* not */ a comment';\n@Get('keep')"), /@Get\('keep'\)/);
});

function shapeOf(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return `/${segments.map((segment) =>
    segment.startsWith(':') || (segment.startsWith('{') && segment.endsWith('}'))
      ? '*'
      : segment).join('/')}`;
}

function mountedRoutes(): readonly MountedRoute[] {
  const root = new URL('../apps/api/src/', import.meta.url);
  const routes: MountedRoute[] = [];
  const walk = (dir: URL): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir)); continue; }
      if (!entry.name.endsWith('.controller.ts')) continue;
      const source = withoutComments(readFileSync(new URL(entry.name, dir), 'utf8'));
      // Split on each @Controller so every route is attributed to its own base path.
      const bases = [...source.matchAll(CONTROLLER_DECORATOR)];
      for (const [index, base] of bases.entries()) {
        const start = base.index ?? 0;
        const end = bases[index + 1]?.index ?? source.length;
        const block = source.slice(start, end);
        for (const match of block.matchAll(HTTP_DECORATOR)) {
          routes.push({
            file: entry.name,
            method: match[1]!.toLowerCase(),
            shape: shapeOf(`${base[1] ?? ''}/${match[2] ?? ''}`),
          });
        }
      }
    }
  };
  walk(root);
  return routes;
}

function documentedRoutes(): ReadonlySet<string> {
  const openapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url,
  ), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const documented = new Set<string>();
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (item[method] !== undefined) documented.add(`${method} ${shapeOf(path)}`);
    }
  }
  return documented;
}

test('every mounted controller route is documented in OpenAPI', () => {
  const routes = mountedRoutes();
  assert.ok(routes.length >= 40, `expected to discover routes, found ${routes.length}`);
  const documented = documentedRoutes();
  const undocumented = routes
    .filter((route) => !documented.has(`${route.method} ${route.shape}`))
    .map((route) => `${route.method.toUpperCase()} ${route.shape} (${route.file})`);
  assert.deepEqual(undocumented, [],
    `routes served but undocumented:\n${undocumented.join('\n')}`);
});

test('no mounted route repeats the global api/v1 prefix', () => {
  // The exact defect that shipped: `@Controller('api/v1/...')` on top of
  // setGlobalPrefix('api/v1'), which mounted everything at /api/v1/api/v1/...
  for (const route of mountedRoutes()) {
    assert.doesNotMatch(route.shape, /^\/api\/v1/,
      `${route.file} mounts ${route.shape}, duplicating the global prefix`);
  }
});

/**
 * Success-status agreement.
 *
 * WHY THIS EXISTS. Nest answers POST with 201 unless told otherwise, so a command
 * that acts on an EXISTING aggregate — sign, send, replay, progress — returns 201
 * while the contract declares 200. That has now shipped twice: WP-03 on
 * `/sessions/refresh` and `/sessions/step-up`, and WP-12 on four emergency
 * commands. Neither the contract validator nor the shape test above can see it,
 * because both compare paths and never compare status codes.
 */
const HTTP_CODE_AFTER = /@HttpCode\(\s*(\d{3})\s*\)/;

interface RouteStatus {
  readonly file: string;
  readonly key: string;
  readonly runtime: number;
}

function mountedStatuses(): readonly RouteStatus[] {
  const root = new URL('../apps/api/src/', import.meta.url);
  const statuses: RouteStatus[] = [];
  const walk = (dir: URL): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir)); continue; }
      if (!entry.name.endsWith('.controller.ts')) continue;
      const source = withoutComments(readFileSync(new URL(entry.name, dir), 'utf8'));
      const bases = [...source.matchAll(CONTROLLER_DECORATOR)];
      for (const [index, base] of bases.entries()) {
        const start = base.index ?? 0;
        const block = source.slice(start, bases[index + 1]?.index ?? source.length);
        const verbs = [...block.matchAll(HTTP_DECORATOR)];
        for (const [position, match] of verbs.entries()) {
          const method = match[1]!.toLowerCase();
          // Everything between this verb decorator and the next one belongs to this
          // handler, so an @HttpCode found there is this handler's override.
          const from = (match.index ?? 0) + match[0].length;
          const to = verbs[position + 1]?.index ?? block.length;
          const override = HTTP_CODE_AFTER.exec(block.slice(from, to));
          statuses.push({
            file: entry.name,
            key: `${method} ${shapeOf(`${base[1] ?? ''}/${match[2] ?? ''}`)}`,
            runtime: override ? Number(override[1]) : (method === 'post' ? 201 : 200),
          });
        }
      }
    }
  };
  walk(root);
  return statuses;
}

function documentedStatuses(): ReadonlyMap<string, number> {
  const openapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url,
  ), 'utf8')) as { paths: Record<string, Record<string, { responses?: Record<string, unknown> }>> };
  const documented = new Map<string, number>();
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item[method];
      if (operation === undefined) continue;
      const success = Object.keys(operation.responses ?? {})
        .map(Number)
        .filter((code) => code >= 200 && code < 300);
      if (success.length === 0) continue;
      documented.set(`${method} ${shapeOf(path)}`, Math.min(...success));
    }
  }
  return documented;
}

test('every documented operation is actually mounted by a controller', () => {
  // The forward test only proves served ⊆ documented. Without this direction the
  // contract can promise an operation nobody implements, which is worse than an
  // undocumented route: a client generated from the contract compiles, calls it,
  // and gets a 404. It also means a documented-only operation could carry a wrong
  // success status and be skipped by the status test below.
  const mounted = new Set(mountedRoutes().map((route) => `${route.method} ${route.shape}`));
  const openapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url,
  ), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const unmounted: string[] = [];
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (item[method] === undefined) continue;
      if (!mounted.has(`${method} ${shapeOf(path)}`)) {
        unmounted.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  assert.deepEqual(unmounted, [],
    `operations promised by the contract that no controller serves:\n${unmounted.join('\n')}`);
});

test('the step-up reason vocabulary matches the contract', () => {
  // WHY. `StepUpReason` in the contract and the zod enum in
  // `session-request.schemas.ts` are two definitions of one vocabulary, and nothing
  // compared them. Stage 11 added three step-up-requiring actions without extending
  // either, so custom-role changes, maintenance changes and dead-letter replays all
  // had to be filed as `security_change` — a real audit-specificity loss that no test
  // could see, because a request with a valid-but-wrong reason succeeds.
  const source = withoutComments(readFileSync(new URL(
    '../apps/api/src/sessions/session-request.schemas.ts', import.meta.url), 'utf8'));
  const block = /stepUpSchema\s*=\s*z\.object\(\{\s*reason:\s*z\.enum\(\[([\s\S]*?)\]\)/.exec(source);
  assert.ok(block, 'could not locate the stepUpSchema reason enum');
  const served = [...block[1]!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!).sort();

  const openapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url), 'utf8')) as {
      components: { schemas: Record<string, { enum?: readonly string[] }> };
    };
  const documented = [...(openapi.components.schemas.StepUpReason?.enum ?? [])].sort();

  assert.ok(served.length > 0, 'no step-up reasons were parsed from the request schema');
  assert.deepEqual(served, documented,
    'the accepted step-up reasons and the documented ones must be the same set');
});

test('every action the policy matrix step-up-guards has a reason of its own', () => {
  // A reason vocabulary that cannot name the action being elevated pushes distinct
  // privileged operations into one audit bucket, which is what happened to Stage 11.
  const openapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url), 'utf8')) as {
      components: { schemas: Record<string, { enum?: readonly string[] }> };
    };
  const reasons = new Set(openapi.components.schemas.StepUpReason?.enum ?? []);
  for (const required of ['custom_role_change', 'maintenance_change', 'dead_letter_replay']) {
    assert.ok(reasons.has(required),
      `${required} is step-up guarded but has no reason of its own, so it would be audited as something else`);
  }
});
test('each operation declares exactly one success status', () => {
  // Declaring the same body under both 200 and 201 is how the mismatch below hid:
  // whichever the server returns, the contract appears to permit it, and a client
  // has to handle two codes for one outcome. Zero is equally wrong and must fail
  // here too, because the status-agreement test SKIPS an operation with no success
  // response, so a missing 2xx would otherwise pass unnoticed in both tests.
  const openapi = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url,
  ), 'utf8')) as { paths: Record<string, Record<string, { responses?: Record<string, unknown> }>> };
  const wrong: string[] = [];
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item[method];
      if (operation === undefined) continue;
      const success = Object.keys(operation.responses ?? {})
        .map(Number)
        .filter((code) => code >= 200 && code < 300);
      if (success.length !== 1) {
        wrong.push(`${method.toUpperCase()} ${path} declares ${
          success.length === 0 ? 'no success status' : success.join(' and ')}`);
      }
    }
  }
  assert.deepEqual(wrong, [],
    `operations that do not declare exactly one success status:\n${wrong.join('\n')}`);
});

test('the status a route actually returns is the status the contract declares', () => {
  const documented = documentedStatuses();
  const disagreements: string[] = [];
  for (const route of mountedStatuses()) {
    const declared = documented.get(route.key);
    if (declared === undefined) continue; // absence is the other test's failure
    if (declared !== route.runtime) {
      disagreements.push(
        `${route.key} returns ${route.runtime} but the contract declares ${declared} (${route.file})`
        + `${route.runtime === 201 ? ' — add @HttpCode(200) if it acts on an existing aggregate' : ''}`,
      );
    }
  }
  assert.deepEqual(disagreements, [],
    `routes whose runtime status contradicts the contract:\n${disagreements.join('\n')}`);
});
