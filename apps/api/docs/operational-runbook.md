# SmartCura backend operational runbook

**Evidence status (31 July 2026): Not yet executed - blocked on Docker/VPS.** This is an executable procedure, not evidence that a production deployment, incident response, provider-outage drill, rollback, or dead-letter replay has occurred. Docker is not installed on the current workstation. The repository also has no production Compose/deployment definition and no npm `stop`, backup, restore, or dead-letter replay script.

## 1. Scope and safety

This runbook covers the NestJS API, worker, PostgreSQL foundation, outbox/dead letters, and the OpenAI-compatible LLM, LiveKit, R2, and MQTT boundaries. SmartCura is an academic prototype, not a clinical-production system. During an incident:

- preserve patient safety outside this prototype; do not represent SmartCura as a clinical authority;
- never paste request bodies, tokens, cookies, object keys, vital values, clinical text, or provider secrets into tickets or chat;
- correlate with opaque IDs and stable error codes only;
- do not edit `outbox_events`, `dead_letter_events`, audit, ledger, or clinical rows manually;
- run outage drills only in an isolated staging environment using synthetic data and an approved maintenance window.

All `npm run ...` commands below name scripts that exist in the root `package.json`. Direct `docker compose`, HTTP, SQL, and PowerShell commands are identified as platform operations, not fictitious npm scripts.

## 2. Configuration and preflight

From the backend root in PowerShell:

```powershell
npm install
npm run check
```

Set configuration from `.env.example` through the deployment secret mechanism; do not commit a populated `.env`. At minimum the API and worker require `DATABASE_URL`. Production must not use the development identity, storage, video, payment, push, AI, scanner, CSRF, or encryption defaults.

When Docker exists, start the repository's only declared infrastructure service (platform operation backed by `compose.yaml`):

```powershell
docker compose up -d postgres
docker compose ps
npm run db:migrate
npm run db:probe
```

`db:probe` is a foundation transaction/rollback probe, not a general production health check. Do not repeatedly run it against production as a monitor.

## 3. Start and stop

### Development/watch mode

Open separate terminals after PostgreSQL is ready:

```powershell
npm run dev:worker
```

```powershell
npm run dev:api
```

Stop each foreground process with `Ctrl+C`. Watch mode is development-only.

### Built process mode

Build once, then start each composition root through an existing script:

```powershell
npm run build
$worker = Start-Process npm.cmd -ArgumentList 'run','start:worker' -PassThru -NoNewWindow
$api = Start-Process npm.cmd -ArgumentList 'run','start:api' -PassThru -NoNewWindow
$worker.Id
$api.Id
```

Record the PIDs in the deployment evidence. Stop accepting new traffic at the reverse proxy/load balancer before stopping the API. Stop the API, then the worker, and finally infrastructure only when the maintenance procedure requires it:

```powershell
Stop-Process -Id $api.Id
Stop-Process -Id $worker.Id
```

If PostgreSQL was started from the repository Compose file, stop it only after confirming no process is writing (platform operation):

```powershell
docker compose stop postgres
```

There is deliberately no `npm run stop`; do not document or invoke one. A real VPS deployment must add a supervised service/production Compose procedure before this runbook can become deployment evidence.

## 4. Health and readiness

