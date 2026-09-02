# SmartCura k6 load scenarios

**Execution status: PARTIALLY EXECUTED — 15 August 2026.** `health-baseline.js` and `portal-baseline.js` were run with k6 v2.2.0 against the live deployment; results are tracked in `results/LOAD_TEST_RESULTS.md`. The four race-condition scripts in this directory remain NOT EXECUTED — they need authenticated sessions and seeded fixtures, and no race, contention, or capacity result is claimed for them.

## Contract and safety

All URLs are real OpenAPI paths under `/api/v1`. State-changing calls send the SmartCura session cookie, `X-CSRF-Token`, exact JSON content type, and `Idempotency-Key` where the contract requires it. Run only against an isolated environment with synthetic fixtures. These scripts intentionally create/transition persistent data and are not cleanup tools.

Create a results directory before a future run:

```powershell
New-Item -ItemType Directory -Force test/load/results | Out-Null
```

Common environment variables:

- `BASE_URL`, default `http://127.0.0.1:3000/api/v1`
- `ORIGIN`, default `http://127.0.0.1:3001`
- `SESSION_COOKIES`: comma-separated raw opaque cookie values (not full `Cookie:` headers)
- `CSRF_TOKENS`: corresponding comma-separated tokens
- `K6_SUMMARY_PATH`: retained JSON output path

Do not store credentials in shell history, scripts, result files, or version control. Prefer secret-file/environment injection provided by the load host.

## Scenarios

### Appointment holds and bookings

Requires `CONTENDERS` distinct eligible patient sessions, `HOLD_SLOT_ID`, `BOOK_SLOT_ID`, and `ORGANIZATION_ID`. The hold and direct-booking races use different open slots and each expects exactly one winner.

```powershell
k6 run test/load/appointment-contention.js
```

Default contenders: 20. Prepare both slots as open/bookable for the respective patients. Verify database state after the run; k6's one-success counters are necessary but not sufficient evidence.

### Vital ingestion

Requires `DEVICE_IDS`; session pairs can be one authorized gateway/admin actor or corresponding authorized patients. Each request submits the three FYP scalar metrics. Defaults model 100 three-reading batches/minute for a one-minute smoke only.

```powershell
$env:RATE_PER_MINUTE='100'; $env:DURATION='24h'; k6 run test/load/vital-ingestion.js
$env:RATE_PER_MINUTE='1000'; $env:DURATION='1h'; k6 run test/load/vital-ingestion.js
```

The first production-shaped gate represents 100 patients × three readings/minute. The second is the documented 10× reconnect cadence. A real capacity claim additionally needs 100 devices/patients, host/PostgreSQL/WAL/outbox telemetry, duplicate replay, alert-lag measurement, and post-run reconciliation.

### Pharmacy reservation contention

Requires `ORDER_IDS` for orders competing over the same constrained stock, an authorized pharmacy actor/session, and optional corresponding `EXPECTED_VERSIONS` (default zero). `EXPECTED_RESERVED_SUCCESSES` defaults to one but must match the fixture's stock/order quantities.

```powershell
k6 run test/load/pharmacy-reservation-contention.js
```

Afterward prove `posted quantity - active reservations >= 0` from the database. HTTP outcomes alone do not prove no oversell.

### Dispatch offer acceptance

Requires sibling `OFFER_IDS` for the same dispatch job, one distinct eligible driver session per offer, and corresponding `VEHICLE_IDS` (`null` is accepted as a list value). Exactly one acceptance should create an assignment; losers should receive stable 409 outcomes.

```powershell
k6 run test/load/dispatch-acceptance-race.js
```

Afterward verify exactly one accepted offer and one active assignment for the job.

## Result interpretation

Expected contention conflicts are domain success, not availability errors. Each script tracks an explicit `*_unexpected` counter and exact winner counters. k6 thresholds enforce invariants only; they deliberately contain no invented latency thresholds. Copy measured latency percentiles and counters from retained summary JSON into `docs/nfr-measured-vs-target-report.md`, then attach database and infrastructure evidence from the same run.
