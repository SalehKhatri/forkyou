# AGENTS.md

Instructions for AI coding agents (and humans) working in this repository. Read this before
making changes. `CLAUDE.md` imports this file.

## Project

ForkYou tracks coding time from editor extensions. Three parts:

| Path              | What                                      | Stack                                         |
| ----------------- | ----------------------------------------- | --------------------------------------------- |
| `apps/api`        | Ingestion, auth, stats, presence          | Hono on Node, Drizzle ORM, PostgreSQL, Zod    |
| `apps/web`        | Landing, leaderboard, dashboard, settings | Next.js 16 (App Router), React 19, Tailwind 4 |
| `packages/shared` | Wire contract used by every client        | Zod 4 schemas, types, constants               |

Architecture and reasoning: `docs/architecture.md` and `docs/adr/`.

## Commands

Run from the repository root.

```bash
pnpm install          # install everything
pnpm dev              # api :4000 + web :3000
pnpm check            # lint + typecheck + test + build. Must pass before you say you're done.
pnpm test             # needs Postgres; uses TEST_DATABASE_URL (default forkyou_v2_test)
pnpm lint:fix         # Biome: format + safe lint fixes
pnpm db:generate      # migration from schema.ts changes (never hand-write migrations)
pnpm db:migrate       # apply migrations to DATABASE_URL
```

Run a single package: `pnpm --filter @forkyou/api test`, `pnpm --filter @forkyou/web typecheck`.
Run a single test file: `pnpm --filter @forkyou/api exec vitest run test/ingest.test.ts`.

## Rules

### Contract first

- Every request/response shape lives in `packages/shared/src/schemas.ts`; every limit in
  `packages/shared/src/constants.ts`. The API validates with them and the web imports their types.
  Don't redefine shapes locally.
- A contract change is a breaking change for shipped extensions unless it's additive. Prefer adding
  optional fields. Document every change in `docs/api.md`.
- After editing `packages/shared`, rebuild it (`pnpm --filter @forkyou/shared build`) or run
  through turbo (`pnpm build`/`pnpm dev`), because consumers import its compiled `dist`.

### API (`apps/api`)

- Handlers stay thin: validate (`validate()` from `src/lib/validate.ts`), call a function in
  `src/services/`, return JSON. Business logic goes in services and takes `db` (and `now`) as
  arguments so it can be tested directly.
- Errors: throw `AppError(status, code, message)`. Every non-2xx response uses the envelope
  `{ "error": { "code", "message" } }`. Never leak stack traces or SQL.
- Time: use `c.var.deps.now()` in handlers, never `new Date()` directly, so tests can control the clock.
- Auth: `requireAuth("apiKey")` for editor endpoints, `requireAuth("session")` for web-only
  endpoints, both when either is fine. API keys must never be able to create API keys.
- Secrets: store only SHA-256 hashes of tokens and keys (`src/lib/crypto.ts`). Plaintext API keys
  are returned once, at creation.
- No CORS. Browsers reach the API only via the web app's `/api` rewrite. Don't add CORS
  middleware; it would expose the cookie-authenticated endpoints.
- ESM with `NodeNext` resolution: relative imports need the `.js` extension
  (`import { x } from "./foo.js"`), also in `packages/shared`.

### Database

- Schema: `apps/api/src/db/schema.ts`. Change it, then `pnpm db:generate`, then commit the
  generated SQL and `drizzle/meta`. Never edit a migration that has been merged.
- Invariants the code relies on (see `docs/data-model.md`): a user's coding sessions never
  overlap; `coding_sessions.id` is client-generated and globally unique; one user per GitHub id.
- Ingestion takes a per-user advisory lock. Keep any new write path to `coding_sessions` inside
  `ingestSessions` so the overlap guarantee holds.

### Web (`apps/web`)

- Server components fetch through `src/lib/api.server.ts` (forwards cookies). Client components
  call `api()` from `src/lib/api.client.ts`, which goes through `/api`.
- Next 16: `cookies()`, `headers()`, `params` and `searchParams` are async, so `await` them.
- Styling: Tailwind using the design tokens in `src/app/globals.css` (`bg-surface`, `text-muted`,
  `bg-accent`, …). Don't hardcode colours; both light and dark must work.
- Reuse primitives from `src/components/ui.tsx` before creating new ones. Keep components accessible:
  labels on inputs, ARIA roles where Biome asks, keyboard reachable.

### Tests

- New behaviour needs tests. API tests run against a real Postgres. Don't mock the database.
  Use helpers in `apps/api/test/helpers.ts` (`setupTestDb`, `makeApp`, `createUserWithKey`,
  `session`, fixed `NOW`).
- Tests truncate all tables between cases; the setup refuses database names without "test".
- Pure logic (formatting, schema rules) gets unit tests next to the file (`*.test.ts`).

### Style

- Biome formats and lints (`biome.json`). 2-space indent, double quotes, 100-column lines.
- TypeScript strict with `noUncheckedIndexedAccess`. No `any`; no non-null `!` unless the
  invariant is obvious and local.
- Comments explain _why_, not what. Keep the doc comments on services accurate when behaviour changes.

## Definition of done

1. `pnpm check` passes.
2. Tests cover the change, including the failure path.
3. Docs updated if you changed behaviour, the API contract, setup, env vars or deployment:
   `docs/api.md`, `docs/data-model.md`, `docs/development.md`, `docs/deployment.md`, `.env.example`.
4. Significant design decisions get a short ADR in `docs/adr/` (copy the format of an existing one).

## Don'ts

- Don't add features that 2.0 deliberately cut (colleges, devlogs, experience, "wrapped", roles)
  without an ADR. Keeping scope small is a goal.
- Don't reintroduce shared-secret request signing in extensions. Secrets shipped in a client are
  public (ADR 0002).
- Don't add Redis, queues or rollup tables until there's a measured need (ADR 0003).
- Don't commit `.env` files, real API keys or production data.
- Don't upgrade TypeScript to 7.x yet: Next.js and tooling still need the 6.x JS API.
