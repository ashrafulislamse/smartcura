# Vitals Capacity and Retention Decision

**Status:** Stage 0A capacity decision approved for contract and migration design
**Version:** 1.1
**Date:** 26 July 2026
**Scope:** FYP scalar telemetry capacity on a provider-neutral single-VPS envelope

Provider selection is deferred to `WP-02D`. DigitalOcean `SGP1` 8-vCPU/16-GiB/320-GiB remains a dated provisional comparison candidate only; capacity conclusions apply to the stated resources and measured gates, not to that vendor.

## 1. Decision summary

**Decision: GO, with a bounded FYP envelope.** Design and test for **100 continuously active patients**, each producing the three required scalar metrics once per minute. The expected demonstration load is up to 20 continuously active patients; 100 is the committed engineering envelope. A 250-patient case is a planning boundary, not an approved capacity, and 1,000 continuously active patients requires a different storage plan.

Selected policies:

- Required final-demo capacity: 8 vCPU, 16 GiB RAM and at least 240 GiB local SSD/NVMe. A DigitalOcean `SGP1` 8-vCPU/16-GiB/320-GiB plan is a provisional comparison candidate and must not be read as selected; any chosen plan must pass measured IOPS/WAL/latency gates.
- Scalar raw readings: one metric per row, monthly UTC PostgreSQL partitions, 12-month retention.
- Hourly aggregates: 3 years; daily aggregates: 7 years.
- MQTT deduplication: `(device_id, boot_id, sequence_no, metric)` for a 30-day accepted replay window.
- Optional ECG: short waveform packets in object storage plus scalar summaries in PostgreSQL; continuous ECG samples never become `vital_readings` scalar rows.
- Capacity approval applies to the FYP/prototype only. It is not a production clinical-system sizing claim.

At the selected 100-patient envelope, the model reserves **74.75 GiB for PostgreSQL**, including retained data, 35% database headroom, and 16 GiB of live WAL capacity. Reserving another 20 GiB for the VPS OS, containers, logs and monitoring gives 94.75 GiB total. Runtime object bytes are stored in Cloudflare R2 and are not part of local VPS disk capacity; the 240 GiB minimum preserves safer database maintenance and restore headroom.

## 2. Workload assumptions

1. Required scalar metrics are `heart_rate`, `oxygen_saturation`, and `body_temperature`.
2. Every active patient emits all three metrics every minute, continuously, with no downtime or missing readings. This deliberately models the storage upper bound for the stated cadence.
3. A planning year is 365 days. Leap-year totals are stated separately.
4. PostgreSQL uses binary UUIDs, `timestamptz`, compact enum codes, `double precision` measurement values, and ordinary 8 KiB pages. Values are not stored as JSON.
5. GiB means `2^30` bytes. Counts are exact; byte sizes are planning estimates to be replaced by measured `pg_total_relation_size` evidence.
6. Raw retention is 12 calendar months. Monthly partition dropping means the effective oldest-row age can approach 13 months immediately before a partition is dropped; the one-year tables model exactly 365 days.
7. Video is not recorded on the VPS. FYP object uploads, including bounded ECG waveform packets, are stored in the selected private Cloudflare R2 bucket and governed by separate request, lifecycle and backup controls.
8. Nightly database backups and required R2 object/manifest exports are encrypted and copied to the independent backup destination. A full backup is not counted as a second local database copy.
## 3. Exact row-count formulas

For `P` continuously active patients and `M = 3` scalar metrics:

```text
rows/minute = P × M
rows/hour   = P × M × 60
rows/day    = P × M × 60 × 24
rows/month  = P × M × 60 × 24 × days_in_month
rows/year   = P × M × 60 × 24 × 365
```

One patient therefore produces exactly 180 rows/hour, 4,320 rows/day, and 1,576,800 rows/non-leap-year.

### 3.1 Hourly, daily, and annual raw rows

| Continuously active patients | Rows/minute | Rows/hour | Rows/day | Rows/365-day year |
|---:|---:|---:|---:|---:|
| 20 | 60 | 3,600 | 86,400 | 31,536,000 |
| 100 | 300 | 18,000 | 432,000 | 157,680,000 |
| 250 | 750 | 45,000 | 1,080,000 | 394,200,000 |
| 1,000 | 3,000 | 180,000 | 4,320,000 | 1,576,800,000 |

### 3.2 Exact monthly raw rows by calendar-month length

This table is exact for any month once its day count is known. In a non-leap year, February uses 28 days; January, March, May, July, August, October, and December use 31 days; the remaining months use 30 days.

