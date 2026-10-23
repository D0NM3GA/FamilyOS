# Phase 43: the production image (docker-compose.prod.yml builds it; README "Running in
# production"). Node from .node-version, by its multi-arch digest: one line builds arm64 on a Mac
# and amd64 on the server. Bump it by hand with .node-version, at least 7 days after release.
ARG NODE_IMAGE=node:24.21.0-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

# ---- install: a full `npm ci` under the repository's .npmrc (exact pins, approved install
# scripts only). Not --omit=dev: prisma is a devDependency that postinstall runs.
FROM ${NODE_IMAGE} AS install
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc .node-version prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/copy-zxing-wasm.mjs ./scripts/
# `prisma generate` reads the config's datasource; a placeholder, never a real database.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci

# ---- build: `next build` into .next/standalone (postbuild copies public/ and .next/static in,
# scripts/standalone-assets.mjs). Building imports every route, and some modules
# check their keys at import, so throwaway keys are made for this one command and kept nowhere.
FROM install AS build
COPY . .
# Phase 46: no build arguments beyond the base image. The image is published, so nothing about
# one family may be built in: Sentry's DSN is read when the app starts (SENTRY_DSN).
RUN export DATABASE_URL=postgresql://build:build@localhost:5432/build \
      BETTER_AUTH_URL=http://localhost:3000 \
      BETTER_AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
      INTEGRATION_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
 && npm run build

# ---- migrate-deps: Prisma's CLI and nothing else (Phase 48). A subset of the tree `install` built
# from the lockfile: package.json is cut down to `prisma` and `npm prune` removes the rest, offline
# and without scripts, so nothing is resolved or fetched again (the schema engine is the one
# `install` fetched). `overrides` stays, or npm would re-resolve and fail offline. `prisma` moves
# to dependencies so an --omit=dev from the environment can't prune it away. Prune leaves the
# emptied scope folders behind; they go too.
FROM install AS migrate-deps
RUN node -e 'const fs = require("node:fs"); const p = JSON.parse(fs.readFileSync("package.json", "utf8")); \
      p.dependencies = { prisma: p.devDependencies.prisma }; p.devDependencies = {}; \
      fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")' \
 && npm prune --offline --ignore-scripts --no-audit \
 && find node_modules -mindepth 1 -maxdepth 1 -type d -empty -delete

# ---- migrate: `prisma migrate deploy`, run once before the app starts (docker-compose.prod.yml).
# Only the CLI, its config, the schema and the migrations: no app code, seeds, lockfile or .npmrc.
FROM ${NODE_IMAGE} AS migrate
# Fixed labels only (the commit is in the published tag and its provenance record, not here).
LABEL org.opencontainers.image.source="https://github.com/D0NM3GA/FamilyOS" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
# Prisma's usage check-in never leaves the server.
ENV CHECKPOINT_DISABLE=1
COPY --from=migrate-deps /app/node_modules ./node_modules
COPY --from=migrate-deps /app/package.json ./
COPY prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/
COPY prisma/migrations ./prisma/migrations
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---- run: the standalone server only. Root-owned files the node user can read but not change;
# compose adds a read-only root filesystem with tmpfs for Next's cache.
FROM ${NODE_IMAGE} AS run
# Fixed labels only (the commit is in the published tag and its provenance record, not here).
LABEL org.opencontainers.image.source="https://github.com/D0NM3GA/FamilyOS" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
USER node
EXPOSE 3000
# Better Auth's own health route (it doesn't touch the database); slim has no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/auth/ok').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
