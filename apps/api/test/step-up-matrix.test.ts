import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * The step-up matrix in `policy-matrix.md`, checked against the code that implements it.
 *
 * WHY THIS EXISTS. The matrix names specific actions per role that require recent
 * re-authentication. Two of them were silently unimplemented while the surfaces around them
 * looked finished: "reconciliation approval" for pharmacy and "manual dispatch override" for
 * emergency. Nothing failed, because a missing step-up check is invisible — the route simply
 * works, slightly more permissively than documented forever.
 *
 * This cannot be produced over HTTP either: the local identity fixture stamps `auth_time` at
 * verification, so every session is always inside the step-up window and a 403 can never be
 * observed. So the enforcement is checked where it lives.
 *
 * A row here is a claim about the documented matrix. If an action is added to the matrix and
 * not to this table, that is a gap this test cannot see — which is why the matrix text itself is
 * asserted to still contain each action.
 */

const ROOT = new URL('../', import.meta.url);
const POLICY = new URL('../docs/policy-matrix.md', import.meta.url);

interface StepUpRule {
  /** The exact phrase in the policy matrix, so drift in the document is detected. */
  readonly documented: string;
  readonly file: string;
  /** A fragment that must appear in the same method that guards the action. */
  readonly guardedBy: string;
  readonly why: string;
}

const RULES: readonly StepUpRule[] = [
  {
    documented: 'Sign prescription',
    file: 'apps/api/src/consultations/clinical-care.service.ts',
    guardedBy: 'requireStepUp',
    why: 'a signature is the clinical act a prescription rests on',
  },
  {
    documented: 'reconciliation approval',
    file: 'apps/api/src/logistics/procurement.controller.ts',
    guardedBy: "request.status === 'approved') this.requireStepUp",
    why: 'approval is the moment a stock discrepancy becomes an adjustment',
  },
  {
    documented: 'Controlled-substance action',
    file: 'apps/api/src/logistics/procurement.controller.ts',
    guardedBy: 'controlled_substance:manage:site',
    why: 'controlled-drug handling is the tightest inventory control there is',
  },
  {
    documented: 'manual dispatch override',
    file: 'apps/api/src/emergency/emergency.service.ts',
    guardedBy: 'request.manual_override) this.requireStepUp',
    why: 'overriding automatic unit selection is a reviewable act',
  },
  {
    documented: 'Break-glass',
    file: 'apps/api/src/emergency/emergency.service.ts',
    guardedBy: 'this.requireStepUp(current)',
    why: 'break-glass reads a record the actor has no ordinary relationship to',
  },
  {
    documented: 'payout action',
    file: 'apps/api/src/finance/finance.service.ts',
    guardedBy: "request.status === 'approved') this.requireStepUp",
    why: 'approval authorises money to leave',
  },
  {
    documented: 'Change bank details',
    file: 'apps/api/src/logistics/logistics.service.ts',
    guardedBy: "'driver.bank_account:manage:own');\n    this.requireStepUp",
    why: 'redirecting a driver\u2019s earnings needs no other access',
  },
  {
    documented: 'withdrawal',
    file: 'apps/api/src/logistics/logistics.service.ts',
    guardedBy: "'withdrawal:create:own');\n    this.requireStepUp",
    why: 'a withdrawal moves a driver\u2019s money out of the platform',
  },
  {
    documented: 'custom role change',
    file: 'apps/api/src/administration/stage11.service.ts',
    guardedBy: "'custom_role:manage:organization');\n    this.requireStepUp",
    why: 'a custom role can change the authority of many organization members',
  },
  {
    documented: 'maintenance mode change',
    file: 'apps/api/src/administration/stage11.service.ts',
    guardedBy: "'platform.maintenance:manage:global');\n    this.requireStepUp",
    why: 'maintenance mode changes availability for the entire platform',
  },
  {
    documented: 'dead-letter replay',
    file: 'apps/api/src/administration/stage11.service.ts',
    guardedBy: "'system.security:*:global');\n    this.requireStepUp",
    why: 'replay causes a previously terminal command to execute again',
  },
];

test('every step-up rule checked here is still in the documented matrix', () => {
  const policy = readFileSync(POLICY, 'utf8');
  const missing = RULES
    .filter((rule) => !policy.includes(rule.documented))
    .map((rule) => rule.documented);
  // If the matrix changed wording, this test is asserting something the document no longer
  // says, which is worse than not asserting it.
  assert.deepEqual(missing, [],
    `these phrases are no longer in policy-matrix.md, so the rules below may be stale:\n${missing.join('\n')}`);
});

test('every documented step-up action is enforced at its call site', () => {
  const unenforced: string[] = [];
  for (const rule of RULES) {
    // Line endings are normalized because several rules match literal `\n`
    // fragments, and a Windows autocrlf checkout hands this test CRLF source.
    const source = readFileSync(new URL(rule.file, ROOT), 'utf8').replace(/\r\n/g, '\n');
    if (!source.includes(rule.guardedBy)) {
      unenforced.push(`"${rule.documented}" (${rule.why}) — expected ${rule.guardedBy} in ${rule.file}`);
    }
  }
  assert.deepEqual(unenforced, [],
    `documented step-up actions with no enforcement:\n${unenforced.join('\n')}`);
});

test('the step-up guard rejects an absent or lapsed window, not merely an absent one', () => {
  // A guard that only checks for presence would accept a step-up from hours ago, which is the
  // same as no step-up at all for an action the matrix bounds to 10-30 minutes.
  for (const file of [
    'apps/api/src/emergency/emergency.service.ts',
    'apps/api/src/finance/finance.service.ts',
    'apps/api/src/logistics/procurement.controller.ts',
  ]) {
    const source = readFileSync(new URL(file, ROOT), 'utf8');
    assert.match(source, /stepUpValidUntil/, `${file} must read the step-up expiry`);
    assert.match(source, /getTime\(\) <= Date\.now\(\)/,
      `${file} must compare the step-up expiry against now, not merely test for presence`);
  }
});
