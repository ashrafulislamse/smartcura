import http from 'k6/http';
import { Counter } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'https://api.smartcura.app/api/v1').replace(/\/$/, '');
const DURATION = __ENV.DURATION || '1m';
const RATE_PER_MINUTE = parseInt(__ENV.RATE_PER_MINUTE || '60', 10);

const health200 = new Counter('health_200');
const health429 = new Counter('health_429');
const healthOther = new Counter('health_other');
const ready200 = new Counter('ready_200');
const readyOther = new Counter('ready_other');

export const options = {
  scenarios: {
    health_load: {
      executor: 'constant-arrival-rate',
      rate: RATE_PER_MINUTE,
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: Math.max(10, Math.ceil(RATE_PER_MINUTE / 10)),
      maxVUs: Math.max(20, Math.ceil(RATE_PER_MINUTE / 5)),
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export default function () {
  const healthRes = http.get(`${BASE_URL}/health`, { tags: { endpoint: 'health' } });
  if (healthRes.status === 200) health200.add(1);
  else if (healthRes.status === 429) health429.add(1);
  else healthOther.add(1);

  const readyRes = http.get(`${BASE_URL}/ready`, { tags: { endpoint: 'ready' } });
  if (readyRes.status === 200) ready200.add(1);
  else readyOther.add(1);
}

export function handleSummary(data) {
  const path = __ENV.K6_SUMMARY_PATH || 'apps/api/test/load/results/health-baseline-summary.json';
  return { [path]: JSON.stringify(data, null, 2) };
}
