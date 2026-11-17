# syntax=docker/dockerfile:1
# ForkYou API. Build context: the repository root.
#   docker build -f apps/api/Dockerfile -t forkyou-api .
# On start it applies pending migrations, then serves on $PORT. Needs DATABASE_URL; the other
# variables are listed in apps/api/.env.example. `docker compose up` (repo root) wires it all up.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Also used directly by the compose `seed` service: it has the full source and dev dependencies.
FROM base AS build
# Fetch dependencies from the lockfile alone, so editing source doesn't invalidate this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@forkyou/api..." build
# Self-contained production bundle: dist + drizzle migrations + prod node_modules.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter @forkyou/api --prod --legacy /out

FROM node:24-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/SalehKhatri/forkyou" \
      org.opencontainers.image.description="ForkYou API" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production PORT=4000
# Owned by root and only readable by the app user: nothing at runtime writes to the app directory.
COPY --from=build /out .
USER node
EXPOSE 4000
# Probe every 2 s while starting so `depends_on: service_healthy` doesn't wait a full interval.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --start-interval=2s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations are idempotent and run before every start. `exec` makes node PID 1, so it receives
# SIGTERM from `docker stop` and shuts down gracefully instead of being killed after 10 s.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node --enable-source-maps dist/index.js"]
