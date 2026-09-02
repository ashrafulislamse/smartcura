# SmartCura Backend Deployment Guide

This guide explains how to deploy the SmartCura backend on a VPS with `smartcura.app` as the main domain. It covers both the **Coolify demo** path (`docker-compose.yaml`) and the **standalone production** path (`compose.prod.yaml` + Caddy), and summarizes every environment variable in `.env.example`. For a complete, standalone reference to every variable, where to get it, and why it is needed, see `../ENVIRONMENT.md`.

> **Important current limitation.** The backend can select real providers in `NODE_ENV=production`, but the real adapters for **payment gateway** and **FCM** are not implemented yet. The AI provider is implemented as **OpenAI-compatible** (`openai`). A production deployment that sets `SMARTCURA_AI_PROVIDER=gemini` will crash. For a **first working deploy**, use deterministic/mock providers for payment/push (`NODE_ENV=development`) and the `docker-compose.yaml` stack. `compose.prod.yaml` uses a real OpenAI-compatible AI key while keeping payment/push deterministic for the FYP demo.

---

## 1. Domain and DNS

Create DNS records for the subdomains you will use and point them all to the VPS IP:

| Subdomain | Service | Required now? |
|---|---|---|
| `api.smartcura.app` | NestJS REST API and Socket.IO | **Yes** |
| `portal.smartcura.app` | Next.js web portal | **Yes** |
| `livekit.smartcura.app` | LiveKit video signalling | No — only when video is enabled |
| `mqtt.smartcura.app` | Mosquitto MQTT over TLS | No — only when IoT devices connect over the public internet |

You can use `app.smartcura.app` instead of `portal.smartcura.app` if you prefer. Whatever you choose, keep the value consistent in the `.env` files, Caddyfile, and portal env vars.

---

## 2. Deployment paths

### 2.1 Coolify deployment

- Uses `apps/api/docker-compose.prod.yaml` (Coolify serves `/apps/api` as the build
  directory and points at the `docker-compose.prod.yaml` file inside it).
- Coolify provides its own reverse proxy and TLS, so the Caddyfile is not used.
- Easiest first path: push the repo, set the compose path in the Coolify UI, and fill in the environment variables.
- Keep deterministic/mock providers so the app boots without Firebase, R2, LiveKit, etc.

### 2.2 Standalone production

- Uses `apps/api/compose.prod.yaml` + `deploy/caddy/Caddyfile` + `deploy.sh`.
- You manage TLS, routing, and the full stack yourself.
- Requires real providers (Firebase, R2, LiveKit, ClamAV) and the real adapters to be implemented.

Both paths share the same `.env` file at `apps/api/.env`.

> **Coolify v4 API endpoint.** If you trigger deploys through the Coolify API rather than
> the dashboard button, use `POST /api/v1/deploy?uuid={uuid}&force=true` on v4.1.2 — the
> v3-style `POST /api/v1/applications/{uuid}/deploy` returns `404 {"message":"Not found."}`
> and does not deploy. `force=true` is required when only the env file changed; without it
> v4 leaves the existing containers in place and the new env never takes effect. The helper
> `tools/deploy/coolify.mjs` uses the v4 endpoint.

### 2.3 MQTT broker and per-device credentials

The production compose stack ships a Mosquitto broker. The bridge service account
(`smartcura-bridge`) and one entry per provisioned device live in
`deploy/mosquitto/auth/passwd`, and the ACL in `deploy/mosquitto/auth/acl` uses a `%u`
pattern so each device can publish only to its own vitals topic.

Provisioning flow:

1. Start the stack with the `mosquitto` service.
2. Run `deploy/mosquitto/setup-mqtt-auth.sh init` with a strong bridge password. This
   creates `passwd` with the `smartcura-bridge` account and bakes the ACL at `0700`.
3. Set `SMARTCURA_MQTT_PASSWORD` to the same value in the worker env (see §3.9).
4. Register a device via `POST /organizations/{org}/devices` and save the
   `provisioning_secret` it returns.
5. Assign the device to a patient via `POST /organizations/{org}/devices/{id}/assignments`.
6. Run `deploy/mosquitto/setup-mqtt-auth.sh add-device <device-uuid> <provisioning-secret>`
   on the VPS to add the device to `passwd`. The script auto-detects the running mosquitto
   container name (Coolify's container naming changes between deploys, so it is not
   hardcoded), strips CRLF defensively, and errors clearly when no mosquitto is running.