| Patients | 28-day February | 29-day February | 30-day month | 31-day month |
|---:|---:|---:|---:|---:|
| 20 | 2,419,200 | 2,505,600 | 2,592,000 | 2,678,400 |
| 100 | 12,096,000 | 12,528,000 | 12,960,000 | 13,392,000 |
| 250 | 30,240,000 | 31,320,000 | 32,400,000 | 33,480,000 |
| 1,000 | 120,960,000 | 125,280,000 | 129,600,000 | 133,920,000 |

A leap year adds exactly one daily count. Leap-year totals are 31,622,400; 158,112,000; 395,280,000; and 1,581,120,000 rows for 20, 100, 250, and 1,000 patients respectively.

## 4. Storage model

### 4.1 Per-row assumptions

| Component | Planning bytes per scalar reading | Included fields/overhead |
|---|---:|---|
| Raw heap | 160 B | tuple/page overhead; reading, organization/patient/device IDs; metric/value/unit/quality/source; recorded/received times; boot and sequence metadata |
| Raw indexes | 112 B | partition-local primary identity/time B-tree and patient/metric/time B-tree; BRIN time index is treated as negligible at this scale |
| Raw subtotal | 272 B | heap plus indexes |
| 30-day dedupe ledger | 168 B | 96 B heap plus 72 B unique-key/expiry indexes per accepted metric reading |
| Aggregate row | 192 B | heap and indexes for bucket, count, min/max/average, quality counts, and provenance timestamps |

The estimate intentionally includes two raw B-tree indexes but not speculative indexes. A migration review must update the model if wider text/`numeric` columns, additional UUIDs, or more indexes are introduced.

WAL is modeled as write traffic, not a year-long resident copy:

```text
annual WAL estimate
  = annual readings × (272 B raw + 168 B dedupe) × 1.35
  = annual readings × 594 B
```

The 1.35 factor covers ordinary WAL amplification and aggregate maintenance at planning accuracy. Full-page images, checkpoint settings, bulk replay, and index build behavior can increase it. The VPS reserves 16 GiB for live WAL and replication/archive backlog; WAL is recycled after successful checkpoint/archive handling.
### 4.2 Retained storage and WAL traffic

Aggregate sizing applies the selected 3-year hourly and 7-year daily retention from Section 6. A patient produces 26,280 hourly aggregate rows/year and 1,095 daily aggregate rows/year across three metrics.

| Patients | Raw heap, 1 year | Raw indexes, 1 year | Dedupe, 30 days | Retained aggregates | Retained DB subtotal | 35% DB headroom | WAL generated/year | DB disk budget including 16 GiB live WAL |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20 | 4.70 GiB | 3.29 GiB | 0.41 GiB | 0.31 GiB | 8.70 GiB | 3.05 GiB | 17.45 GiB | 27.75 GiB |
| 100 | 23.50 GiB | 16.45 GiB | 2.03 GiB | 1.55 GiB | 43.52 GiB | 15.23 GiB | 87.23 GiB | 74.75 GiB |
| 250 | 58.74 GiB | 41.12 GiB | 5.07 GiB | 3.87 GiB | 108.80 GiB | 38.08 GiB | 218.07 GiB | 162.87 GiB |
| 1,000 | 234.96 GiB | 164.47 GiB | 20.28 GiB | 15.47 GiB | 435.18 GiB | 152.31 GiB | 872.29 GiB | 603.49 GiB |

The 35% headroom covers dead tuples, vacuum lag, partition/index maintenance, temporary query space, and estimation error. It is capacity, not expected steady-state consumption. Annual WAL is throughput sent to recycling/archive; only the 16 GiB live-WAL reserve is included in local disk budget.

### 4.3 Whole-VPS fit

Reserve a fixed 20 GiB outside PostgreSQL for Ubuntu, container images, runtime logs and monitoring. Runtime application objects are stored in Cloudflare R2 and therefore do not consume VPS disk. Keep encrypted PostgreSQL backups and required R2 object/manifest exports at the independent backup destination.

| Patients | PostgreSQL budget | Plus 20 GiB VPS reserve | Fits 160 GiB? | Fits 240 GiB? | Decision |
|---:|---:|---:|---|---|---|
| 20 | 27.75 GiB | 47.75 GiB | Yes | Yes | Expected demo load |
| 100 | 74.75 GiB | 94.75 GiB | Yes; 65.25 GiB remains | Yes; 145.25 GiB remains | Selected FYP envelope |
| 250 | 162.87 GiB | 182.87 GiB | No | Disk fits, but not approved without measured IOPS/WAL/latency evidence | Planning boundary |
| 1,000 | 603.49 GiB | 623.49 GiB | No | No | Split/expand database storage or shorten raw retention |

CPU ingestion is modest at the selected envelope: 300 rows/minute, or 5 rows/second on average. The main limits are database disk durability, vacuum behavior, reconnect bursts and LiveKit resource contention rather than average insert CPU or runtime object storage. The 8-vCPU/16-GB server therefore fits the 100-patient FYP envelope, but the at-least-240-GB requirement preserves safer database headroom and PostgreSQL must have explicit container memory/IO limits so LiveKit cannot starve it.

