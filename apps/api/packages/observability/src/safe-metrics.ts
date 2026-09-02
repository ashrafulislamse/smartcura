/**
 * Metric and span label safety.
 *
 * The rule here is STRICTER than the log allowlist, and deliberately so. A log
 * line may carry an opaque `profile_id`, because correlating one incident is worth
 * one identifier. A metric label may not carry any identifier at all, for two
 * independent reasons:
 *
 *   1. Cardinality. Prometheus creates one time series per distinct label
 *      combination. A `profile_id` label on a request counter means one series per
 *      user, which exhausts memory long before it becomes useful.
 *   2. Re-identification. A metric endpoint is usually scraped by infrastructure
 *      with weaker access control than the API, so an identifier there is exposed
 *      more broadly than the record it points at.
 *
 * Labels are therefore restricted to a small set of BOUNDED dimensions whose value
 * space is known in advance.
 */

/**
 * Permitted label names. Every one has a small, enumerable value space.
 *
 * Deliberately absent: `profile_id`, `patient_id`, `appointment_id`, `device_id`,
 * `correlation_id`, `object_key`, `email`, and every other identifier or free-text
 * field. If an investigation needs those, it belongs in a log or an audit record,
 * not on a time series.
 */
export const METRIC_LABEL_ALLOWLIST: ReadonlySet<string> = new Set([
  'route',
  'method',
  'http_status_class',
  'outcome',
  'code',
  'role',
  'event_type',
  'aggregate_type',
  'adapter',
  'provider',
  'severity',
  'queue',
  'worker_id',
  'build_version',
  'environment',
]);

/**
 * Values a label may take. Bounded hard, because a label value is part of the
 * series key: an unbounded value is a cardinality explosion in slow motion.
 */
const MAX_LABEL_LENGTH = 64;
// A leading `/` is permitted because a normalized route label is a path. Every
// other position is restricted to characters that cannot smuggle structure.
const LABEL_VALUE = /^[A-Za-z0-9/][A-Za-z0-9._:/-]*$/;

/** Anything that looks like an identifier is refused even under a permitted name. */
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONG_DIGIT_RUN = /\d{6,}/;

export interface MetricLabels {
  readonly [key: string]: string;
}

/**
 * Collapses an HTTP status into its class.
 *
 * The exact status is a useful log field but a poor label: `2xx`/`4xx`/`5xx` is
 * what alerting actually thresholds on, and it keeps the value space at five.
 */
export function httpStatusClass(status: number): string {
  if (!Number.isInteger(status) || status < 100 || status > 599) return 'unknown';
  return `${Math.floor(status / 100)}xx`;
}

/**
 * Projects candidate labels down to the safe set.
 *
 * Unsafe labels are DROPPED rather than marked, which is the opposite of the log
 * boundary's behaviour. A `[redacted]` label value would still create a series and
 * would still be wrong; omitting the dimension is the only harmless outcome.
 */
export function safeMetricLabels(input: Readonly<Record<string, unknown>>): MetricLabels {
  const output: Record<string, string> = {};
  for (const key of Object.keys(input).sort()) {
    if (!METRIC_LABEL_ALLOWLIST.has(key)) continue;
    const raw = input[key];
    const value = typeof raw === 'string'
      ? raw
      : typeof raw === 'number' && Number.isFinite(raw)
        ? String(raw)
        : typeof raw === 'boolean'
          ? String(raw)
          : undefined;
    if (value === undefined) continue;
    if (value.length === 0 || value.length > MAX_LABEL_LENGTH) continue;
    if (!LABEL_VALUE.test(value)) continue;
    // An identifier smuggled through a permitted name is still an identifier.
    if (UUID_LIKE.test(value) || LONG_DIGIT_RUN.test(value)) continue;
    output[key] = value;
  }
  return Object.freeze(output);
}

/**
 * Normalises a request path into a bounded route label.
 *
 * A raw path is per-resource and therefore per-user: `/api/v1/appointments/<uuid>`
 * would create a series per appointment. Identifier segments collapse to `:id` so
 * the label counts routes, which is the thing worth measuring.
 */
export function routeLabel(path: string): string {
  const [withoutQuery] = path.split('?', 1);
  const normalized = (withoutQuery ?? '')
    .split('/')
    .map((segment) => {
      if (segment.length === 0) return segment;
      if (UUID_LIKE.test(segment) || /^\d+$/.test(segment)) return ':id';
      return segment;
    })
    .join('/');
  return normalized.length === 0 || normalized.length > MAX_LABEL_LENGTH
    ? 'unknown'
    : normalized;
}
