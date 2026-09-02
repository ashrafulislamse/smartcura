# ---- deps ----
# Pinned to the Node version the project is verified against (apps/api sandbox
# uses Node 22.19; @types/node is ^22 here). Bump deliberately, not by accident.
#
# Build context is the REPO ROOT (Coolify's "Base Directory" affects Dockerfile
# location, not build context). The first build attempt against this context
# arrived empty (2 bytes) and produced "/apps/web-portal: not found"; a later
# attempt with the same paths received the full 1.48 MB context. That earlier
# failure was a Coolify helper glitch, not a Dockerfile bug — these paths are
# correct against a repo-root context and have been verified to work.
FROM node:22-alpine AS deps
WORKDIR /repo

# Copy the lockfile + manifest first so the layer caches across source changes.
COPY apps/web-portal/package.json apps/web-portal/package-lock.json ./apps/web-portal/
# Contracts: portal is not a workspace member, so a sibling checkout is required
# only when sync-contracts is run. We deliberately do NOT run it in the image
# (see AGENTS.md trap entry); the committed src/types/contracts.ts is what
# next build type-checks against. If you change the backend contract, run
# `npm run contracts:sync` in apps/web-portal locally and commit the result.
RUN cd apps/web-portal && npm ci --no-audit --no-fund

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /repo

# Bring in the installed deps from the previous stage.
COPY --from=deps /repo/apps/web-portal/node_modules ./apps/web-portal/node_modules
# Then bring in the source. Order matters: changing any source file invalidates
# only this layer, not the deps install.
COPY apps/web-portal ./apps/web-portal

# Public env vars (NEXT_PUBLIC_*) MUST be present at build time. Coolify lets
# you set build-time env via the same env screen as runtime env. If you forget,
# the JS bundle will ship undefined values and the page will look fine until a
# user clicks a link.
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

WORKDIR /repo/apps/web-portal
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Plain multi-stage: copy .next, public, and node_modules from the build stage.
# We deliberately do not enable Next's output:'standalone' (see commit msg) —
# the image is larger but the build is dead simple to debug.
COPY --from=build /repo/apps/web-portal/public ./public
COPY --from=build /repo/apps/web-portal/.next ./.next
COPY --from=build /repo/apps/web-portal/node_modules ./node_modules
COPY --from=build /repo/apps/web-portal/package.json ./package.json
COPY --from=build /repo/apps/web-portal/next.config.js ./next.config.js

EXPOSE 3000

# Run as the unprivileged node user that the official image ships with.
USER node

CMD ["npm", "run", "start"]
