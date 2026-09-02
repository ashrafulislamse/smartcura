import http from 'k6/http';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import {
  BASE_URL, actors, actorAt, csv, integerEnv, parseJson, requestParams, requireEnv, summaryOutput,
} from './common.js';

const organizationId = requireEnv('ORGANIZATION_ID');
const deviceIds = csv('DEVICE_IDS');
const allActors = actors();
const ratePerMinute = integerEnv('RATE_PER_MINUTE', 100);
const preAllocatedVUs = integerEnv('PRE_ALLOCATED_VUS', Math.max(10, Math.ceil(ratePerMinute / 30)));
const maxVUs = integerEnv('MAX_VUS', Math.max(preAllocatedVUs, preAllocatedVUs * 2));
const bootId = integerEnv('BOOT_ID', Date.now(), 0);
const duration = __ENV.DURATION || '1m';

const accepted = new Counter('vital_readings_accepted');
const deduplicated = new Counter('vital_readings_deduplicated');
const rejected = new Counter('vital_readings_rejected');
const alertsRaised = new Counter('vital_alerts_raised');
const unexpected = new Counter('vital_ingestion_unexpected');

export const options = {
  scenarios: {
    vital_ingestion: {
      executor: 'constant-arrival-rate',
      rate: ratePerMinute,
      timeUnit: '1m',
      duration,
      preAllocatedVUs,
      maxVUs,
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    vital_ingestion_unexpected: ['count==0'],
    vital_readings_rejected: ['count==0'],
  },
};

export default function () {
  unexpected.add(0);
  rejected.add(0);
  const iteration = exec.scenario.iterationInTest;
  const deviceIndex = iteration % deviceIds.length;
  const deviceId = deviceIds[deviceIndex];
  const actor = actorAt(allActors, deviceIndex);
  const deviceBatch = Math.floor(iteration / deviceIds.length);
  const sequenceBase = deviceBatch * 3;
  const recordedAt = new Date().toISOString();
  const readings = [
    { boot_id: bootId, sequence_number: sequenceBase, metric: 'heart_rate', value: 72, unit: '/min', recorded_at: recordedAt, quality: 'valid' },
    { boot_id: bootId, sequence_number: sequenceBase + 1, metric: 'oxygen_saturation', value: 98, unit: '%', recorded_at: recordedAt, quality: 'valid' },
    { boot_id: bootId, sequence_number: sequenceBase + 2, metric: 'body_temperature', value: 36.8, unit: 'Cel', recorded_at: recordedAt, quality: 'valid' },
  ];

  const response = http.post(
    `${BASE_URL}/organizations/${organizationId}/devices/${deviceId}/vital-readings`,
    JSON.stringify({ readings }),
    requestParams(actor, {
      tags: { operation: 'ingestDeviceVitalReadings', risk: 'vital_ingestion' },
    }),
  );
  if (response.status !== 202) {
    unexpected.add(1, { status: String(response.status) });
    return;
  }

  const body = parseJson(response);
  if (!body || body.device_id !== deviceId ||
      Number(body.accepted) + Number(body.deduplicated) + Number(body.rejected) !== readings.length) {
    unexpected.add(1, { status: 'invalid_body' });
    return;
  }
  accepted.add(Number(body.accepted));
  deduplicated.add(Number(body.deduplicated));
  rejected.add(Number(body.rejected));
  alertsRaised.add(Number(body.alerts_raised));
}

export function handleSummary(data) {
  return summaryOutput(data, 'vital-ingestion-summary.json');
}
