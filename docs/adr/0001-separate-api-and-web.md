# 0001: Separate API service and Next.js web app

**Status:** accepted · **Date:** 2026-11-16

## Context

ForkYou 1.x used a NestJS API plus a Next.js frontend with nine feature modules. For 2.0 we
considered (a) one Next.js app with route handlers as the backend, or (b) a Next.js frontend plus a
small dedicated API.

The core workload is ingestion: editor extensions posting batches every minute, presence heartbeats,
and aggregation queries. It needs a long-lived DB pool, an in-process cache and per-user locking,
which fit a long-running server better than serverless route handlers.

## Decision

Two apps in one pnpm/Turborepo monorepo:

- `apps/api`: Hono on Node (small, fast, Web-standard `Request`/`Response`, easy to test with
  `app.request()`), Drizzle ORM, Postgres. Deployed as a container.
- `apps/web`: Next.js, read-only against the API, deployed on Vercel.
- `packages/shared`: the Zod contract both sides (and extensions) use.

The web app proxies `/api/*` to the API so browsers see a single origin.

## Consequences

- Two deploy targets, but each is simple and independently scalable.
- No CORS anywhere; cookies are first-party.
- NestJS's DI and module system are gone. Dependencies are passed explicitly (`createApp(deps)`),
  which keeps tests simple.
