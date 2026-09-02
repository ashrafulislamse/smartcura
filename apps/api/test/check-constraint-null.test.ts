import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

/**
 * Guard against NULL-satisfiable CHECK constraints.
 *
 * WHY THIS EXISTS. A CHECK constraint that evaluates to NULL is SATISFIED, not
 * violated. This defect class has been found three times here, each time in a
 * constraint that was syntactically correct and read as if it worked:
 *
 *   1. `(content -> 'non_diagnostic') = 'true'::jsonb`  — unlabelled AI artifacts were
 *      accepted, so a documented WP-08 guarantee was false (fixed by 0026).
 *   2. `("manual_override" AND "override_reason_code" ~ '...')` — `true AND NULL` is
 *      NULL, so an unexplained dispatch override was storable (fixed by 0029).
 *   3. `("terminated_at" IS NULL OR "termination_reason_code" ~ '...')` — `false OR
 *      NULL` is NULL, so an unexplained break-glass termination was storable (0029).
 *
 * SCOPE, AND WHY IT IS NARROW. "Nullable column compared without IS NOT NULL" is NOT
 * a defect on its own: `ended_at >= assigned_at` skipping while a row is still open is
 * idiomatic and intended. A first attempt at this rule flagged 25 such constraints and
 * would have been noise. The dangerous shape is a CONDITION paired with a REQUIREMENT
 * on a different nullable column, where NULL silently waives the requirement:
 *
 *   (a) a state test (bare boolean, `IS TRUE/FALSE`, or `= literal`) ANDed with a
 *       comparison on a different nullable column — case 2; and
 *   (b) two branches where one is a bare `IS NULL` on column A and the other requires
 *       something of a different nullable column B — case 3.
 *
 * The safe same-column form `"x" IS NULL OR "x" ~ '...'` is explicitly allowed, since
 * the first branch is TRUE (not NULL) exactly when the second would be NULL.
 *
 * An earlier version of this test was VACUOUS: it pattern-matched branch shapes, passed
 * immediately, and missed cases 2 and 3 even though 0028 still contains their original
 * text. The first test below now pins that text as a positive control.
 */

const MIGRATIONS = new URL('../packages/database/drizzle/', import.meta.url);

function migrations(): readonly { readonly name: string; readonly sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, MIGRATIONS), 'utf8') }));
}

/**
 * `table.column` keys for every NOT NULL column. Keyed by table because the same
 * column name is nullable in one table and required in another, and a global set would
 * hide real holes. The type is matched loosely because `numeric(12, 4)` contains a
 * comma, which an earlier stop-at-comma pattern tripped over — that bug alone made
 * every `vital_readings.value` range branch look nullable.
 */
function requiredColumns(): ReadonlySet<string> {
  const required = new Set<string>();
  for (const { sql } of migrations()) {
    for (const table of sql.matchAll(/CREATE TABLE "([^"]+)"\s*\(([\s\S]*?)\n\);/g)) {
      const name = table[1]!;
      for (const line of table[2]!.split('\n')) {
        if (/^\s*CONSTRAINT/i.test(line)) continue;
        const column = /^\s*"([^"]+)"\s+.*\bNOT NULL\b/.exec(line);
        if (column) required.add(`${name}.${column[1]!}`);
      }
    }
    for (const added of sql.matchAll(
      /ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)"[^;]*?\bNOT NULL\b/g,
    )) required.add(`${added[1]!}.${added[2]!}`);
    for (const altered of sql.matchAll(
      /ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET NOT NULL/g,
    )) required.add(`${altered[1]!}.${altered[2]!}`);
  }
  return required;
}

function stripParens(text: string): string {
  let value = text.trim();
  for (;;) {
    if (!value.startsWith('(') || !value.endsWith(')')) return value;
    let depth = 0;
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === '(') depth += 1;
      if (value[index] === ')') depth -= 1;
      if (depth === 0 && index < value.length - 1) return value;
    }
    value = value.slice(1, -1).trim();
  }
}

function splitTopLevel(body: string, keyword: 'OR' | 'AND'): readonly string[] {
  const parts: string[] = [];
  const pattern = new RegExp(`^\\s+${keyword}\\s+`, 'i');
  let depth = 0;
  let current = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    const rest = body.slice(index);
    const match = depth === 0 ? pattern.exec(rest) : null;
    if (match) {
      parts.push(current);
      current = '';
      index += match[0].length - 1;
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Last quoted identifier before an operator, so `"t"."c" ~ x` resolves to `c`. */
const COMPARISON = /(?:"([A-Za-z0-9_]+)"\.)?"([A-Za-z0-9_]+)"\s*(?:~|<>|>=|<=|=|>|<|BETWEEN|LIKE)/gi;
const BARE_NULL = /^(?:"[A-Za-z0-9_]+"\.)?"([A-Za-z0-9_]+)"\s+IS\s+NULL$/i;
const STATE_TEST = /^(?:NOT\s+)?(?:"[A-Za-z0-9_]+"\.)?"([A-Za-z0-9_]+)"(?:\s+IS\s+(?:NOT\s+)?(?:TRUE|FALSE))?$/i;
const LITERAL_TEST = /^(?:"[A-Za-z0-9_]+"\.)?"([A-Za-z0-9_]+)"\s*=\s*'[^']*'(?:::\w+)?$/i;

interface Finding {
  readonly file: string;
  readonly constraint: string;
  readonly column: string;
  readonly shape: 'condition-and-requirement' | 'sibling-guards-other-column';
}

/** Extract the balanced parenthesised expression starting at `open`. */
function balanced(text: string, open: number): string {
  let depth = 0;
  let inString = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "'") inString = !inString;
    if (inString) continue;
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return '';
}

