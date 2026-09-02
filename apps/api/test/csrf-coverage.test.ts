import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

/**
 * CSRF enforcement on state-changing routes.
 *
 * WHY THIS EXISTS. End-to-end verification through the portal origin found that a
 * `POST /admin/faqs` carrying the session cookie but NO `X-CSRF-Token` header returned
 * 201. Enforcement is opt-in per method via `@RequireCsrf(action)`, and the Stage 11
 * administration controller declared it nowhere — so sixteen administrative mutations,
 * including custom-role changes, maintenance mode and dead-letter replay, were not
 * protected. Auditing the rest then showed the gap was systemic rather than local.
 *
 * Nothing detected this: the routes work, the tests passed, and the guard is simply
 * absent. `SameSite=Strict` on the session cookie is the mitigating control and is why
 * this is a hardening defect rather than an open hole, but the documented posture of
 * this codebase is that mutations carry the token, and defence in depth is the point.
 *
 * KNOWN_GAPS is a shrinking list, not an allowlist. Each entry is a route count that
 * must reach zero. It exists so the gap is visible and counted in CI instead of being
 * rediscovered later; adding to it is not an acceptable way to make this test pass.
 */

const CONTROLLERS = new URL('../apps/api/src/', import.meta.url);
const MUTATION = /@(Post|Put|Patch|Delete)\(/g;
const CSRF = /@RequireCsrf\(/g;

/**
 * Routes that legitimately cannot carry a CSRF token, with the reason.
 * `POST /sessions` mints the very token a mutation would need, so requiring one would
 * make a session impossible to create.
 */
const EXEMPT: Readonly<Record<string, number>> = {
  'sessions.controller.ts': 1,
};

/**
 * Pre-existing gaps found on 31 July 2026 in finance, procurement, emergency and
 * logistics — 35 unguarded mutations in total — were closed the same day. The list is
 * deliberately left EMPTY rather than deleted: a future gap belongs here with a date and
 * a count so it is tracked and shrinking, and the tests below refuse an entry that has
 * already reached zero so it cannot go stale.
 */
const KNOWN_GAPS: Readonly<Record<string, number>> = {};

interface Coverage {
  readonly file: string;
  readonly mutating: number;
  readonly guarded: number;
}

function coverage(): readonly Coverage[] {
  const found: Coverage[] = [];
  const walk = (dir: URL): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir)); continue; }
      if (!entry.name.endsWith('.controller.ts')) continue;
      const source = readFileSync(new URL(entry.name, dir), 'utf8');
      const mutating = [...source.matchAll(MUTATION)].length;
      if (mutating === 0) continue;
      found.push({ file: entry.name, mutating, guarded: [...source.matchAll(CSRF)].length });
    }
  };
  walk(CONTROLLERS);
  return found;
}

test('every state-changing route enforces CSRF, apart from tracked exceptions', () => {
  const unguarded: string[] = [];
  for (const entry of coverage()) {
    const allowed = (EXEMPT[entry.file] ?? 0) + (KNOWN_GAPS[entry.file] ?? 0);
    const missing = entry.mutating - entry.guarded;
    if (missing > allowed) {
      unguarded.push(
        `${entry.file}: ${missing} of ${entry.mutating} mutations lack @RequireCsrf `
        + `(at most ${allowed} tracked)`,
      );
    }
  }
  assert.deepEqual(unguarded, [],
    `state-changing routes with no CSRF enforcement:\n${unguarded.join('\n')}`);
});

test('the tracked CSRF gaps have not grown', () => {
  // A gap that widens is a regression even while the total stays non-zero, which a
  // simple pass/fail on the whole codebase would not catch.
  const byFile = new Map(coverage().map((entry) => [entry.file, entry]));
  for (const [file, budget] of Object.entries(KNOWN_GAPS)) {
    const entry = byFile.get(file);
    assert.ok(entry, `${file} is in KNOWN_GAPS but declares no mutating routes`);
    const missing = entry.mutating - entry.guarded;
    assert.ok(missing <= budget,
      `${file} now has ${missing} unguarded mutations, up from the recorded ${budget}`);
    // When a gap is closed, the entry must be removed rather than left at a stale
    // number, or the list stops describing reality.
    assert.notEqual(missing, 0,
      `${file} no longer has a CSRF gap — remove it from KNOWN_GAPS`);
  }
});

test('the administration surface is fully CSRF guarded', () => {
  // Pinned separately because this is the surface the defect was found on, and it
  // carries custom-role changes, maintenance mode and dead-letter replay.
  const entry = coverage().find((candidate) => candidate.file === 'stage11.controller.ts');
  assert.ok(entry, 'stage11.controller.ts was not found');
  assert.equal(entry.guarded, entry.mutating,
    `${entry.mutating - entry.guarded} administration mutations are unguarded`);
});

test('only the session bootstrap is exempt from CSRF, and it is exempt for a reason', () => {
  // Guards the exemption itself. If a second route were added to EXEMPT, or if
  // `POST /sessions` gained a sibling that quietly inherited the allowance, that would
  // widen the unprotected surface without any test noticing.
  assert.deepEqual(Object.keys(EXEMPT), ['sessions.controller.ts'],
    'only session creation may be exempt: it mints the token a mutation would need');
  assert.equal(EXEMPT['sessions.controller.ts'], 1, 'exactly one session route may be exempt');

  const totals = coverage().reduce(
    (accumulator, entry) => ({
      mutating: accumulator.mutating + entry.mutating,
      guarded: accumulator.guarded + entry.guarded,
    }),
    { mutating: 0, guarded: 0 },
  );
  // One unguarded mutation across the entire API, and it is the bootstrap.
  assert.equal(totals.mutating - totals.guarded, 1,
    `expected exactly 1 unguarded mutation (session bootstrap), found ${totals.mutating - totals.guarded}`);
});
