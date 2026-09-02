# SmartCura Environment Variables Guide

This guide lists every environment variable you need to run SmartCura on your own domain (`smartcura.app`), explains where each value comes from, and why it is required. It covers the **backend**, the **Next.js portal**, and the **DNS records** that tie them together.

> **For a first deploy, you only need three secrets and two DNS records.** Everything else can stay on deterministic/mock providers. See the [First working `.env`](#first-working-env) section at the end.

---

## 1. DNS records (do this first)

Point these subdomains to your VPS IP with `A` records (or `CNAME` to the apex):

| Subdomain | Service | Needed now? |
|---|---|---|
| `api.smartcura.app` | NestJS REST API + Socket.IO | **Yes** |
| `portal.smartcura.app` | Next.js web portal | **Yes** |
| `livekit.smartcura.app` | LiveKit video signalling | Only when video is enabled |
| `mqtt.smartcura.app` | Mosquitto MQTT over TLS | Only when IoT devices connect over the public internet |

You can use `app.smartcura.app` instead of `portal.smartcura.app`. Whatever you choose, use it everywhere consistently.

---

## 2. Backend environment variables

Copy `apps/api/.env.example` to `apps/api/.env` and fill in the values.

### 2.1 Core runtime

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `NODE_ENV` | `development` | Your choice. | `development` allows mock/deterministic adapters. `production` refuses them and requires real providers. | Yes |
| `SMARTCURA_BUILD_VERSION` | `0.1.0` | Any string you choose. | Logged on startup and returned by `/health`. | No (defaults to `0.1.0`) |

### 2.2 Database

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `POSTGRES_PASSWORD` | `long-random-password` | Generate it yourself (`openssl rand -base64 32`). | Password used by the Docker PostgreSQL container and the backend connection string. | **Yes** |
| `DATABASE_URL` | `postgresql://smartcura_dev:...` | For local dev only. | Full connection string when running the API/worker directly on your laptop (not in Docker). | Local dev only |
| `DATABASE_READINESS_TIMEOUT_MS` | `2000` | Default is fine. | How long the API/worker waits for PostgreSQL before giving up on startup. | No |
| `SMARTCURA_POSTGRES_PASSWORD` | `change-this-local-password` | For local dev only. | Password used by `apps/api/compose.yaml` (local dev stack). | Local dev only |

### 2.3 API

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_API_HOST` | `0.0.0.0` (Docker) or `127.0.0.1` (local) | Docker or local. | Network interface the NestJS API listens on. `0.0.0.0` is required inside a container. | Yes |
| `SMARTCURA_API_PORT` | `3000` | Default. | Port the API listens on inside the container. | No |
| `SMARTCURA_API_WORKER_MAX_AGE_MS` | `15000` | Default. | `/ready` reports the worker as stale if it has not claimed an outbox job within this window. | No |
| `SMARTCURA_API_ALLOWED_ORIGINS` | `https://portal.smartcura.app` | Your portal domain. | CORS allowed origins. Must be an exact match; wildcards are forbidden. | **Yes** |
| `SMARTCURA_SESSION_CSRF_SECRET` | `32-char-min-random-string` | Generate it (`openssl rand -base64 32`). | Signs CSRF tokens for state-changing routes. Production refuses the default value. | **Yes** |

### 2.4 Identity

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_IDENTITY_ADAPTER` | `local` (demo) or `firebase` (production) | Your choice. | Selects whether the backend verifies Firebase ID tokens or uses local fixture tokens. | Yes |
| `SMARTCURA_FIREBASE_PROJECT_ID` | `smartcura-prod` | Firebase console → Project Settings. | Used to verify Firebase ID tokens against Google's public keys. Required when adapter is `firebase`. | Production only |
| `SMARTCURA_LOCAL_IDENTITY_TOKEN` | `local-fixture-token-...` | For local dev only. | Fixture bearer token used by the local identity adapter. | Local dev only |
| `SMARTCURA_LOCAL_IDENTITY_UID` | `local-fixture-user` | For local dev only. | Fixture Firebase UID. | Local dev only |
| `SMARTCURA_LOCAL_IDENTITY_EMAIL` | `local.user@smartcura.invalid` | For local dev only. | Fixture email address. | Local dev only |
| `SMARTCURA_LOCAL_IDENTITY_EMAIL_VERIFIED` | `true` | For local dev only. | Whether the fixture email is treated as verified. | Local dev only |
| `SMARTCURA_LOCAL_IDENTITY_MFA` | `true` | For local dev only. | Whether the fixture identity is treated as MFA-satisfied. | Local dev only |
| `SMARTCURA_LOCAL_IDENTITY_SECONDARY_TOKEN` / `UID` / `EMAIL` | ... | For local dev only. | A second fixture identity so the local adapter can test two-party rules. | Local dev only |

**Why Firebase is needed.** The project verifies Firebase ID tokens directly against Google's published X.509 signing keys instead of using the Firebase Admin SDK. You only need the Firebase **project ID**; no service-account key is required for token verification. Identity Platform is needed if you want TOTP MFA and password policy enforcement.

### 2.5 AI provider

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_AI_PROVIDER` | `mock` (demo) or `openai` (production) | Your choice. | Selects the LLM provider. | Yes |
| `SMARTCURA_AI_API_KEY` | `sk-...` | Your provider dashboard. | API key for the OpenAI-compatible endpoint. | Production only |
| `SMARTCURA_AI_BASE_URL` | `https://api.openai.com/v1` | Your provider docs. | Base URL of the chat-completions API. | Production only |
| `SMARTCURA_AI_MODEL` | `gpt-4o-mini` | Your provider model list. | Model name to call. | Production only |

**Why OpenAI-compatible.** The backend calls the standard `/chat/completions` endpoint, so you can use OpenAI, OpenRouter, Groq, or any provider with the same API shape. The default model is `gpt-4o-mini`.

### 2.6 Video (LiveKit)

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_VIDEO_ADAPTER` | `deterministic` (demo) or `livekit` (production) | Your choice. | Selects whether video tokens are fake or real. | Yes |
| `SMARTCURA_LIVEKIT_URL` | `wss://livekit.smartcura.app` | Your LiveKit server or LiveKit Cloud. | WebSocket URL the client connects to. | Production only |
| `SMARTCURA_LIVEKIT_API_KEY` | `API_KEY` | LiveKit server config or Cloud dashboard. | Used to mint room tokens on the backend. | Production only |
| `SMARTCURA_LIVEKIT_API_SECRET` | `long-secret` | LiveKit server config or Cloud dashboard. | Signs the room tokens. | Production only |
| `SMARTCURA_LIVEKIT_TOKEN_TTL_SECONDS` | `300` | Default. | How long a generated room token is valid. | No |

### 2.7 Push notifications

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY` | `64-char-hex` | `openssl rand -hex 32` | AES-256 key used to encrypt FCM registration tokens before storing them in PostgreSQL. The API app seals tokens on registration; the worker opens them at send time. Both must use the same key. | **Yes** (must be non-zero) |
| `SMARTCURA_PUSH_PROVIDER` | `deterministic` (demo) or `fcm` (production) | Your choice. | Selects whether push notifications are faked or sent via FCM. | Yes |
| `FIREBASE_PROJECT_ID` | `smartcura-prod` | Firebase console → Project Settings → Service Accounts. | Firebase project id; part of the service account credentials the worker uses to authenticate to FCM. Required when `SMARTCURA_PUSH_PROVIDER=fcm`. | Production (fcm) only |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk@smartcura-prod.iam.gserviceaccount.com` | Same service account page. | The service account email. Required when `SMARTCURA_PUSH_PROVIDER=fcm`. | Production (fcm) only |
| `FIREBASE_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----\nMIIB...\n-----END PRIVATE KEY-----\n` | Same service account page → Generate new private key. | The PEM-encoded private key. In env vars the literal newlines are usually escaped as `\n`; the worker restores them. Required when `SMARTCURA_PUSH_PROVIDER=fcm`. | Production (fcm) only |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | `/run/secrets/firebase-service-account.json` | Path to the downloaded JSON key file. | Alternative to the three discrete vars: the worker reads and parses this file at boot. Use either this OR the three discrete vars, not both. | Production (fcm) only |

**FCM note.** The real FCM adapter (`FcmPushDeliveryProvider`) is implemented and sends via `firebase-admin`. For the FYP demo, `deterministic` is allowed in production and the worker logs a warning at boot. To enable real push, set `SMARTCURA_PUSH_PROVIDER=fcm` and provide the Firebase service account credentials above. The same `SMARTCURA_FIREBASE_PROJECT_ID` used for identity verification may differ from the `FIREBASE_PROJECT_ID` used for the FCM service account if you use separate projects, but in practice they are the same project.

### 2.8 Object storage (Cloudflare R2)

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_OBJECT_STORAGE_PROVIDER` | `memory` (demo) or `r2` (production) | Your choice. | Selects whether uploaded files are stored in memory or in R2. | Yes |
| `SMARTCURA_R2_ACCOUNT_ID` | `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Cloudflare dashboard, right-hand sidebar. | Identifies your Cloudflare account. | Production only |
| `SMARTCURA_R2_BUCKET` | `smartcura-files` | Cloudflare R2 → Create bucket. | The bucket name where private files are stored. | Production only |
| `SMARTCURA_R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | Cloudflare R2 docs. | S3-compatible endpoint URL. The backend validates the hostname ends with `.r2.cloudflarestorage.com`. | Production only |
| `SMARTCURA_R2_ACCESS_KEY_ID` | `...` | R2 → Manage API tokens → Create token. | Access key ID for the S3-compatible API. | Production only |
| `SMARTCURA_R2_SECRET_ACCESS_KEY` | `...` | Same token creation page. | Secret access key for the S3-compatible API. | Production only |

**Why R2 is needed.** Files (verification documents, prescription PDFs, delivery proof, etc.) must be stored outside the VPS. The backend uses a provider-neutral S3 interface, but the project selected Cloudflare R2 as the concrete object store.

### 2.9 Worker

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_WORKER_POLL_INTERVAL_MS` | `5000` | Default. | How often the worker polls the outbox for new jobs. | No |
| `SMARTCURA_WORKER_LEASE_MS` | `30000` | Default. | How long a worker lease on an outbox job lasts. | No |
| `SMARTCURA_WORKER_BATCH_SIZE` | `10` | Default. | How many outbox jobs the worker claims per poll. | No |
| `SMARTCURA_WORKER_MAX_ATTEMPTS` | `10` | Default. | Max retry attempts before an outbox job becomes a dead letter. | No |
| `SMARTCURA_MALWARE_SCANNER` | `deterministic` (demo) or `clamav` (production) | Your choice. | Selects whether file scanning is faked or uses ClamAV. | Yes |
| `SMARTCURA_CLAMAV_HOST` | `clamav` (Docker) or `127.0.0.1` (local) | Service name/address. | Hostname of the ClamAV daemon. | Production only |
| `SMARTCURA_CLAMAV_PORT` | `3310` | Default. | Port the ClamAV daemon listens on. | No |
| `SMARTCURA_CLAMAV_TIMEOUT_MS` | `15000` | Default. | Max time to wait for a ClamAV scan. | No |
| `SMARTCURA_PAYMENT_PROVIDER` | `deterministic` (demo) or `gateway` (production) | Your choice. | Selects whether payments are simulated or sent to a real gateway. | Yes |
| `SMARTCURA_PUSH_PROVIDER` | `deterministic` (demo) or `fcm` (production) | Your choice. | See Push notifications section above. | Yes |
| `SMARTCURA_EMAIL_PROVIDER` | `deterministic` (demo) or `cloudflare` (production) | Your choice. | See Transactional email section below. | Yes |
| `SMARTCURA_AI_PROVIDER` | `mock` (demo) or `openai` (production) | Your choice. | See AI provider section above. | Yes |
| `SMARTCURA_MQTT_URL` | `mqtt://mosquitto:1883` (Docker) | Default. | MQTT broker URL for the vitals ingestion bridge. If unset, the bridge does not start and the worker logs a warning. | IoT demo only |
| `SMARTCURA_MQTT_USERNAME` | `smartcura-bridge` | Default. | Service account the worker uses to subscribe to device vitals. Must match the ACL entry in `deploy/mosquitto/auth/acl`. | IoT demo only |
| `SMARTCURA_MQTT_PASSWORD` | `long-random-password` | Generate it (`openssl rand -base64 32`). Run `deploy/mosquitto/setup-mqtt-auth.sh init` to create the broker password file entry, then use the same value here. | Broker credential for the bridge service account. | IoT demo only |
| `SMARTCURA_MQTT_CLIENT_ID` | `smartcura-worker` | Default. | MQTT client ID for the bridge connection. | No |

**FYP demo note.** `deterministic` payment, push, and email are allowed in `NODE_ENV=production` for the FYP demo. The worker logs a warning at startup. Use `gateway`, `fcm`, and `cloudflare` only when the real adapters are implemented.

**MQTT ingestion setup.** To enable the IoT vitals path: (1) start the stack with the `mosquitto` service, (2) run `deploy/mosquitto/setup-mqtt-auth.sh init` with your bridge password to create the broker password file entry, (3) set `SMARTCURA_MQTT_PASSWORD` to the same value in the worker env, (4) register a device via `POST /organizations/{org}/devices` and save the `provisioning_secret`, (5) assign the device to a patient via `POST /organizations/{org}/devices/{id}/assignments`, (6) run `setup-mqtt-auth.sh add-device` with the device's UUIDv7 id and provisioning secret to add it to the broker password file, (7) flash the ESP32 with the device id and provisioning secret. The ACL file (`deploy/mosquitto/auth/acl`) uses a `%u` pattern so each device can publish only to its own vitals topic — no per-device ACL entry is needed. The `passwd` and `acl` files live in a **named volume** (`mosquitto_config` mounted at `/mosquitto/config/auth`) so device credentials survive every Coolify redeploy; see `apps/api/DEPLOYMENT.md` §2.3.

### 2.10 Redis (rate limiting + chat gateway)

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_REDIS_URL` | `redis://redis:6379` (Docker) or `redis://localhost:6379` (local) | Redis service on the internal Docker network, or a managed Redis URL. | Redis backs two features: (1) the per-route rate limiter (`@nestjs/throttler` with Redis storage) so rate-limit budgets are shared across API instances, and (2) the WebSocket chat gateway pub/sub fan-out and presence state. When unset, the chat gateway skips pub/sub and the throttler falls back to in-memory storage so rate limiting still applies within one process. | Production only (optional for local dev/CI) |

**Why Redis is needed.** Both production compose files (`compose.prod.yaml` and `docker-compose.prod.yaml`) already include a `redis:7-alpine` service, and LiveKit uses it for its own signaling state. The API reuses the same Redis instance for the rate limiter and the chat gateway. Set `SMARTCURA_REDIS_URL=redis://redis:6379` in the API container's environment; the compose files already wire this.

### 2.11 Standalone production routing (Caddy)

Only used when you run `compose.prod.yaml` + Caddy instead of Coolify.

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `DOMAIN` | `smartcura.app` | Your registrar. | Caddy uses this to request TLS certificates for `api.smartcura.app`, `portal.smartcura.app`, etc. | Standalone only |
| `ACME_EMAIL` | `admin@smartcura.app` | Your email. | Let's Encrypt account email for certificate expiry notices. | Standalone only |

### 2.12 Transactional email

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_EMAIL_PROVIDER` | `deterministic` (demo), `smtp` (production), or `cloudflare` | Your choice. | Selects whether transactional emails (appointment reminders, verification results, pharmacy order updates) are faked, sent via Hostinger Email SMTP (nodemailer), or sent via the Cloudflare Email Service. The worker processes `notification.email-requested.v1` outbox events through this adapter, mirroring the push channel. | Yes |
| `SMTP_HOST` | `smtp.hostinger.com` | hPanel → Emails → your mailbox → SMTP details. | Hostinger Email SMTP host for the `smtp` adapter. | Production only (required when `SMARTCURA_EMAIL_PROVIDER=smtp`) |
| `SMTP_PORT` | `465` | Same screen. 465 = implicit TLS, 587 = STARTTLS. | SMTP port. Defaults to 465 when unset. | Optional |
| `SMTP_SECURE` | `true` / `false` | Same screen. | Force implicit TLS (`true`) or STARTTLS (`false`) instead of deriving it from the port. | Optional |
| `SMTP_USER` | `no-reply@smartcura.app` | The mailbox login (full address). | SMTP authentication user; also the default `from` address when `SMTP_FROM_EMAIL` is unset. | Production only (required when `SMARTCURA_EMAIL_PROVIDER=smtp`) |
| `SMTP_PASSWORD` | (mailbox password) | The mailbox password from hPanel. | SMTP authentication. Never committed; env only. | Production only (required when `SMARTCURA_EMAIL_PROVIDER=smtp`) |
| `SMTP_FROM_EMAIL` | `no-reply@smartcura.app` | Any mailbox on the domain. | The `from` address. Defaults to `SMTP_USER`. | Optional |
| `SMTP_FROM_NAME` | `SmartCura` | Your choice. | The display name on outbound mail. Defaults to `SmartCura`. | Optional |
| `CLOUDFLARE_API_TOKEN` | `cf-api-token...` | Cloudflare dashboard → My Profile → API Tokens → Create Token (permission: Email Routing / Email Sending). | Authenticates the worker to the Cloudflare Email Service REST API for outbound mail. | Production only (required when `SMARTCURA_EMAIL_PROVIDER=cloudflare`) |
| `CLOUDFLARE_ACCOUNT_ID` | `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Cloudflare dashboard, right-hand sidebar of your account. | Identifies the Cloudflare account that owns the verified sending domain. | Production only (required when `SMARTCURA_EMAIL_PROVIDER=cloudflare`) |
| `CLOUDFLARE_EMAIL_DOMAIN` | `smartcura.app` | A domain you have verified for outbound email in Cloudflare Email Routing. | The `from` address is `no-reply@<this domain>`. Must be a domain Cloudflare is authorised to send from. | Production only (required when `SMARTCURA_EMAIL_PROVIDER=cloudflare`) |

**Hostinger SMTP note (preferred production path).** `SMARTCURA_EMAIL_PROVIDER=smtp` sends through Hostinger Email SMTP with `nodemailer`: set `SMTP_HOST=smtp.hostinger.com`, `SMTP_USER`, and `SMTP_PASSWORD` (plus `SMTP_FROM_*` if the sender should differ from the login). Selecting `smtp` without host/user/password is a hard failure at boot, exactly like the Cloudflare variant. Transport errors are logged with the password redacted, and every send carries an `X-SmartCura-Operation-Id` header so bounces correlate back to the notification delivery.

**Cloudflare Email Service note.** The backend can select `cloudflare`, which routes email through the Cloudflare Email Service REST API. For the FYP demo, `deterministic` is allowed in production and the worker logs a warning at boot, exactly as the push channel does. Selecting `cloudflare` without all three `CLOUDFLARE_*` credentials is a hard failure: the worker refuses to boot rather than silently dropping mail. The email adapter resolves the recipient's address from the `profiles` table (never from the outbox payload), and a notification only produces an email when an `email` preference row is enabled for that category or the notification is marked mandatory — email is opt-in by default, unlike in-app which cannot be disabled.

---

## 3. Portal environment variables

Set these in `apps/web-portal/.env` (not the backend `.env`). The portal proxies `/api/v1/*` to the backend so the `__Host-smartcura_session` cookie stays same-origin.

| Variable | Example | Where to get it | Why it is needed | Required? |
|---|---|---|---|---|
| `SMARTCURA_API_ORIGIN` | `https://api.smartcura.app` | Your backend subdomain. | Target of the Next.js rewrite rule for `/api/v1/*`. **Must be available at build time.** | **Yes** |
| `NEXT_PUBLIC_APP_URL` | `https://portal.smartcura.app` | Your portal subdomain. | Public app URL for metadata, emails, redirects. | Yes |
| `NEXT_PUBLIC_API_URL` | `/api/v1` or unset | Your backend path. | Client API base path. The client ignores absolute URLs and always uses the same-origin `/api/v1/*` proxy so the `__Host-` cookie is sent. | Optional |

---

## 4. How to set up each external provider

### 4.1 Firebase (identity + future FCM)

1. Go to https://console.firebase.google.com and create a project.
2. Copy the **Project ID** from Project Settings.
3. Enable **Authentication** → **Email/Password**.
4. Upgrade to **Identity Platform** if you want TOTP MFA and password policy.
5. Under **Authentication** → **Settings** → **Authorized domains**, add `portal.smartcura.app` (and `app.smartcura.app` if you use that).
6. For FCM later: enable **Cloud Messaging** and create a service account. The backend does not yet read FCM credentials from an env var, so this is preparation.

**Value to copy into `.env`:** `SMARTCURA_FIREBASE_PROJECT_ID=your-project-id`.

### 4.2 Cloudflare R2 (object storage)

1. In the Cloudflare dashboard, open **R2** and create a bucket, e.g. `smartcura-files`.
2. Go to **R2** → **Manage API tokens** → **Create API token**.
3. Give it **Edit** permission on the bucket you created.
4. Copy the **Access Key ID** and **Secret Access Key**.
5. Copy your **Account ID** from the right-hand sidebar of the Cloudflare dashboard.
6. Endpoint: `https://<account-id>.r2.cloudflarestorage.com`.

**Values to copy into `.env`:**
- `SMARTCURA_R2_ACCOUNT_ID=<account-id>`
- `SMARTCURA_R2_BUCKET=smartcura-files`
- `SMARTCURA_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
- `SMARTCURA_R2_ACCESS_KEY_ID=<access-key>`
- `SMARTCURA_R2_SECRET_ACCESS_KEY=<secret-key>`

### 4.3 LiveKit (video)

**Option A — self-hosted**

1. Deploy a LiveKit server on the same VPS or another server.
2. In the LiveKit config, note the API key and secret.
3. Set `SMARTCURA_LIVEKIT_URL=wss://livekit.smartcura.app` and point the DNS record to the LiveKit server.

**Option B — LiveKit Cloud**

1. Create a project at https://livekit.io.
2. Copy the API key, secret, and server URL from the project dashboard.

**Values to copy into `.env`:**
- `SMARTCURA_LIVEKIT_URL=wss://livekit.smartcura.app`
- `SMARTCURA_LIVEKIT_API_KEY=<key>`
- `SMARTCURA_LIVEKIT_API_SECRET=<secret>`

### 4.4 ClamAV (malware scanning)

ClamAV is included as a container in `compose.prod.yaml`. On first boot it downloads the virus signature database, which can take 1–2 minutes. The `compose.prod.yaml` health check waits up to 120 seconds before the worker is allowed to start.

No env var setup is required beyond choosing `SMARTCURA_MALWARE_SCANNER=clamav`.

### 4.5 Payment gateway (future)

A real payment adapter is not implemented yet. For now, keep `SMARTCURA_PAYMENT_PROVIDER=deterministic`. When a real adapter is added, you will likely need a gateway API key and webhook secret.

### 4.6 AI provider (OpenAI-compatible)

The backend implements an OpenAI-compatible adapter that calls the standard `/chat/completions` endpoint. This works with OpenAI, OpenRouter, Groq, or any provider with the same API shape.

1. Choose a provider and model. The default is `gpt-4o-mini` via `https://api.openai.com/v1`.
2. Copy the API key from the provider dashboard.
3. For OpenRouter, set `SMARTCURA_AI_BASE_URL=https://openrouter.ai/api/v1` and `SMARTCURA_AI_MODEL=openai/gpt-4o-mini` (or another model slug).

**Values to copy into `.env`:**
- `SMARTCURA_AI_PROVIDER=openai`
- `SMARTCURA_AI_API_KEY=<your-key>`
- `SMARTCURA_AI_BASE_URL=https://api.openai.com/v1`
- `SMARTCURA_AI_MODEL=gpt-4o-mini`

For an offline demo, keep `SMARTCURA_AI_PROVIDER=mock` and leave the AI key/base URL/model empty.

---

## 5. First working `.env` {#first-working-env}

For the first deploy on the VPS, use deterministic/mock providers. You only need three real values:

1. A strong `POSTGRES_PASSWORD`.
2. A strong `SMARTCURA_SESSION_CSRF_SECRET` (at least 32 characters).
3. `SMARTCURA_API_ALLOWED_ORIGINS=https://portal.smartcura.app` (or your chosen portal domain).

```text
# apps/api/.env
NODE_ENV=development
SMARTCURA_BUILD_VERSION=0.1.0
POSTGRES_PASSWORD=<generate-strong-password>
SMARTCURA_API_HOST=0.0.0.0
SMARTCURA_API_PORT=3000
SMARTCURA_API_ALLOWED_ORIGINS=https://portal.smartcura.app
SMARTCURA_SESSION_CSRF_SECRET=<generate-at-least-32-chars>
SMARTCURA_IDENTITY_ADAPTER=local
SMARTCURA_FIREBASE_PROJECT_ID=
SMARTCURA_VIDEO_ADAPTER=deterministic
SMARTCURA_LIVEKIT_URL=
SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
# Optional: set to enable Redis-backed rate limiting and chat pub/sub.
# SMARTCURA_REDIS_URL=redis://localhost:6379
SMARTCURA_OBJECT_STORAGE_PROVIDER=memory
SMARTCURA_R2_ACCOUNT_ID=
SMARTCURA_R2_BUCKET=
SMARTCURA_R2_ENDPOINT=
SMARTCURA_R2_ACCESS_KEY_ID=
SMARTCURA_R2_SECRET_ACCESS_KEY=
SMARTCURA_MALWARE_SCANNER=deterministic
SMARTCURA_PAYMENT_PROVIDER=deterministic
SMARTCURA_PUSH_PROVIDER=deterministic
# Optional: set to fcm to enable real FCM push delivery. Requires the Firebase
# service account credentials below (either the three discrete vars or a path).
# FIREBASE_PROJECT_ID=
# FIREBASE_CLIENT_EMAIL=
# FIREBASE_PRIVATE_KEY=
# FIREBASE_SERVICE_ACCOUNT_PATH=
SMARTCURA_EMAIL_PROVIDER=deterministic
SMARTCURA_AI_PROVIDER=mock
SMARTCURA_AI_API_KEY=
SMARTCURA_AI_BASE_URL=https://api.openai.com/v1
SMARTCURA_AI_MODEL=gpt-4o-mini
DOMAIN=smartcura.app
ACME_EMAIL=admin@smartcura.app
```

For the portal:

```text
# apps/web-portal/.env
SMARTCURA_API_ORIGIN=https://api.smartcura.app
NEXT_PUBLIC_APP_URL=https://portal.smartcura.app
NEXT_PUBLIC_API_URL=https://api.smartcura.app
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
- `SMARTCURA_EMAIL_PROVIDER=cloudflare` with real Cloudflare Email Service credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_DOMAIN`) and a verified sending domain
- `SMARTCURA_AI_PROVIDER=openai` with a real OpenAI-compatible API key (e.g., OpenAI, OpenRouter, Groq)
- Real, randomly generated `SMARTCURA_SESSION_CSRF_SECRET` and `SMARTCURA_PUSH_TOKEN_ENCRYPTION_KEY`
- DNS records live and pointing to the VPS
- Off-site encrypted PostgreSQL + R2 backups configured
- Load tests run on the VPS for NFR evidence

