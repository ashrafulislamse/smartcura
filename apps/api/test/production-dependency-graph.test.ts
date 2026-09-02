import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

/**
 * WP-14: the production dependency graph must contain NO mock data source.
 *
 * WHY THIS EXISTS. Three providers were hard-wired to their deterministic implementations
 * with no adapter switch at all, so a production deployment would have used them silently.
 * The payment one is the reason this test exists: a deterministic payment provider does not
 * simulate a gateway, it FABRICATES an outcome, which would confirm appointments and post
 * balanced ledger entries for money that was never charged. The books would look correct
 * and be false.
 *
 * A guard cannot be inferred from a class name, so this test does the next best thing: it
 * DISCOVERS every mock-shaped provider and fails if one is not in the registry below. A new
 * mock therefore forces an explicit decision about what production does with it, rather
 * than defaulting to "ships".
 */

const ROOTS = [
  new URL('../apps/api/src/', import.meta.url),
  new URL('../apps/worker/src/', import.meta.url),
  new URL('../packages/', import.meta.url),
];

/** Class-name shapes that indicate a non-production data source. */
const MOCK_SHAPE = /\bclass\s+((?:Mock|Deterministic|Fake|Stub|InMemory)[A-Za-z0-9_]*)/g;

/**
 * Every known mock provider, and how production refuses it. `guard` is the text asserted to
 * appear in a config file, so deleting the guard fails this test rather than silently
 * re-enabling the mock.
 */
const REGISTRY: readonly {
  readonly className: string;
  readonly guardFile: string;
  readonly guard: string;
  readonly why: string;
}[] = [
  {
    className: 'MockLlmProvider',
    guardFile: 'apps/worker/src/config.ts',
    guard: "value.SMARTCURA_AI_PROVIDER !== 'openai' && value.SMARTCURA_AI_PROVIDER !== 'cloudflare'",
    why: 'would generate clinical-support artifacts from a canned template',
  },
  {
    className: 'DeterministicMalwareScanner',
    guardFile: 'apps/worker/src/config.ts',
    guard: "value.SMARTCURA_MALWARE_SCANNER !== 'clamav'",
    why: 'would mark uploaded files clean without scanning them',
  },
  {
    className: 'DeterministicLocalIdentityTokenVerifier',
    guardFile: 'apps/api/src/config.ts',
    guard: "value.SMARTCURA_IDENTITY_ADAPTER !== 'firebase'",
    why: 'accepts a fixed bearer token as proof of identity',
  },
  {
    className: 'InMemoryObjectStorage',
    guardFile: 'packages/storage/src/config.ts',
    guard: 'Memory object storage is forbidden in production',
    why: 'loses every uploaded clinical file when the process restarts',
  },
  {
    // Registered twice on purpose. The factory repeats the rule independently of
    // configuration, so a bootstrap path that skips config still cannot select memory.
    className: 'InMemoryObjectStorage',
    guardFile: 'packages/storage/src/object-storage-factory.ts',
    guard: "environment === 'production'",
    why: 'defence in depth: the factory refuses memory storage even if configuration is bypassed',
  },
];

/**
 * FYP demo exception: these deterministic providers are intentionally allowed in
 * `NODE_ENV=production` for the final-year presentation because the real adapters are not
 * implemented yet. The worker logs a warning at boot. They must still be listed here so the
 * production-decision test cannot pass without acknowledging them.
 */
const FYP_DEMO_EXCEPTIONS: readonly {
  readonly className: string;
  readonly guardFile: string;
  readonly why: string;
}[] = [
  {
    className: 'DeterministicAppointmentPaymentProvider',
    guardFile: 'apps/worker/src/config.ts',
    why: 'FYP demo uses simulated payment; a real gateway will be required for clinical production',
  },
  {
    className: 'DeterministicPushDeliveryProvider',
    guardFile: 'apps/worker/src/config.ts',
    why: 'FYP demo defaults to simulated push; the real FCM adapter (FcmPushDeliveryProvider) is used only when SMARTCURA_PUSH_PROVIDER=fcm and Firebase credentials are set',
  },
  {
    className: 'DeterministicEmailDeliveryProvider',
    guardFile: 'apps/worker/src/config.ts',
    why: 'FYP demo uses simulated transactional email; real Cloudflare Email Service adapter is not yet wired to a verified sending domain',
  },
];

function discoverMockClasses(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: URL): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir)); continue; }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
      const source = readFileSync(new URL(entry.name, dir), 'utf8');
      for (const match of source.matchAll(MOCK_SHAPE)) {
        found.set(match[1]!, `${dir.pathname}${entry.name}`);
      }
    }
  };
  for (const root of ROOTS) walk(root);
  return found;
}

test('every mock data source is registered with a production decision', () => {
  const discovered = discoverMockClasses();
  const decided = new Set([...REGISTRY, ...FYP_DEMO_EXCEPTIONS].map((entry) => entry.className));
  const unregistered = [...discovered.keys()]
    .filter((className) => !decided.has(className))
    .sort();
  assert.deepEqual(unregistered, [],
    `these mock-shaped providers have no recorded production decision, so nothing stops them shipping:\n${unregistered.join('\n')}`);
});

test('every registered mock data source is refused in production', () => {
  const missing: string[] = [];
  for (const entry of REGISTRY) {
    const config = readFileSync(new URL(`../${entry.guardFile}`, import.meta.url), 'utf8');
    const guarded = config.includes(entry.guard)
      // Either expression of "this is production" counts: the API and worker read
      // `NODE_ENV`, while the storage package receives a normalized `environment`.
      && /(NODE_ENV|environment) === 'production'|forbidden in production/.test(config);
    if (!guarded) missing.push(`${entry.className} (${entry.why}) — expected guard in ${entry.guardFile}`);
  }
  assert.deepEqual(missing, [],
    `production would accept these mock data sources:\n${missing.join('\n')}`);
});

test('the registry documents why each mock must not reach production', () => {
  // A guard with no stated reason is the kind of thing a later reader deletes.
  for (const entry of REGISTRY) {
    assert.ok(entry.why.length > 20, `${entry.className} needs a stated consequence`);
  }
  assert.ok(REGISTRY.length >= 4, 'the registry looks incomplete');
});

test('every FYP-demo exception is documented in the relevant config', () => {
  const undocumented: string[] = [];
  for (const entry of FYP_DEMO_EXCEPTIONS) {
    const config = readFileSync(new URL(`../${entry.guardFile}`, import.meta.url), 'utf8');
    // The config must contain either the class name or the explicit "FYP demo" marker.
    const documented = config.includes('FYP demo') || config.includes(entry.className);
    if (!documented) {
      undocumented.push(`${entry.className} (${entry.why}) — expected FYP-demo note in ${entry.guardFile}`);
    }
  }
  assert.deepEqual(undocumented, [],
    `FYP-demo exceptions must be documented in their config files:\n${undocumented.join('\n')}`);
});