## 5. PostgreSQL physical design

### 5.1 Raw scalar table

- Partition `vital_readings` by `RANGE (recorded_at)` in UTC calendar months, with half-open bounds `[month_start, next_month_start)`.
- Pre-create the current partition and the next two monthly partitions. Missing-partition ingestion is an alertable failure; do not use an unbounded default partition as normal operation.
- Keep 12 complete calendar months plus the current partial month. Detach and then drop a partition only after aggregate completion, backup success, and the retention cutoff are verified.
- Use partition-local constraints for valid metric/unit combinations and required assignment/provenance fields.
- Use a partition-compatible primary key `(recorded_at, reading_id)`. UUIDv7 remains the reading identifier, while callers that address a reading also carry its recorded time or use a bounded patient/time query.
- Add one B-tree query index on `(patient_id, metric, recorded_at DESC)` including the value, unit, and quality fields required by chart reads.
- Add one small BRIN index on `recorded_at` for broad retention/administrative scans.
- Do not index `quality`, `source`, or `received_at` alone without measured query evidence. Every extra per-reading B-tree requires a capacity-plan revision.

The patient/metric/time key supports the primary chart and aggregate scans while monthly bounds guarantee partition pruning. Device diagnostics use bounded time predicates; the separate dedupe ledger handles uniqueness rather than forcing another large raw-table index.
### 5.2 Aggregate tables

- `vital_hourly_aggregates`: one row per `(patient_id, metric, bucket_start)`, with count, valid/suspect/invalid counts, min, max, average, and first/last recorded times. Use yearly range partitions on `bucket_start` and a patient/metric/time B-tree.
- `vital_daily_aggregates`: the equivalent UTC-day row and key. Keep it unpartitioned at the selected envelope; revisit partitioning only after measured size or policy requires it.
- Build a closed hourly bucket idempotently with `INSERT ... ON CONFLICT ... DO UPDATE`; build a day only from completed hourly buckets. Record source-row count and aggregation version so results can be reconciled and rebuilt.
- Alerts evaluate validated raw readings during ingestion. Aggregates support charts and reporting; they do not delay alert decisions.
- Retention workers must not drop raw partitions until all expected aggregate buckets are complete or an explicit exception is recorded.

### 5.3 Thirty-day packet deduplication

Use a dedicated dedupe ledger because PostgreSQL cannot enforce a global unique key that omits the monthly partition key across all raw partitions.

1. Claim `(device_id, boot_id, sequence_no, metric)` in the same database transaction that inserts the scalar reading.
2. A conflict returns the original accepted outcome and inserts no second reading or alert.
3. Keep the claim for 30 days from `first_received_at`; purge expired claims in bounded daily batches.
4. Accept offline replay only when its authenticated packet is inside the 30-day replay policy. Older packets are rejected or quarantined for diagnostics, not inserted after their dedupe claim expires.
5. Device identity comes from the broker credential/topic, assignment is resolved at `recorded_at`, and a payload patient ID is ignored.

Thirty-day retained dedupe rows equal `patients × 3 × 60 × 24 × 30`: 2,592,000; 12,960,000; 32,400,000; and 129,600,000 rows for the four scenarios. The explicit old-packet rejection closes the otherwise unavoidable hole where a replay after claim expiry could create a duplicate.

## 6. Retention decision

| Data class | Selected retention | Deletion mechanism | Rationale |
|---|---|---|---|
| Raw scalar readings | 12 calendar months | Verify aggregates/backup, detach monthly partition, then drop | Meets the existing prototype baseline and preserves a full year for FYP analysis |
| Packet dedupe claims | 30 days | Bounded daily expiry deletion and vacuum | Covers QoS 1 retries and FYP offline replay without retaining a second annual keyset |
| Hourly aggregates | 3 years | Drop expired yearly partition | Supports medium-term trend charts at low cost |
| Daily aggregates | 7 years | Bounded delete/archive workflow | Supports longitudinal prototype reporting; legal/policy review is required before real deployment |
| ECG waveform objects | 30 days by default | Object lifecycle rule after summary/provenance verification | High-frequency diagnostic data is optional and disproportionately large |
| ECG scalar summaries | Same as scalar raw/aggregates | Normal scalar partition/aggregate retention | Keeps heart-rate/quality and waveform-derived features queryable without sample explosion |

These are prototype defaults, not a Malaysian healthcare retention determination. Before real patient use, legal/privacy review must approve or replace each period, and deletion must account for holds, exports, and clinical-record policy.

## 7. Optional high-frequency ECG

Continuous AD8232 samples must **not** be inserted one sample per `vital_readings` row. At only 250 Hz, one patient would produce 21,600,000 samples/day and 7,884,000,000 samples/year—five times the entire 1,000-patient scalar scenario for that patient alone.

