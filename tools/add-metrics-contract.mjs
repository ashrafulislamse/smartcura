/**
 * Adds GET /admin/metrics to the hand-authored OpenAPI document.
 *
 * The document is edited programmatically because it is 624 KB and a manual insert risks
 * breaking a structure that `route-contract.test.ts` and `validate-contracts.mjs` both depend
 * on. A 2-space round-trip of this file is byte-identical, verified before writing, so the diff
 * contains only the addition.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
const raw = readFileSync(path, 'utf8');
const document = JSON.parse(raw);

// Refuse to run if a round-trip would reformat the file: the diff must be only this change.
const roundTrip = `${JSON.stringify(document, null, 2)}\n`;
if (roundTrip !== raw) {
  console.error('refusing: a 2-space round-trip is not byte-identical, so this would reformat');
  process.exit(1);
}

const schemas = document.components.schemas;

schemas.AdminAppointmentMetrics = {
  type: 'object',
  additionalProperties: false,
  required: ['total', 'starting_within_24h', 'active'],
  properties: {
    total: { type: 'integer', minimum: 0, description: 'All appointments in the organization.' },
    starting_within_24h: {
      type: 'integer',
      minimum: 0,
      description:
        'Appointments whose slot starts in the next 24 hours. A calendar day is deliberately not used: an organization has no stored timezone, so "today" could only be guessed.',
    },
    active: {
      type: 'integer',
      minimum: 0,
      description:
        'Appointments still representing a live commitment: pending_payment, confirmed, checked_in or in_progress. Excludes rescheduled, whose replacement is counted instead.',
    },
  },
};

schemas.AdminEmergencyMetrics = {
  type: 'object',
  additionalProperties: false,
  required: ['active'],
  properties: {
    active: {
      type: 'integer',
      minimum: 0,
      description: 'Emergency events not yet resolved, cancelled or marked a false alarm.',
    },
  },
};

schemas.AdminSupportMetrics = {
  type: 'object',
  additionalProperties: false,
  required: ['open', 'breaching_resolution'],
  properties: {
    open: {
      type: 'integer',
      minimum: 0,
      description: 'Tickets not yet resolved or closed.',
    },
    breaching_resolution: {
      type: 'integer',
      minimum: 0,
      description:
        'Open tickets already past resolution_due_at. Derived from the clock rather than a stored flag so it cannot go stale.',
    },
  },
};

schemas.AdminDoctorMetrics = {
  type: 'object',
  additionalProperties: false,
  required: ['listed', 'accepting_new_patients'],
  properties: {
    listed: {
      type: 'integer',
      minimum: 0,
      description:
        'Doctors visible in the directory: active membership with approved verification. Matches the directory predicate exactly, so the count and the list cannot disagree.',
    },
    accepting_new_patients: { type: 'integer', minimum: 0 },
  },
};

schemas.AdminRevenueMetrics = {
  type: 'object',
  additionalProperties: false,
  required: ['captured_sen', 'currency', 'period_start'],
  properties: {
    captured_sen: {
      type: 'integer',
      minimum: 0,
      description:
        'Captured consultation payments for the current calendar month, in integer sen. Pending payments are excluded because they may never arrive, and refunds because that money was returned.',
    },
    currency: { type: 'string', const: 'MYR' },
    period_start: { $ref: '#/components/schemas/Timestamp' },
  },
};

schemas.AdminMetricsGroups = {
  type: 'object',
  additionalProperties: false,
  description:
    'Every group is OPTIONAL. A group the caller lacks permission for is omitted entirely rather than returned as zero: a zero would assert something false while still revealing the group exists, and would be indistinguishable from a genuinely empty organization.',
  properties: {
    appointments: { $ref: '#/components/schemas/AdminAppointmentMetrics' },
    emergencies: { $ref: '#/components/schemas/AdminEmergencyMetrics' },
    support: { $ref: '#/components/schemas/AdminSupportMetrics' },
    doctors: { $ref: '#/components/schemas/AdminDoctorMetrics' },
    revenue: { $ref: '#/components/schemas/AdminRevenueMetrics' },
  },
};

schemas.AdminMetricsResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'readable_groups'],
  properties: {
    data: { $ref: '#/components/schemas/AdminMetricsGroups' },
    readable_groups: {
      type: 'array',
      items: { type: 'string' },
      description:
        'The groups present in data, named so a caller can tell a refused group from one this build does not implement.',
    },
  },
};

document.paths['/admin/metrics'] = {
  get: {
    operationId: 'readAdminMetrics',
    tags: ['Administration'],
    summary: 'Read dashboard aggregate counts',
    description:
      'Aggregate counts for the administrative dashboard, scoped to the organization of the active membership. Each group is gated on the same permission as the collection it summarises, so this endpoint can never disclose a count the caller could not have obtained by paging that collection. Groups the caller cannot read are omitted rather than zeroed. Exists because a total cannot be computed from a collection endpoint bounded at 100 rows.',
    responses: {
      200: {
        description: 'Counts for the groups the caller is permitted to read.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AdminMetricsResponse' },
          },
        },
      },
      401: { $ref: '#/components/responses/AppSessionInvalid' },
      403: { $ref: '#/components/responses/Forbidden' },
    },
  },
};

writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log('added GET /admin/metrics and 6 schemas');
