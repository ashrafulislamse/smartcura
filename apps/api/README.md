# SmartCura Backend

NestJS 11 modular monolith plus a transactional-outbox worker, PostgreSQL 18,
Mosquitto MQTT ingestion, LiveKit token minting and a non-diagnostic AI
generation pipeline — **251** REST operations, **421** OpenAPI 3.1 schemas,
**9** AsyncAPI channels, **64** migrations over **73** tables, **368**
automated checks.

## Layout

```text
apps/api/
├── apps/api/        # the NestJS process — REST + Socket.IO feature modules
├── apps/worker/     # outbox worker — notifications, AI generation, scans
├── packages/
│   ├── contracts/   # OpenAPI 3.1 + AsyncAPI; generated TS and Dart clients
│   ├── database/    # Drizzle schema, migrations, repositories
│   ├── identity/    # Firebase identity verification
│   ├── policy/      # permission engine
│   ├── storage/     # object-storage adapters (R2 in production)
│   └── observability/
└── test/            # the 368-check suite
```

## Local development

```bash
cp .env.example .env            # placeholders only — no real secrets inside
docker compose up -d postgres   # pinned PostgreSQL 18 (server-side uuidv7())
npm ci
npm run db:migrate
npm run check                   # contracts + type-check + tests — no DB needed
npm run dev:api                 # terminal 1
npm run dev:worker              # terminal 2
```

`GET /api/v1/health` is process liveness. `GET /api/v1/ready` checks
PostgreSQL, schema compatibility and the worker heartbeat.

Every environment variable is documented in
[ENVIRONMENT.md](../../ENVIRONMENT.md) — what it is, where to get it and why
it exists.

## External services

- **Firebase** — identity (email/password, MFA) and FCM push. Firebase never
  owns roles or business data; the API is the authority.
- **Cloudflare R2** — private object storage; metadata and authorization live
  in PostgreSQL.
- **Fireworks AI (Kimi K3)** — LLM inference through the OpenAI-compatible
  adapter for non-diagnostic artifacts.
- **Cloudflare DNS** — domains and TLS.

Local development needs none of them: object storage falls back to a
deterministic adapter, identity accepts a local fixture token, and the AI
provider has a deterministic mock.

## Deployment

- **Coolify** — deploy [`docker-compose.prod.yaml`](docker-compose.prod.yaml)
  from the repository root (api, worker, portal, PostgreSQL, Redis, Mosquitto,
  LiveKit, ClamAV).
- **Standalone** — [`compose.prod.yaml`](compose.prod.yaml) is the same stack
  with Caddy for a server without Coolify's proxy.
- Full guide: [DEPLOYMENT.md](DEPLOYMENT.md).

## Documentation

| Document | Covers |
|---|---|
| [System architecture](../../docs/ARCHITECTURE.md) | Surfaces, topology, data, security |
| [Operational runbook](docs/operational-runbook.md) | Day-2 operations |
| [Threat model & data inventory](docs/threat-model-and-data-inventory.md) | Threats and data flows |
| [Policy matrix](docs/policy-matrix.md) | Role × permission matrix |
| [Backup & restore rehearsal](docs/backup-restore-rehearsal.md) | Restore drill |
| [Enum & state catalogue](docs/enum-state-catalogue.md) | Every enum and state machine |
| [Dependency audit](docs/dependency-audit.md) | Dependency decisions |
| [Vitals capacity plan](docs/vitals-capacity-plan.md) | IoT readings capacity |
| [Screen capability matrix](docs/screen-capability-matrix.md) | Portal screen ↔ capability map |
| [NFR measured-vs-target report](docs/nfr-measured-vs-target-report.md) | Targets vs measured reality |

## Reliability boundary

One VPS is a single point of failure for API, database and media — acceptable
for the current prototype, not for production clinical use. Anything beyond the
demo needs daily provider snapshots plus encrypted independent backups.

Synthetic data and prototype sensors only — see the medical disclaimer in the
[root README](../../README.md).
