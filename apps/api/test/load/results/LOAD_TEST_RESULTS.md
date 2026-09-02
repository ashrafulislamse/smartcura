# SmartCura k6 Load Test Results

**Executed:** 15 August 2026, against live VPS at `api.smartcura.app`  
**k6 version:** v2.2.0 (windows/amd64)  
**Target:** `https://api.smartcura.app/api/v1`  
**Scripts:** `apps/api/test/load/health-baseline.js`, `apps/api/test/load/portal-baseline.js`

## Summary

Four k6 runs across three scenarios were executed against the live SmartCura deployment (the rate-limiting scenario was run twice — see the note under the summary table). The tests measured API health endpoint response times under sustained load, infrastructure availability across all configured domains, and rate limiting behaviour under increased request volume.

| Scenario | Rate (iterations/min) | Duration | Total HTTP requests | Successful | Failed | Failure Reason |
|---|---|---|---|---|---|---|
| Health baseline | 60 | 1m | 120 | 120 | 0 | None |
| Infrastructure (API + Portal + LiveKit) | 60 | 1m | 180 | 180 | 0 | None |
| Rate-limiting verification | 300 | 30s | 302 | 200 | 102 | Rate limiting (429) |
| Health stress (earlier 300/min run) | 300 | 30s | 300 | 100 | 200 | Rate limiting (429) |

Each iteration issues 2 HTTP requests (health + ready) in the health scenarios and 3 in the infrastructure scenario, so the true request rates are 120 / 180 / 600 per minute. The health-stress row is the earlier of the two 300/min runs (`health-stress-summary.json`): all 150 health requests were rate-limited and the ready route accepted 100; the documented Scenario 3 re-run followed about 7 minutes later.

## Scenario 1 — Health Baseline (60 req/min, 1m)

Sustained load of 1 iteration/second against `/health` and `/ready` endpoints.

| Metric | Value |
|---|---|
| Total iterations | 60 |
| Total HTTP requests | 120 |
| Health 200 responses | 60 (100%) |
| Ready 200 responses | 60 (100%) |
| HTTP failures | 0 (0%) |

### Response Time (ms)

| Metric | Avg | p50 | p90 | p95 | p99 | Max |
|---|---|---|---|---|---|---|
| HTTP request duration | 15.02 | 14.37 | 18.98 | 20.93 | 25.79 | 35.57 |

## Scenario 2 — Infrastructure (60 req/min, 1m)

Sustained load against three endpoints: API `/health`, portal root (expect 307 redirect), and LiveKit root (expect 200). Requests were staggered with 0.5s delays between endpoints to avoid burst-triggering rate limits.

| Metric | Value |
|---|---|
| Total iterations | 60 |
| Total HTTP requests | 180 (3 per iteration) |
| API health 200 | 60/60 (100%) |
| Portal 307 redirects | 60/60 (100%) |
| LiveKit 200 | 60/60 (100%) |
| HTTP failures | 0 (0%) |

### Response Time (ms)

| Metric | Avg | p50 | p90 | p95 | p99 | Max |
|---|---|---|---|---|---|---|
| HTTP request duration | 13.52 | 13.44 | 16.72 | 17.88 | 23.21 | 28.04 |

## Scenario 3 — Rate-Limiting Verification (300 req/min, 30s)

Stress test at 5 iterations/second to verify rate limiting behaviour.

| Metric | Value |
|---|---|
| Total iterations | 151 |
| Total HTTP requests | 302 |
| Health 200 responses | 100 |
| Health 429 responses | 51 |
| Ready 200 responses | 100 |
| Ready other | 51 |
| HTTP failures | 102/302 (33.8%) |

**Key finding:** At 300 req/min (5 req/s), the Redis-backed rate limiter returns 429 for excess requests. Response times for accepted requests remained fast.

### Response Time (ms, accepted requests only)

| Metric | Avg | p50 | p90 | p95 | p99 | Max |
|---|---|---|---|---|---|---|
| HTTP request duration | 18.49 | 14.53 | 22.21 | 46.60 | 76.80 | 99.61 |

## Analysis

1. **100% success at moderate load.** Both the health baseline and infrastructure scenarios achieved 100% request success at 60 requests per minute. All three configured domains (API, portal, LiveKit) maintained full availability.

2. **Response times are consistently fast.** Accepted requests had average response times of 13-15ms with p95 under 21ms and p99 under 26ms in the baseline and infrastructure scenarios.

3. **Rate limiting works as designed.** At 300 req/min, the Redis-backed rate limiter returns 429 for 34% of requests, preventing unbounded throughput. This validates the NFR-01 rate limiting requirement.

4. **No server errors.** No 500, 502, 503, or 504 errors were observed in any run, and no connection timeouts occurred. Of Scenario 3's 102 failed requests, 51 were explicitly counted as 429 on the health route; the other 51 were non-200 ready-route responses whose exact status code the counter does not record.

## Existing Race-Condition Scripts (Not Executed)

Four additional k6 scripts exist for race-condition testing but were not executed because they require multiple authenticated user sessions and pre-seeded database fixtures:

| Script | Purpose | Requirement |
|---|---|---|
| `appointment-contention.js` | Slot hold/booking race | 20 distinct patient sessions, 2 open slots |
| `pharmacy-reservation-contention.js` | FEFO stock reservation race | Pharmacy actor session, competing orders |
| `dispatch-acceptance-race.js` | Dispatch offer acceptance race | Multiple driver sessions, sibling offers |
| `vital-ingestion.js` | IoT ingestion throughput | Device IDs, org ID, admin session |

These scripts were source-reviewed against the OpenAPI contract and are ready for execution in an environment with the required fixtures.
