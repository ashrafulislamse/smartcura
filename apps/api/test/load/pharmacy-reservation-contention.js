import http from 'k6/http';
import { Counter } from 'k6/metrics';
import {
  BASE_URL, actors, actorAt, csv, integerEnv, parseJson, requestParams, summaryOutput,
} from './common.js';

const orderIds = csv('ORDER_IDS');
const versions = csv('EXPECTED_VERSIONS', { required: false });
const allActors = actors();
const expectedReserved = integerEnv('EXPECTED_RESERVED_SUCCESSES', 1);
if (versions.length !== 0 && versions.length !== orderIds.length) {
  throw new Error('EXPECTED_VERSIONS must be omitted or have one entry per ORDER_IDS entry');
}

const reserved = new Counter('pharmacy_orders_stock_reserved');
const shortfall = new Counter('pharmacy_orders_reasoned_shortfall');
const conflicts = new Counter('pharmacy_expected_conflicts');
const unexpected = new Counter('pharmacy_reservation_unexpected');

export const options = {
  scenarios: {
    pharmacy_reservation_race: {
      executor: 'per-vu-iterations',
      vus: orderIds.length,
      iterations: 1,
      maxDuration: '2m',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    pharmacy_orders_stock_reserved: [`count==${expectedReserved}`],
    pharmacy_reservation_unexpected: ['count==0'],
  },
};

export default function () {
  reserved.add(0);
  unexpected.add(0);
  const index = __VU - 1;
  const orderId = orderIds[index];
  const expectedVersion = versions.length === 0 ? 0 : Number(versions[index]);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error(`Invalid EXPECTED_VERSIONS entry at index ${index}`);
  }
  const actor = actorAt(allActors, index);
  const response = http.post(
    `${BASE_URL}/pharmacy-orders/${orderId}/validation`,
    JSON.stringify({ state: 'valid', reason_code: null, expected_version: expectedVersion }),
    requestParams(actor, {
      idempotencyKey: `k6-pharmacy-${__VU}-${Date.now()}`,
      tags: { operation: 'validatePharmacyOrder', risk: 'stock_reservation_contention' },
    }),
  );

  if (response.status === 200) {
    const body = parseJson(response);
    if (body && body.pharmacy_order_id === orderId && body.status === 'stock_reserved') reserved.add(1);
    else if (body && body.pharmacy_order_id === orderId && body.status === 'validated' &&
             Array.isArray(body.shortfall_order_item_ids) && body.shortfall_order_item_ids.length > 0) {
      shortfall.add(1);
    } else unexpected.add(1, { status: 'invalid_body' });
  } else if (response.status === 409) conflicts.add(1);
  else unexpected.add(1, { status: String(response.status) });
}

export function handleSummary(data) {
  return summaryOutput(data, 'pharmacy-reservation-contention-summary.json');
}
