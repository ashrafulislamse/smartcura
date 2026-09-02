import http from 'k6/http';
import { Counter } from 'k6/metrics';
import {
  BASE_URL, actors, actorAt, csv, parseJson, requestParams, summaryOutput,
} from './common.js';

const offerIds = csv('OFFER_IDS');
const vehicleValues = csv('VEHICLE_IDS');
const versions = csv('EXPECTED_VERSIONS', { required: false });
const allActors = actors({ count: offerIds.length, distinct: true });
if (vehicleValues.length !== offerIds.length) {
  throw new Error('VEHICLE_IDS must have one UUID or the literal null per offer');
}
if (versions.length !== 0 && versions.length !== offerIds.length) {
  throw new Error('EXPECTED_VERSIONS must be omitted or have one entry per offer');
}

const wins = new Counter('dispatch_acceptance_wins');
const conflicts = new Counter('dispatch_expected_conflicts');
const unexpected = new Counter('dispatch_acceptance_unexpected');

export const options = {
  scenarios: {
    dispatch_acceptance_race: {
      executor: 'per-vu-iterations',
      vus: offerIds.length,
      iterations: 1,
      maxDuration: '2m',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    dispatch_acceptance_wins: ['count==1'],
    dispatch_expected_conflicts: [`count==${offerIds.length - 1}`],
    dispatch_acceptance_unexpected: ['count==0'],
  },
};

export default function () {
  wins.add(0);
  conflicts.add(0);
  unexpected.add(0);
  const index = __VU - 1;
  const offerId = offerIds[index];
  const vehicleId = vehicleValues[index] === 'null' ? null : vehicleValues[index];
  const expectedVersion = versions.length === 0 ? 0 : Number(versions[index]);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error(`Invalid EXPECTED_VERSIONS entry at index ${index}`);
  }
  const actor = actorAt(allActors, index);
  const response = http.post(
    `${BASE_URL}/dispatch/offers/${offerId}/acceptance`,
    JSON.stringify({ vehicle_id: vehicleId, expected_version: expectedVersion }),
    requestParams(actor, {
      tags: { operation: 'acceptDispatchOffer', risk: 'dispatch_acceptance_race' },
    }),
  );

  if (response.status === 200) {
    const body = parseJson(response);
    if (body && body.status === 'assigned' && body.assignment_id && body.dispatch_job_id) wins.add(1);
    else unexpected.add(1, { status: 'invalid_body' });
  } else if (response.status === 409) conflicts.add(1);
  else unexpected.add(1, { status: String(response.status) });
}

export function handleSummary(data) {
  return summaryOutput(data, 'dispatch-acceptance-race-summary.json');
}
