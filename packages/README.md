# Shared Packages

This folder holds shared libraries consumed by apps in the monorepo.

Planned packages:

- `contracts` — API contracts (OpenAPI, AsyncAPI) and generated TypeScript/Dart clients.
- `config` — Shared ESLint, TypeScript, and Prettier presets.
- `api-client` — Generated TypeScript API client used by the web portal.
- `ui` — Shared React/shadcn components (optional).

Currently the backend keeps its own internal packages under `apps/api/packages/`,
so the root `packages/` directory is a placeholder for future cross-app sharing.