7. Flash the ESP32 with the device UUID and provisioning secret. The firmware
   `iot-firmware/smartcura_vitals_monitor` already sends
   `Sec-WebSocket-Protocol: mqtt` on the WebSocket upgrade (the broker silently drops connections that negotiate any other subprotocol).

**Named volume, not bind mount, not anonymous volume.** `docker-compose.prod.yaml`
declares `mosquitto_config:/mosquitto/config/auth` so the password file survives every
redeploy. The Dockerfile bakes the ACL at `0700` and the entrypoint re-applies the mode on
boot. An anonymous volume here would be removed on the next `docker compose down`; a bind
mount to the host would not pick up the entrypoint's mode re-apply under all Coolify
versions. A handy symptom when the volume is missing: the script reports success, the
device publishes a CONNACK once, the next deploy silently breaks, and the broker log shows
the device id never re-authenticating.

---

## 3. Environment variables reference

### 3.1 Core runtime

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `NODE_ENV` | `development` or `production` | Your choice. | Controls provider validation. `production` refuses mock adapters, local identity, and default secrets. |
| `SMARTCURA_BUILD_VERSION` | `0.1.0` | Any string you want. | Logged on startup and returned by `/health` so you can tell which build is running. |

### 3.2 Database

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `POSTGRES_PASSWORD` | `long-random-password` | Generate it yourself. | Password used by the Docker PostgreSQL container **and** the backend connection string. |
| `DATABASE_URL` | `postgresql://smartcura_dev:...` | For local dev only. | Full connection string used when running the API/worker directly on your laptop (not in Docker). |
| `DATABASE_READINESS_TIMEOUT_MS` | `2000` | Default is fine. | How long the API/worker waits for PostgreSQL to be reachable before giving up on startup. |
| `SMARTCURA_POSTGRES_PASSWORD` | `change-this-local-password` | For local dev only. | Password used by `apps/api/compose.yaml` (the local dev stack). |

### 3.3 API

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `SMARTCURA_API_HOST` | `0.0.0.0` (Docker) or `127.0.0.1` (local) | Docker or local. | The network interface the NestJS API listens on. `0.0.0.0` is required inside a container so traffic can reach it. |
| `SMARTCURA_API_PORT` | `3000` | Default. | Port the API listens on inside the container. |
| `SMARTCURA_API_WORKER_MAX_AGE_MS` | `15000` | Default. | The `/ready` check reports the worker as stale if it has not claimed an outbox job within this window. |
| `SMARTCURA_API_ALLOWED_ORIGINS` | `https://portal.smartcura.app,https://app.smartcura.app` | Your domains. | CORS allowed origins. The API rejects any origin not in this exact list. Wildcards are forbidden. |
| `SMARTCURA_SESSION_CSRF_SECRET` | `32-char-min-random-string` | Generate it. | Signs CSRF tokens for state-changing routes. Production refuses the default value. |

### 3.4 Identity

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `SMARTCURA_IDENTITY_ADAPTER` | `local` (demo) or `firebase` (production) | Your choice. | Selects whether the backend verifies Firebase ID tokens or uses local fixture tokens. |
| `SMARTCURA_FIREBASE_PROJECT_ID` | `smartcura-prod` | Firebase console → Project Settings. | The project ID used to verify Firebase ID tokens against Google's public keys. Required when adapter is `firebase`. |
| `SMARTCURA_LOCAL_IDENTITY_TOKEN` | `local-fixture-token-...` | For local dev only. | Fixture bearer token used by the local identity adapter. |
| `SMARTCURA_LOCAL_IDENTITY_UID` | `local-fixture-user` | For local dev only. | Fixture Firebase UID. |
| `SMARTCURA_LOCAL_IDENTITY_EMAIL` | `local.user@smartcura.invalid` | For local dev only. | Fixture email address. |
| `SMARTCURA_LOCAL_IDENTITY_EMAIL_VERIFIED` | `true` | For local dev only. | Whether the fixture email is treated as verified. |
| `SMARTCURA_LOCAL_IDENTITY_MFA` | `true` | For local dev only. | Whether the fixture identity is treated as MFA-satisfied. |
| `SMARTCURA_LOCAL_IDENTITY_SECONDARY_TOKEN` / `UID` / `EMAIL` | ... | For local dev only. | A second fixture identity so the local adapter can test two-party rules (break-glass, independent review). |

