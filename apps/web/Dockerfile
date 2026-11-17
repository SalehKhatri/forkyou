# syntax=docker/dockerfile:1
# ForkYou web app as a container, for `docker compose` and self-hosting. forkyou.dev runs the web
# app on Vercel instead (docs/deployment.md). Build context: the repository root.
#   docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:4000 -t forkyou-web .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Fetch dependencies from the lockfile alone, so editing source doesn't invalidate this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
# Next.js bakes the /api rewrite destination into the build, so the API address is a build
# argument, not just a runtime variable. NEXT_OUTPUT switches on the self-contained server.
ARG API_URL=http://api:4000
ENV API_URL=$API_URL NEXT_OUTPUT=standalone
RUN pnpm --filter "@forkyou/web..." build

FROM node:24-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/SalehKhatri/forkyou" \
      org.opencontainers.image.description="ForkYou web app" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Next.js writes its fetch and image caches here at runtime; everything else stays read-only.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
# /login renders without the API (getMe() never throws), so this checks the web server alone.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --start-interval=2s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
