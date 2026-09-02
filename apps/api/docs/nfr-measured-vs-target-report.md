# SmartCura measured-vs-target NFR report

**Report status: PARTIALLY MEASURED — 15 August 2026.** k6 v2.2.0 ran against the live deployment; retained summaries for three baseline scenarios are in `apps/api/test/load/results/`. The four contention scenarios were not executed, so their rows remain UNMEASURED. Populate remaining measured cells only from retained k6 summary JSON and infrastructure telemetry from the same run.

## 1. Evidence identity

| Field | Value |
|---|---|
| Run ID | **UNMEASURED / not assigned** |
| UTC start/end | **UNMEASURED** |
| Git commit/build version | **UNMEASURED** |
| OpenAPI version/hash | **UNMEASURED** |
| Environment/provider/region | **UNMEASURED — WP-02D not selected here** |
| VPS resources | Target environment: 8 vCPU, 16 GiB RAM, at least 240 GiB SSD/NVMe; **actual unmeasured** |
| PostgreSQL/R2/Mosquitto/LiveKit versions | **UNMEASURED** |
| Dataset/fixture revision | **UNMEASURED** |
| Operator | **UNMEASURED** |
| k6 version | v2.2.0 (windows/amd64, 15 August 2026 baseline runs) |

## 2. Source artefacts and import rule

The scripts write k6 end-of-test JSON through `handleSummary`; set `K6_SUMMARY_PATH` per run and retain these files:

| Scenario | Script | Suggested summary file |
|---|---|---|
| Slot hold and booking contention | `test/load/appointment-contention.js` | `test/load/results/appointment-contention.json` |
| Vital ingestion | `test/load/vital-ingestion.js` | `test/load/results/vital-ingestion-baseline.json` and `...-replay10x.json` |
| Pharmacy FEFO reservation contention | `test/load/pharmacy-reservation-contention.js` | `test/load/results/pharmacy-reservation-contention.json` |
| Dispatch offer acceptance race | `test/load/dispatch-acceptance-race.js` | `test/load/results/dispatch-acceptance-race.json` |

For each JSON file, copy values from `metrics.<metric-name>.values`. Typical k6 fields include `count`, `rate`, `avg`, `med`, `min`, `max`, `p(90)`, and `p(95)` depending on metric type and k6 version. Preserve the original JSON; do not hand-calculate a percentile from averages. If a required percentile is absent, report **UNMEASURED** and rerun with a compatible k6 summary configuration.

## 3. Requirements and targets

Only targets traceable to the design record are prefilled. The repository does **not** currently define generic HTTP p95/p99 millisecond pass thresholds, so those targets remain **TARGET NOT APPROVED** rather than invented.

| NFR / invariant | Traceable target | Measured | Result | Evidence |
|---|---|---|---|---|
| Appointment single-slot booking | 20 parallel attempts create exactly 1 appointment; retries/conflicts do not create duplicates | **UNMEASURED** | **NOT RUN** | appointment summary + DB count |
| Appointment hold ownership | At most 1 contender owns the contested slot hold | **UNMEASURED** | **NOT RUN** | appointment summary + DB query |
| Pharmacy oversell prevention | Concurrent orders never make active reservations exceed posted stock | **UNMEASURED** | **NOT RUN** | pharmacy summary + ledger/reservation projection |
| Dispatch race | Exactly 1 offer is accepted/assignment created for one job; losers receive stable conflicts | **UNMEASURED** | **NOT RUN** | dispatch summary + DB count |
| FYP vitals steady cadence | Sustain 100 active patients × 3 scalar readings/minute for 24 h (300 readings/minute) | **UNMEASURED** | **NOT RUN** | vital summary + DB/host telemetry |
| Vitals reconnect burst | Inject 10× the one-hour cadence; no dropped accepted packet; ingestion/alert lag remains bounded | **UNMEASURED**; “bounded” numeric threshold **TARGET NOT APPROVED** | **NOT RUN** | vital 10× summary + DB/worker telemetry |
| Vitals deduplication | Duplicate replay inside window creates 0 duplicate readings and 0 duplicate alerts | **UNMEASURED** | **NOT RUN** | replay summary + DB counts |
| Raw heap + indexes | ≤ 340 bytes per retained scalar reading | **UNMEASURED** | **NOT RUN** | `pg_total_relation_size` evidence |
| Whole-VPS disk projection | < 80% of provisioned disk at the approved envelope | **UNMEASURED** | **NOT RUN** | disk and relation-size evidence |
| Chart query latency | Record p50/p95/p99 with partition pruning | **UNMEASURED**; latency target **TARGET NOT APPROVED** | **NOT RUN** | EXPLAIN + query timings |
| HTTP request latency by scenario | p50/p95/p99 must be reported | **PARTIALLY MEASURED** — three baseline scenarios in `apps/api/test/load/results/` (p95 20.93 / 17.88 / 46.60 ms); contention unmeasured; pass threshold **TARGET NOT APPROVED** | **PARTIAL** | `http_req_duration` from each summary |
| HTTP unexpected outcome rate | 0 unexpected status/shape outcomes in supplied scripts | **UNMEASURED** | **NOT RUN** | each script's `*_unexpected` counter |
| Outbox/dead-letter | No unexplained dead letter; backlog/oldest-event age reported | **UNMEASURED**; lag threshold **TARGET NOT APPROVED** | **NOT RUN** | read-only outbox queries |
| Restore | Database and object/manifest restore reconciles; RPO/RTO observed | **UNMEASURED** | **NOT RUN** | backup/restore rehearsal record |