**Why Firebase is needed.** The project verifies Firebase ID tokens directly against Google's published X.509 signing keys instead of using the Firebase Admin SDK. You only need the Firebase **project ID**; no service-account key is required for token verification. You do need Identity Platform enabled if you want TOTP MFA and password policy enforcement.

### 3.5 Video (LiveKit)

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `SMARTCURA_VIDEO_ADAPTER` | `deterministic` (demo) or `livekit` (production) | Your choice. | Selects whether video tokens are fake or real. |
| `SMARTCURA_LIVEKIT_URL` | `wss://livekit.smartcura.app` | Your LiveKit server or LiveKit Cloud. | WebSocket URL the client connects to. |
| `SMARTCURA_LIVEKIT_API_KEY` | `API_KEY` | LiveKit server config or Cloud dashboard. | Used to mint room tokens on the backend. |
| `SMARTCURA_LIVEKIT_API_SECRET` | `long-secret` | LiveKit server config or Cloud dashboard. | Signs the room tokens. |
| `SMARTCURA_LIVEKIT_TOKEN_TTL_SECONDS` | `300` | Default. | How long a generated room token is valid. |

### 3.6 Push notifications

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY` | `64-char-hex` | `openssl rand -hex 32` | AES-256 key used to encrypt FCM registration tokens before storing them in PostgreSQL. |
| `SMARTCURA_PUSH_PROVIDER` | `deterministic` (demo) or `fcm` (production) | Your choice. | Selects whether push notifications are faked or sent via FCM. |

**FCM note.** The backend can select `fcm`, but a real FCM adapter that reads service-account credentials and sends messages via the FCM HTTP v1 API is not implemented yet. Until it is, use `deterministic` for any working deployment.

### 3.7 Object storage (Cloudflare R2)

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `SMARTCURA_OBJECT_STORAGE_PROVIDER` | `memory` (demo) or `r2` (production) | Your choice. | Selects whether uploaded files are stored in memory or in R2. |
| `SMARTCURA_R2_ACCOUNT_ID` | `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Cloudflare dashboard, right-hand sidebar. | Identifies your Cloudflare account. |
| `SMARTCURA_R2_BUCKET` | `smartcura-files` | Cloudflare R2 → Create bucket. | The bucket name where private files are stored. |
| `SMARTCURA_R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | Cloudflare R2 docs. | S3-compatible endpoint URL. The backend validates the hostname ends with `.r2.cloudflarestorage.com`. |
| `SMARTCURA_R2_ACCESS_KEY_ID` | `...` | R2 → Manage API tokens → Create token. | Access key ID for the S3-compatible API. |
| `SMARTCURA_R2_SECRET_ACCESS_KEY` | `...` | Same token creation page. | Secret access key for the S3-compatible API. |

**Why R2 is needed.** Files (verification documents, prescription PDFs, delivery proof, etc.) must be stored outside the VPS. The backend uses a provider-neutral S3 interface, but the project selected Cloudflare R2 as the concrete object store.

### 3.8 Worker

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `SMARTCURA_WORKER_POLL_INTERVAL_MS` | `5000` | Default. | How often the worker polls the outbox for new jobs. |
| `SMARTCURA_WORKER_LEASE_MS` | `30000` | Default. | How long a worker lease on an outbox job lasts. |
| `SMARTCURA_WORKER_BATCH_SIZE` | `10` | Default. | How many outbox jobs the worker claims per poll. |
| `SMARTCURA_WORKER_MAX_ATTEMPTS` | `10` | Default. | Max retry attempts before an outbox job becomes a dead letter. |
| `SMARTCURA_MALWARE_SCANNER` | `deterministic` (demo) or `clamav` (production) | Your choice. | Selects whether file scanning is faked or uses ClamAV. |
| `SMARTCURA_CLAMAV_HOST` | `clamav` (Docker) or `127.0.0.1` (local) | Service name/address. | Hostname of the ClamAV daemon. |
| `SMARTCURA_CLAMAV_PORT` | `3310` | Default. | Port the ClamAV daemon listens on. |
| `SMARTCURA_CLAMAV_TIMEOUT_MS` | `15000` | Default. | Max time to wait for a ClamAV scan. |
| `SMARTCURA_PAYMENT_PROVIDER` | `deterministic` (demo) or `gateway` (production) | Your choice. | Selects whether payments are simulated or sent to a real gateway. |
| `SMARTCURA_PUSH_PROVIDER` | `deterministic` (demo) or `fcm` (production) | Your choice. | See Push notifications section above. |
| `SMARTCURA_AI_PROVIDER` | `mock` (demo) or `openai` (production) | Your choice. | Selects the LLM provider. `openai` uses any OpenAI-compatible `/chat/completions` endpoint. |

### 3.9 Standalone production routing (Caddy)

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `DOMAIN` | `smartcura.app` | Your registrar. | Caddy uses this to request TLS certificates for `api.smartcura.app`, `portal.smartcura.app`, etc. |
| `ACME_EMAIL` | `admin@smartcura.app` | Your email. | Let's Encrypt account email for certificate expiry notices. |

### 3.10 Portal (Next.js)

These are set in `apps/web-portal/.env`, not the backend `.env`. The portal uses a **relative** `/api/v1` path by default, and Next.js rewrites it to the backend origin. This keeps the `__Host-smartcura_session` cookie same-origin.

| Variable | Example | Where to get it | Why it is needed |
|---|---|---|---|
| `SMARTCURA_API_ORIGIN` | `https://api.smartcura.app` | Your backend subdomain. | Target of the Next.js rewrite rule for `/api/v1/*`. |
| `NEXT_PUBLIC_APP_URL` | `https://portal.smartcura.app` | Your portal subdomain. | Public app URL for metadata, emails, redirects. |
| `NEXT_PUBLIC_API_URL` | `https://api.smartcura.app` | Your backend subdomain. | Optional fallback if the client ever needs a direct API URL. |

