/**
 * PHI-safe structured logging.
 *
 * The plan requires an ALLOWLIST rather than post-hoc redaction, and the
 * difference matters: a denylist has to predict every field a future slice might
 * add, and it fails silently the first time someone adds `patient_name`. An
 * allowlist fails the other way — a new field is dropped until somebody
 * deliberately approves it — so the default outcome of a mistake is a missing log
 * line, not a leaked diagnosis.
 *
 * Nothing here logs. It produces the only object shape a logger is allowed to
 * emit, so the rule is enforced at one boundary and testable in isolation.
 */

/**
 * Every key that may appear in a log record.
 *
 * Deliberately absent, and each for a reason:
 *   * no `patient_name`, `email`, `phone`, `display_name` — identity;
 *   * no `content`, `text_content`, `summary`, `note`, `rationale` — clinical text;
 *   * no `diagnosis`, `medication`, `dose` — clinical decisions;
 *   * no `value`, `metric_value` — raw vitals;
 *   * no `token`, `authorization`, `cookie`, `secret`, `password` — credentials;
 *   * no `object_key` — an object key is a capability hint for private storage;
 *   * no `body`, `payload`, `params` — arbitrary request data.
 *
 * Identifiers ARE allowed. An opaque UUID is the minimum needed to correlate an
 * incident, and it carries no clinical meaning on its own.
 */
export const LOG_FIELD_ALLOWLIST: ReadonlySet<string> = new Set([
  'event',
  'correlation_id',
  'causation_id',
  'request_id',
  'session_id',
  'profile_id',
  'membership_id',
  'organization_id',
  'site_id',
  'role',
  'permission',
  'action',
  'object_type',
  'object_id',
  'outcome',
  'code',
  'status',
  'http_status',
  'method',
  'route',
  'duration_ms',
  'attempts',
  'count',
  'event_id',
  'event_type',
  'event_version',
  'aggregate_type',
  'aggregate_id',
  'aggregate_version',
  'device_id',
  'appointment_id',
  'consultation_id',
  'conversation_id',
  'prescription_id',
  'artifact_id',
  'generation_id',
  'alert_id',
  'delivery_id',
  'payment_id',
  'scan_state',
  'severity',
  'reason_code',
  'build_version',
  'worker_id',
  'adapter',
  'provider',
]);

/** Marker recorded in place of dropped keys, so a gap is visible during triage. */
export const REDACTED_MARKER = '[redacted]';

export interface SafeLogRecord {
  readonly [key: string]: string | number | boolean | null;
}

/**
 * Values that survive at all. An object or array is never emitted: nested
 * structures are exactly how a request body or a clinical record reaches a log by
 * accident, and no allowlisted field legitimately needs one.
 */
function scalarOrUndefined(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  // NaN and Infinity are dropped: they serialize to `null` in JSON and would make
  // a numeric field silently meaningless.
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    // Bounded so a large allowlisted string cannot be used to smuggle a transcript
    // through a field that is normally short.
    return value.length <= 256 ? value : undefined;
  }
  return undefined;
}

/**
 * Projects arbitrary input down to the allowlisted, scalar-only shape.
 *
 * A dropped key is reported as `[redacted]` rather than removed entirely, because
 * during an incident "this field existed and was withheld" and "this field was
 * never set" are different facts.
 */
export function safeLogFields(input: Readonly<Record<string, unknown>>): SafeLogRecord {
  const output: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(input).sort()) {
    if (!LOG_FIELD_ALLOWLIST.has(key)) {
      output[key] = REDACTED_MARKER;
      continue;
    }
    const value = scalarOrUndefined(input[key]);
    output[key] = value === undefined ? REDACTED_MARKER : value;
  }
  return Object.freeze(output);
}

/**
 * Projects a thrown value into loggable fields.
 *
 * A message is NEVER logged. Driver and validation messages routinely quote the
 * offending value, so `duplicate key value violates ... (email)=(a@b.test)` would
 * put an address in the log. The error's constructor name plus a stable code is
 * enough to classify a failure; the detail belongs in an authorized audit record.
 */
export function safeErrorFields(error: unknown): SafeLogRecord {
  if (error instanceof Error) {
    const code = (error as { readonly code?: unknown }).code;
    return safeLogFields({
      outcome: 'error',
      // Class name only, and bounded like any other allowlisted string.
      code: typeof code === 'string' ? code : error.name,
    });
  }
  return safeLogFields({ outcome: 'error', code: 'non_error_thrown' });
}

/** Serializes an already-projected record. */
export function formatSafeLog(input: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(safeLogFields(input));
}