interface CheckConstraint {
  readonly table: string;
  readonly constraint: string;
  readonly body: string;
}

/**
 * Every CHECK, attributed to its table. An earlier single combined regex matched only
 * the FIRST constraint per table, because the match consumed the `CREATE TABLE` header
 * that later constraints also needed — which silently disabled the whole rule and was
 * caught only by the positive-control test below.
 */
function checkConstraints(sql: string): readonly CheckConstraint[] {
  const constraints: CheckConstraint[] = [];
  const collect = (table: string, region: string): void => {
    const pattern = /CONSTRAINT "([^"]+)" CHECK\s*\(/g;
    for (let match = pattern.exec(region); match !== null; match = pattern.exec(region)) {
      const open = match.index + match[0].length - 1;
      const body = balanced(region, open);
      if (body.length > 0) constraints.push({ table, constraint: match[1]!, body });
    }
  };
  for (const table of sql.matchAll(/CREATE TABLE "([^"]+)"\s*\(([\s\S]*?)\n\);/g)) {
    collect(table[1]!, table[2]!);
  }
  for (const altered of sql.matchAll(/ALTER TABLE "([^"]+)" ADD (CONSTRAINT "[^"]+" CHECK\s*\([\s\S]*?\n?);?/g)) {
    collect(altered[1]!, altered[2]!);
  }
  return constraints;
}

function findings(): readonly Finding[] {
  const required = requiredColumns();
  const found: Finding[] = [];
  for (const { name, sql } of migrations()) {
    for (const { table, constraint, body } of checkConstraints(sql)) {
      const branches = splitTopLevel(body, 'OR').map(stripParens);
      const bareGuards = new Set(
        branches.map((branch) => BARE_NULL.exec(branch)?.[1])
          .filter((column): column is string => column !== undefined),
      );
      const nullable = (column: string): boolean => !required.has(`${table}.${column}`);
      const requirementColumns = (branch: string): readonly string[] => {
        if (/IS\s+NOT\s+NULL/i.test(branch)) return [];
        return [...branch.matchAll(COMPARISON)]
          .map((match) => match[2]!)
          .filter((column) => nullable(column) && !bareGuards.has(column));
      };

      for (const branch of branches) {
        const conjuncts = splitTopLevel(branch, 'AND').map(stripParens);
        const conditions = new Set(
          conjuncts.flatMap((part) => {
            const state = STATE_TEST.exec(part)?.[1];
            const literal = LITERAL_TEST.exec(part)?.[1];
            return [state, literal].filter((value): value is string => value !== undefined);
          }),
        );
        if (conditions.size > 0) {
          for (const column of requirementColumns(branch)) {
            if (conditions.has(column)) continue;
            found.push({ file: name, constraint, column, shape: 'condition-and-requirement' });
          }
        }
        if (conditions.size === 0 && bareGuards.size > 0 && !BARE_NULL.test(branch)) {
          for (const column of requirementColumns(branch)) {
            found.push({ file: name, constraint, column, shape: 'sibling-guards-other-column' });
          }
        }
      }
    }
  }
  return found;
}

test('the detector catches the historical NULL-satisfiable constraints', () => {
  // Positive control. 0028 still holds the ORIGINAL text of cases 2 and 3, corrected by
  // 0029, so a working detector must flag them there. Without this, a broken detector
  // passes silently — which the first version of this test did.
  const flagged = new Set(findings()
    .filter((finding) => finding.file.startsWith('0028_'))
    .map((finding) => finding.constraint));
  assert.ok(flagged.has('emergency_dispatches_override_check'),
    `must flag the override check in 0028; flagged: ${[...flagged].join(', ') || 'nothing'}`);
  assert.ok(flagged.has('break_glass_grants_termination_reason_check'),
    `must flag the termination check in 0028; flagged: ${[...flagged].join(', ') || 'nothing'}`);
});

test('the detector does not flag the safe same-column guard form', () => {
  // `"x" IS NULL OR "x" ~ '...'` is correct and widespread; flagging it would make the
  // rule noise and it would be switched off.
  const safe = findings().filter((finding) =>
    finding.constraint === 'appointments_cancellation_reason_code_check' ||
    finding.constraint === 'stored_objects_verified_sha256_check');
  assert.deepEqual(safe, []);
});

test('no live CHECK constraint is satisfiable by NULL', () => {
  // 0028's two constraints are excluded because 0029 replaces them: an applied
  // migration is immutable, so a corrective migration is the fix, not an edit.
  const superseded = new Set([
    'emergency_dispatches_override_check',
    'break_glass_grants_termination_reason_check',
  ]);
  const rendered = findings()
    .filter((finding) => !(finding.file.startsWith('0028_') && superseded.has(finding.constraint)))
    .map((finding) =>
      `${finding.file} :: ${finding.constraint} :: nullable "${finding.column}" (${finding.shape})`);
  assert.deepEqual(rendered, [],
    `a NULL CHECK is SATISFIED, so these do not constrain what they appear to:\n${rendered.join('\n')}`);
});

test('the corrective migrations state their NULL expectations explicitly', () => {
  const corrective = readFileSync(
    new URL('0029_fix_emergency_null_checks.sql', MIGRATIONS), 'utf8');
  for (const constraint of [
    'emergency_dispatches_override_check',
    'break_glass_grants_termination_reason_check',
  ]) assert.match(corrective, new RegExp(constraint));
  assert.match(corrective, /IS NOT NULL/);
  // Containment is false, not NULL, when the key is absent; equality on `->` is NULL.
  assert.match(
    readFileSync(new URL('0026_fix_ai_disclaimer_check.sql', MIGRATIONS), 'utf8'), /@>/);
});