Selected ECG path:

1. The device batches a short, bounded waveform segment with sample rate, channel, start time, sample count, calibration, and checksum.
2. The backend validates authorization, assignment, bounds, checksum, and format, then stores compressed binary waveform data as a private opaque-key Cloudflare R2 object.
3. PostgreSQL stores only segment metadata/provenance and scalar summaries such as heart rate, signal quality, lead-off status, min/max/RMS voltage, and optional reviewed features.
4. A clinician retrieves a segment through a short-lived authorized URL. Waveforms are never pushed through ordinary scalar chart endpoints or FCM.
5. Default capture is event-triggered or explicitly requested and time-bounded; continuous recording is disabled for the FYP envelope. Enabling it requires a separate bandwidth, object-storage, consent, and retention decision.

## 8. Risks and controls

| Risk | Consequence | Control/trigger |
|---|---|---|
| Actual tuple/index size exceeds the 272 B raw estimate | Disk fills earlier than modeled | Measure every partition with PostgreSQL relation-size functions; revisit the gate if raw heap plus indexes exceeds 340 B/reading |
| Index or dedupe bloat and vacuum lag | Write latency and disk growth | Per-partition autovacuum tuning, bounded expiry batches, bloat/age alerts, and 35% headroom |
| Reconnects create bursts despite low average rate | WAL/checkpoint and alert lag | Batch ingestion, backpressure, 16 GiB WAL reserve, and a 10× replay-burst load test |
| A packet arrives after the dedupe window | Duplicate risk if accepted | Reject/quarantine packets outside the 30-day accepted replay window |
| Device clock or assignment history is wrong | Reading linked to the wrong time/patient | Bound clock skew, retain `received_at`, resolve assignment server-side, and quarantine impossible times |
| Aggregate job is incomplete before partition expiry | Irrecoverable chart gaps | Reconciliation counts and backup/aggregate completion gate before detach/drop |
| LiveKit and PostgreSQL contend on one VPS | Query latency or outage | Resource limits, no video recording, database disk/IO monitoring and at least 240 GiB local disk; R2 object bytes are outside this contention domain |
| Local snapshot is mistaken for an independent backup | VPS loss destroys all copies | Encrypted off-site PostgreSQL and object backups plus restore rehearsal |
| 250/1,000-patient demand is treated as already approved | Unsafe overcommit | Capacity change requires measured load evidence, new storage budget, and likely managed/separate PostgreSQL |
| Prototype retention is treated as legal policy | Privacy or compliance failure | Mandatory policy/legal review before real deployment |
## 9. Capacity verification gate

The Stage 0A capacity decision is **approved for contract and migration design** under the 100-patient envelope. Stage 5 must still produce measured evidence before the VPS is declared implementation-ready for that envelope.

Required pass evidence:

- sustain the 100-patient cadence for 24 hours while API, worker, MQTT, monitoring, and a representative LiveKit call run on the target VPS;
- inject a 10× one-hour reconnect replay and show bounded ingestion/alert lag with no dropped accepted packet;
- replay duplicates inside the 30-day window and show zero duplicate readings and zero duplicate alerts;
- demonstrate partition pruning for patient/metric/time chart queries and record p50/p95/p99 latency;
- measure heap, every index, dedupe ledger, WAL rate, checkpoint pressure, vacuum lag, CPU, RAM, disk IOPS, and free disk;
- prove aggregate/reconciliation completion, partition detach/drop, off-site backup, and restore on representative data;
- keep measured raw heap plus index size at or below 340 B/reading and projected whole-VPS use below 80% of provisioned disk.

If either size/disk threshold fails, the gate returns to **NO-GO** until schema/index changes, shorter retention, more storage, or a separate database is approved. The 250- and 1,000-patient scenarios are explicitly outside this gate.

## 10. Final gate record

| Item | Decision |
|---|---|
| FYP expected load | Up to 20 continuously active patients |
| FYP design/test envelope | 100 continuously active patients at three scalar readings/minute each |
| Required VPS fit | The 8-vCPU/16-GiB/at-least-240-GiB envelope exceeds modeled storage headroom; provider selection is deferred and implementation readiness still requires the Stage 5 IOPS/WAL/latency gate |
| 250 continuously active patients | Not approved on the shared single-VPS envelope |
| 1,000 continuously active patients | Does not fit; redesign required |
| Raw/hourly/daily retention | 12 months / 3 years / 7 years |
| Dedupe window | 30 days with older replay rejected/quarantined |
| ECG | Object waveform segments plus scalar summaries; no continuous scalar sample rows |
| Stage 0A outcome | **GO for contracts and migration design; implementation capacity remains subject to the measured Stage 5 gate** |
