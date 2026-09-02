# SmartCura Web Portal — VPS Deployment

**Status:** Implemented — the portal runs as a container behind Caddy/Traefik on the VPS.
**Reviewed:** 26 July 2026

The portal is not deployed to Vercel. It runs as a Next.js container on the same VPS as the SmartCura backend and is reached through Caddy.

## Production route

```text
Browser → HTTPS portal.smartcura.app → Caddy → portal:3000
Browser → HTTPS api.smartcura.app → Caddy → api:3000
```

The portal never connects directly to PostgreSQL, Redis, Cloudflare R2 credentials, MQTT or the ML service. File access is authorized by NestJS and uses only short-lived scoped operations.

## Required browser configuration

- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_APP_URL=https://portal.smartcura.app`
- `NEXT_PUBLIC_API_URL=https://api.smartcura.app/api/v1`
- Firebase Web SDK public configuration for Firebase Auth

Values prefixed with `NEXT_PUBLIC_` are visible to users and must not contain secrets. Firebase Admin credentials, database URLs, signing keys and provider secrets belong only in backend/VPS secret storage.

## Stage 0B deployment flow

1. Build a pinned, multi-stage portal image from `package-lock.json`.
2. Run the portal through `compose.prod.yaml` on the private Docker network.
3. Route the admin hostname through Caddy with automatic TLS.
4. Configure Firebase authorized domains and the API CORS allowlist.
5. Run `npm run type-check` and `npm run build` before publishing the image.
6. Verify login, token refresh, role selection, API authorization and logout.
7. Confirm PostgreSQL and internal service ports are not publicly reachable.

## Rollback

Tag every image with a commit SHA. Keep the previous known-good image and database migration notes. Roll back the portal image independently; never roll back PostgreSQL blindly after a forward migration.

See [DEPLOYMENT.md](../api/DEPLOYMENT.md) for the complete infrastructure and deployment design.