---

## 4. How to set up each external provider

### 4.1 Firebase (Identity + FCM)

1. Go to https://console.firebase.google.com and create a project.
2. In the project settings, copy the **Project ID**.
3. Enable **Authentication** → **Email/Password**.
4. Upgrade to **Identity Platform** if you want TOTP MFA and password policy.
5. Under **Authentication** → **Settings** → **Authorized domains**, add `portal.smartcura.app` and `app.smartcura.app`.
6. For FCM later: enable **Cloud Messaging** and create a service account for the server. The backend does not yet read FCM credentials from an env var, so this is preparation.

### 4.2 Cloudflare R2

1. In the Cloudflare dashboard, open **R2** and create a bucket, e.g. `smartcura-files`.
2. Go to **R2** → **Manage API tokens** → **Create API token**.
3. Give it **Edit** permission on the bucket you created.
4. Copy the **Access Key ID** and **Secret Access Key**.
5. Copy your **Account ID** from the right-hand sidebar of the Cloudflare dashboard.
6. Endpoint: `https://<account-id>.r2.cloudflarestorage.com`.

### 4.3 LiveKit

**Option A — self-hosted**

1. Deploy a LiveKit server on the same VPS or another server.
2. In the LiveKit config, note the API key and secret.
3. Set `SMARTCURA_LIVEKIT_URL=wss://livekit.smartcura.app` and point the DNS record to the LiveKit server.

**Option B — LiveKit Cloud**

1. Create a project at https://livekit.io.
2. Copy the API key, secret, and server URL from the project dashboard.

### 4.4 ClamAV

ClamAV is included as a container in `compose.prod.yaml`. On first boot it downloads the virus signature database, which can take 1–2 minutes. The `compose.prod.yaml` health check waits up to 120 seconds before the worker is allowed to start.

---

## 5. First working deployment (deterministic/mock providers)

This is the path you should take for a first deploy on the VPS.

### 5.1 Coolify path

1. Push the backend code to the `main` branch of your repo.
2. In the Coolify dashboard, create a new resource and select **Docker Compose**.
3. Set the project/base directory to the repository root (`/`).
4. Set the compose file path to `apps/api/docker-compose.prod.yaml`.
5. Copy the contents of `apps/api/.env.example` into the Coolify environment variables.
6. Set a strong `POSTGRES_PASSWORD` and `SMARTCURA_SESSION_CSRF_SECRET`.
7. Set `SMARTCURA_API_ALLOWED_ORIGINS` to `https://portal.smartcura.app` (or your chosen portal domain).
8. Deploy. The compose stack runs the `migrate` job before starting the API and worker.
9. Check health:
    ```bash
    curl https://api.smartcura.app/api/v1/health
    curl https://api.smartcura.app/api/v1/ready
    ```

