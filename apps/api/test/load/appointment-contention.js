import http from 'k6/http';
import { Counter } from 'k6/metrics';
import {
  BASE_URL, actors, actorAt, integerEnv, parseJson, requestParams, requireEnv, summaryOutput,
} from './common.js';

const contenders = integerEnv('CONTENDERS', 20, 2);
const allActors = actors({ count: contenders, distinct: true });
const holdSlotId = requireEnv('HOLD_SLOT_ID');
const bookSlotId = requireEnv('BOOK_SLOT_ID');
const organizationId = requireEnv('ORGANIZATION_ID');

const holdWins = new Counter('appointment_hold_wins');
const bookingWins = new Counter('appointment_booking_wins');
const expectedConflicts = new Counter('appointment_expected_conflicts');
const unexpected = new Counter('appointment_unexpected');

export const options = {
  scenarios: {
    hold_race: {
      executor: 'per-vu-iterations',
      vus: contenders,
      iterations: 1,
      maxDuration: '2m',
      exec: 'holdRace',
    },
    booking_race: {
      executor: 'per-vu-iterations',
      vus: contenders,
      iterations: 1,
      maxDuration: '2m',
      exec: 'bookingRace',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    appointment_hold_wins: ['count==1'],
    appointment_booking_wins: ['count==1'],
    appointment_expected_conflicts: [`count==${2 * (contenders - 1)}`],
    appointment_unexpected: ['count==0'],
  },
};

export function holdRace() {
  holdWins.add(0);
  expectedConflicts.add(0);
  unexpected.add(0);
  const actor = actorAt(allActors, __VU - 1);
  const response = http.post(
    `${BASE_URL}/appointments/slots/${holdSlotId}/hold`,
    null,
    requestParams(actor, {
      tags: { operation: 'holdAppointmentSlot', risk: 'slot_hold_contention' },
    }),
  );
  if (response.status === 200) holdWins.add(1);
  else if (response.status === 409) expectedConflicts.add(1);
  else unexpected.add(1, { operation: 'holdAppointmentSlot', status: String(response.status) });
}

export function bookingRace() {
  bookingWins.add(0);
  expectedConflicts.add(0);
  unexpected.add(0);
  const actor = actorAt(allActors, __VU - 1);
  const response = http.post(
    `${BASE_URL}/organizations/${organizationId}/appointments`,
    JSON.stringify({ slot_id: bookSlotId, mode: 'video' }),
    requestParams(actor, {
      idempotencyKey: `k6-book-${__VU}-${Date.now()}`,
      tags: { operation: 'bookAppointment', risk: 'slot_booking_contention' },
    }),
  );
  if (response.status === 201) {
    const body = parseJson(response);
    if (body && body.slot_id === bookSlotId) bookingWins.add(1);
    else unexpected.add(1, { operation: 'bookAppointment', status: 'invalid_body' });
  } else if (response.status === 409) expectedConflicts.add(1);
  else unexpected.add(1, { operation: 'bookAppointment', status: String(response.status) });
}

export function handleSummary(data) {
  return summaryOutput(data, 'appointment-contention-summary.json');
}
