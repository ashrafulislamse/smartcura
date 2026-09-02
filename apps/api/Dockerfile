# syntax=docker/dockerfile:1
# Production image for the SmartCura backend.
# Builds the NestJS API and worker monorepo and ships only compiled output.
# Usage:
#   docker build -t smartcura-backend .
#   docker run -e NODE_ENV=production -e DATABASE_URL=... smartcura-backend
#   docker run --entrypoint node smartcura-backend apps/worker/dist/main.js

ARG NODE_VERSION=22.19

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app

# Native deps may be required for some packages; Python/make/gcc are available in the
# full node image, but Alpine needs them explicitly.
RUN apk add --no-cache python3 make g++ dumb-init

# Install all dependencies (including dev) so tsc and the build can run.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/identity/package.json ./packages/identity/
COPY packages/observability/package.json ./packages/observability/
COPY packages/policy/package.json ./packages/policy/
COPY packages/storage/package.json ./packages/storage/
RUN npm ci --include=dev

# Copy source and build the whole workspace graph.
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S smartcura && \
    adduser -S smartcura -G smartcura

# Root package metadata and locked dependencies.
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /app/node_modules ./node_modules

# Compiled application output and package metadata.
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist


COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/database/dist ./packages/database/dist
# Migrations and the per-transaction runner are required at runtime for db:migrate.
COPY --from=builder /app/packages/database/drizzle ./packages/database/drizzle
COPY --from=builder /app/packages/database/dist/migrate.js ./packages/database/dist/migrate.js
COPY --from=builder /app/packages/identity/package.json ./packages/identity/
COPY --from=builder /app/packages/identity/dist ./packages/identity/dist
COPY --from=builder /app/packages/observability/package.json ./packages/observability/
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/policy/package.json ./packages/policy/
COPY --from=builder /app/packages/policy/dist ./packages/policy/dist
COPY --from=builder /app/packages/storage/package.json ./packages/storage/
COPY --from=builder /app/packages/storage/dist ./packages/storage/dist

USER smartcura

# Default to the API; override CMD to run the worker or a migration job.
# Migrations run BEFORE the API starts so a fresh deploy always has the schema the
# code expects. Without this, Coolify runs the CMD directly (no deploy.sh step) and the
# readiness check fails with 503 because schema_compatibility.identity is stale.
EXPOSE 3000
CMD ["dumb-init", "sh", "-c", "node packages/database/dist/migrate.js && node apps/api/dist/main.js"]