### 5.2 Standalone path

1. SSH to the VPS.
2. Clone/pull the repo.
3. Copy and edit the env file:
   ```bash
   cd apps/api
   cp .env.example .env
   # edit .env with your editor
   ```
4. Keep deterministic/mock providers as described above.
5. Run the deploy script:
   ```bash
   ./deploy.sh
   ```
6. The script builds the image, starts infrastructure, runs migrations, and starts the API, worker, and Caddy.
7. Verify:
   ```bash
   curl https://api.smartcura.app/api/v1/health
   curl https://api.smartcura.app/api/v1/ready
   ```

---

## 6. Production checklist (when adapters and providers are ready)

- `NODE_ENV=production`
- `SMARTCURA_IDENTITY_ADAPTER=firebase` with a real Firebase project
- `SMARTCURA_OBJECT_STORAGE_PROVIDER=r2` with real R2 credentials
- `SMARTCURA_VIDEO_ADAPTER=livekit` with real LiveKit credentials
- `SMARTCURA_MALWARE_SCANNER=clamav` (container is already provided)
- `SMARTCURA_PAYMENT_PROVIDER=gateway` (requires a real payment adapter to be implemented)
- `SMARTCURA_PUSH_PROVIDER=fcm` (requires FCM credentials and a real adapter)
- `SMARTCURA_AI_PROVIDER=openai` with a real OpenAI-compatible API key
- Real, randomly generated `SMARTCURA_SESSION_CSRF_SECRET` and `SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY`
- DNS records live and pointing to the VPS
- Off-site encrypted PostgreSQL + R2 backups configured
- `k6` load tests run on the VPS for NFR evidence

Until those adapters exist, use the deterministic/mock stack for demos and the sandbox for verification.

---

## 7. Migrations

Migrations are run from the API container. They are applied one per transaction to avoid PostgreSQL `55P04` errors when enum labels are used in the same transaction they are added.

```bash
# Coolify: run as a one-off command in the api container
docker compose run --rm api npm run db:migrate

# Standalone: deploy.sh already does this, but you can run it manually
docker compose -f compose.prod.yaml run --rm api npm run db:migrate
```

On a fresh database, all 41 migrations will apply. On an existing database, only pending migrations run. If a migration fails, earlier migrations in the same run are already applied (this is the documented tradeoff).

---

## 8. Health and readiness checks

After deploying, verify these endpoints:

```bash
curl https://api.smartcura.app/api/v1/health
# Expected: { "status": "ok", "version": "...", "time": "..." }

curl https://api.smartcura.app/api/v1/ready
# Expected: { "status": "ready", "checks": [...], "time": "..." }
```

`/ready` checks PostgreSQL, migrations, and worker liveness. If it returns `503 DEPENDENCY_UNAVAILABLE`, read the JSON body to see which check failed.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker compose up` fails immediately with CSRF/identity/video errors | `NODE_ENV=production` but using default/mock values | Set `NODE_ENV=development` for demo, or provide real provider credentials for production. |
| Worker exits on startup | `SMARTCURA_AI_PROVIDER=gemini` selected, or `openai` with no key in production | Use `mock` for offline demo, or `openai` with a valid API key. |
| `/ready` returns 503 | PostgreSQL not healthy or migrations not applied | Wait for the database health check, then run `npm run db:migrate`. |
| Portal sign-in fails | Portal `.env` does not have `SMARTCURA_API_ORIGIN=https://api.smartcura.app` | Set it and redeploy the portal. |
| CORS errors in the browser | `SMARTCURA_API_ALLOWED_ORIGINS` does not include the portal's exact origin | Add the origin, including `https://`. |
| ClamAV causes worker to never start | Signature DB still downloading | Wait 1–2 minutes; the health check start period is 120 seconds. |

---

## 10. Summary of what you need before the first deploy

Minimum for a working demo on the VPS:

1. DNS: `api.smartcura.app` and `portal.smartcura.app` pointing to the VPS.
2. A strong `POSTGRES_PASSWORD`.
3. A strong `SMARTCURA_SESSION_CSRF_SECRET`.
4. `SMARTCURA_API_ALLOWED_ORIGINS=https://portal.smartcura.app`.
5. Portal `.env`: `SMARTCURA_API_ORIGIN=https://api.smartcura.app`.

Everything else can stay at demo/mock values until you are ready for real providers.