Until those adapters exist, use the deterministic/mock stack for demos and the sandbox for verification.

---

## 7. Common mistakes

| Mistake | Why it fails | Fix |
|---|---|---|
| Setting `NODE_ENV=production` but using mock providers | Production refuses to boot. | Use `NODE_ENV=development` for demos, or provide real providers. |
| Using `SMARTCURA_AI_PROVIDER=gemini` | The Gemini adapter is not implemented; only `mock` and `openai` are valid. | Use `mock` for offline demo or `openai` for real AI. |
| Using `SMARTCURA_API_ALLOWED_ORIGINS=*` | Wildcards are forbidden; CORS fails. | List exact origins, e.g. `https://portal.smartcura.app`. |
| Leaving the default CSRF secret | Production refuses to start. | Generate a random string of at least 32 characters. |
| Forgetting the portal `.env` | The portal cannot reach the API and sign-in fails. | Set `SMARTCURA_API_ORIGIN=https://api.smartcura.app`. |
| Using a zero encryption key for push tokens | Production refuses to start. | Generate `openssl rand -hex 32`. |

---

## 8. Related files

- `apps/api/.env.example` — the canonical template for backend env vars.
- `apps/api/DEPLOYMENT.md` — step-by-step deploy instructions for Coolify and standalone Caddy.
- `apps/api/docker-compose.yaml` — Coolify/demo stack with mock providers allowed.
- `apps/api/compose.prod.yaml` — standalone production stack requiring real providers.
- `apps/api/deploy.sh` — standalone deploy script.
