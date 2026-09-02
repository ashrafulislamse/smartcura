import http from 'k6/http';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';

const PORTAL_URL = (__ENV.PORTAL_URL || 'https://portal.smartcura.app').replace(/\/$/, '');
const LIVEKIT_URL = (__ENV.LIVEKIT_URL || 'https://livekit.smartcura.app').replace(/\/$/, '');
const API_URL = (__ENV.API_URL || 'https://api.smartcura.app').replace(/\/$/, '');
const DURATION = __ENV.DURATION || '30s';
const RATE_PER_MINUTE = parseInt(__ENV.RATE_PER_MINUTE || '60', 10);

const apiHealthOk = new Counter('api_health_ok');
const apiHealthFail = new Counter('api_health_fail');
const portalOk = new Counter('portal_ok');
const portalFail = new Counter('portal_fail');
const livekitOk = new Counter('livekit_ok');
const livekitFail = new Counter('livekit_fail');

export const options = {
  scenarios: {
    infra_load: {
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
  // API health - stagger requests to avoid burst-triggering rate limiter
  const apiRes = http.get(`${API_URL}/api/v1/health`, { tags: { endpoint: 'api_health' } });
  if (apiRes.status === 200) apiHealthOk.add(1);
  else apiHealthFail.add(1);

  sleep(0.5);

  // Portal login redirect
  const portalRes = http.get(`${PORTAL_URL}/`, {
    redirects: 0,
    tags: { endpoint: 'portal_root' },
  });
  if (portalRes.status === 307) portalOk.add(1);
  else portalFail.add(1);

  sleep(0.5);

  // LiveKit server
  const livekitRes = http.get(`${LIVEKIT_URL}/`, { tags: { endpoint: 'livekit' } });
  if (livekitRes.status === 200) livekitOk.add(1);
  else livekitFail.add(1);
}

export function handleSummary(data) {
  const path = __ENV.K6_SUMMARY_PATH || 'apps/api/test/load/results/portal-baseline-summary.json';
  return { [path]: JSON.stringify(data, null, 2) };
}