The global API prefix is `/api/v1`.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
Invoke-RestMethod http://127.0.0.1:3000/api/v1/ready
```

Interpretation:

| Probe | Success | Meaning | Does not prove |
|---|---|---|---|
| `/health` | HTTP 200, `status=ok` | API process can answer | PostgreSQL, migrations, worker, or providers |
| `/ready` | HTTP 200, `status=ready`; `postgres`, `migrations`, and `worker` all ready | PostgreSQL connects, compatibility versions match, and a worker heartbeat is fresh | LLM provider, LiveKit, R2, MQTT, FCM, payment gateway, or clinical fitness |
| `/ready` | HTTP 503 `DEPENDENCY_UNAVAILABLE` | At least one required readiness condition failed | Public response intentionally does not identify a secret-bearing dependency |

The current readiness implementation treats external providers as optional to this probe. A green `/ready` during a provider outage is therefore possible and must not be reported as provider health.

## 5. Outbox and dead-letter inspection

Run read-only SQL through `psql`. The examples avoid `payload`, which may contain minimum-necessary domain fields and is not needed for first-line triage.

```powershell
docker compose exec postgres psql -U smartcura_dev -d smartcura_dev -c "SELECT status, count(*) FROM outbox_events GROUP BY status ORDER BY status;"
docker compose exec postgres psql -U smartcura_dev -d smartcura_dev -c "SELECT event_type, status, count(*) AS count, min(occurred_at) AS oldest FROM outbox_events WHERE status <> 'processed' GROUP BY event_type, status ORDER BY oldest;"
docker compose exec postgres psql -U smartcura_dev -d smartcura_dev -c "SELECT event_id, event_type, attempts, last_error_code, available_at, lease_expires_at, occurred_at FROM outbox_events WHERE status IN ('pending','processing','dead_letter') ORDER BY occurred_at LIMIT 100;"
docker compose exec postgres psql -U smartcura_dev -d smartcura_dev -c "SELECT d.dead_letter_id, d.event_id, o.event_type, d.error_code, d.attempts, d.failed_at, d.replayed_at FROM dead_letter_events d JOIN outbox_events o USING (event_id) ORDER BY d.failed_at DESC LIMIT 100;"
```

Triage rules:

1. `pending` with future `available_at` can be an ordinary retry; compare age with the worker poll interval and incident threshold.
2. `processing` with expired `lease_expires_at` should become claimable by the worker; repeated expiry indicates worker crashes or provider hangs.
3. Increasing `attempts` plus stable `last_error_code` indicates a persistent failure. Investigate the provider/handler without reading PHI-bearing payloads into logs.
4. `dead_letter` is terminal delivery state until an authorized replay capability exists.
5. The repository currently has **no authorized replay command or npm script**. Do not reset status or delete the dead-letter row in SQL. Record the event ID/error code and escalate a code change that preserves event identity, reason, audit, and attempt history.

## 6. Incident triage

1. **Declare and bound:** record UTC start time, environment/build version, reporter, affected capability, and whether safety-critical workflows must move outside SmartCura.
2. **Check process/readiness:** call `/health` and `/ready`; verify API and worker processes are running.
3. **Check PostgreSQL:** inspect Compose/service health, connection exhaustion, disk free space, and database logs without copying row values.
4. **Check async work:** use the aggregate outbox/dead-letter queries above. Record counts, oldest event age, and stable error codes—not payloads.
5. **Separate failure domain:** API/database, worker, provider, broker, storage, or client. A green readiness probe does not clear external providers.
6. **Contain:** disable the affected user action at the edge/client if retries can amplify load; do not switch production to deterministic/mock providers. Production guards intentionally forbid that.
7. **Recover:** restore the failed dependency or deploy a reviewed fix. Confirm backlog decreases and no duplicate domain state is created.
8. **Verify:** run `npm run check` on the candidate build, then targeted synthetic smoke tests in staging. Recheck health, readiness, outbox age, and dead-letter counts.
9. **Close:** record timeline, cause, exact build, evidence links, unresolved risk, and follow-up owner. Do not claim a drill or recovery that was not observed.

## 7. Provider-outage drill procedure

**Overall status: Not yet executed - blocked on Docker/VPS and incomplete production provider wiring.** Before each drill, take an approved backup, use synthetic fixtures, capture starting outbox/dead-letter counts, and define an abort condition. Do not run against a live demonstration without explicit approval.

| Provider | Isolation action in staging | Expected safe behavior to verify | Current blocker / important limitation |
|---|---|---|---|
| OpenAI-compatible LLM | Deny the worker's egress to the configured base URL or use a deliberately revoked staging credential; submit one synthetic AI turn; restore connectivity before retry exhaustion. | Provider call occurs after commit; generation remains queued/failed rather than fabricating output; no mock fallback; retries/dead-letter preserve event identity; existing clinical state is unchanged. | The worker now selects the configured LLM provider (`mock` or `openai`) from `SMARTCURA_AI_PROVIDER`. A real drill requires `SMARTCURA_AI_PROVIDER=openai` with a staging credential. |
| LiveKit | Stop/deny the staging LiveKit service, then attempt an authenticated synthetic video join; restore service and retry. | Appointment and consultation records remain authoritative; non-video API functions continue; client presents provider-unavailable/retry behavior; no participant outside the appointment receives access. | The API mints LiveKit-compatible JWTs locally and `/ready` does not contact LiveKit. Token issuance may succeed while joining fails, so the drill must observe an actual client/room join. No production LiveKit deployment exists here. |
| Cloudflare R2 | Revoke a staging-only R2 credential or deny R2 egress; attempt a synthetic upload/finalize/download and a worker-generated object; restore credential/connectivity. | No object is marked downloadable/ready unless bytes, size, type, and checksum are verified; failures do not expose credentials/object keys; retries do not create a second logical object. | No live R2 account/bucket evidence exists on this workstation. `/ready` does not probe R2. Use an alternate staging bucket/credential, never production objects. |
| MQTT/Mosquitto | Stop the staging broker or deny the bridge connection; have synthetic devices retain samples; restart broker and replay within the accepted window. | Bridge logs only classifications/counts, reconnects, and ingests buffered samples; QoS-1 replay is deduplicated; no payload patient ID is trusted; stale packets outside policy are rejected/quarantined. | `MqttBridge` exists, but the current worker module/config has no bridge registration or `SMARTCURA_MQTT_*` settings. A drill through `npm run start:worker` cannot yet exercise it. |

For every provider drill capture: UTC timestamps, build/config revision (never secret values), synthetic fixture IDs, pre/post outbox counts, HTTP/provider outcomes, recovery time, duplicate/constraint checks, and PHI-redaction review. Record the result as **failed**, **passed**, or **not executed**; never infer pass from source inspection.

## 8. Rollback and forward fix

1. Stop new traffic and stop API/worker as in Section 3.
2. Preserve logs and read-only outbox/dead-letter summaries.
3. If only application code changed and the previous build is schema-compatible, deploy that immutable build, run `npm run start:worker` and `npm run start:api`, and verify `/health` and `/ready`.
4. If a migration changed the schema, do **not** invent a down migration. The implementation plan makes migrations immutable and assumes forward fixes. Deploy a reviewed forward-fix migration with `npm run db:migrate` and verify using `npm run check` before promotion.
5. If corruption/data loss is suspected, keep the affected environment stopped and follow `docs/backup-restore-rehearsal.md` into an isolated database/bucket first. Never restore directly over production as the first test.
6. If the previous build reports `/ready` 503 because compatibility versions differ, stop and choose a compatible build or forward fix; bypassing readiness is forbidden.

**Rollback evidence required:** incident/change ID, old/new build versions, schema compatibility versions, commands run, health/readiness responses, outbox/dead-letter before and after, synthetic smoke result, and explicit unresolved risks.