## 4. Scenario measurements

### 4.1 Appointment hold/booking contention

| Metric | Target | Measured |
|---|---:|---:|
| Contenders | 20 for Stage 3 gate | **UNMEASURED** |
| Successful holds | Exactly 1 with distinct eligible patient sessions | **UNMEASURED** |
| Successful bookings | Exactly 1 | **UNMEASURED** |
| Expected stable conflicts | 19 booking losers | **UNMEASURED** |
| Unexpected outcomes | 0 | **UNMEASURED** |
| `http_req_duration` p50/p95/p99 | **TARGET NOT APPROVED** | **UNMEASURED** |
| DB appointments for contested booking slot | Exactly 1 | **UNMEASURED** |

### 4.2 IoT vital ingestion

| Metric | Target | Measured |
|---|---:|---:|
| Baseline request cadence | 100 three-reading batches/minute for 24 h | **UNMEASURED** |
| Baseline reading cadence | 300 readings/minute | **UNMEASURED** |
| 10× replay request cadence | 1,000 three-reading batches/minute for 1 h | **UNMEASURED** |
| 10× replay reading cadence | 3,000 readings/minute | **UNMEASURED** |
| Accepted + deduplicated + rejected | Equals submitted | **UNMEASURED** |
| Dropped accepted packets | 0 | **UNMEASURED** |
| Duplicate rows/alerts | 0 | **UNMEASURED** |
| Ingestion HTTP p50/p95/p99 | **TARGET NOT APPROVED** | **UNMEASURED** |
| Breach-to-alert / assigned-doctor latency | Must be measured; numeric target **NOT APPROVED** | **UNMEASURED** |
| CPU/RAM/disk IOPS/WAL/checkpoint/vacuum/outbox lag | Must be reported | **UNMEASURED** |

### 4.3 Pharmacy reservation contention

| Metric | Target | Measured |
|---|---:|---:|
| Contenders / available-stock fixture | Record exact fixture | **UNMEASURED** |
| Orders reaching `stock_reserved` | Fixture-defined `EXPECTED_RESERVED_SUCCESSES` | **UNMEASURED** |
| Stable reasoned shortfall/conflict outcomes | All non-winners; no 5xx | **UNMEASURED** |
| Unexpected outcomes | 0 | **UNMEASURED** |
| Posted quantity − active reservations | Never negative | **UNMEASURED** |
| HTTP p50/p95/p99 | **TARGET NOT APPROVED** | **UNMEASURED** |

### 4.4 Dispatch acceptance race

| Metric | Target | Measured |
|---|---:|---:|
| Sibling offers/driver contenders | Record exact fixture | **UNMEASURED** |
| Successful acceptances | Exactly 1 | **UNMEASURED** |
| Assignments for job | Exactly 1 | **UNMEASURED** |
| Losing outcomes | Stable 409; no 5xx | **UNMEASURED** |
| Unexpected outcomes | 0 | **UNMEASURED** |
| HTTP p50/p95/p99 | **TARGET NOT APPROVED** | **UNMEASURED** |

## 5. Resource and reliability observations

| Signal | Before | Peak | After | Collection source |
|---|---:|---:|---:|---|
| API CPU/RSS | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** |
| Worker CPU/RSS | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** |
| PostgreSQL CPU/RAM/connections | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** |
| Disk IOPS/latency/free bytes | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** |
| WAL bytes/rate/checkpoints | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** |
| Vacuum lag/dead tuples | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** |
| Outbox pending/oldest age | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** |
| Dead letters | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** | **UNMEASURED** |

## 6. Decision

- Overall result: **NOT RUN / NO GATE CLAIM**
- Passed requirements: **NONE MEASURED**
- Failed requirements: **NONE MEASURED**
- Targets awaiting approval: generic HTTP latency, bounded ingestion/alert lag, worker/outbox lag, provider-recovery time.
- Blockers: contention fixtures (authenticated sessions, seeded slots/orders/offers/devices); unapproved numeric thresholds; production-shaped environment for capacity claims absent.
- `fyp-core-ready` / `full-platform-ready`: **NOT CLAIMED**

The reviewer must sign the report only after matching each copied number to retained raw output and checking that expected domain conflicts were not misclassified as availability failures.
