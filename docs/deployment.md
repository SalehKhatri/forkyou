# Deployment

## Topology

| Piece            | Where                                      | How it deploys                                                                              |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Web (`apps/web`) | Vercel                                     | Vercel Git integration: previews per PR, production from `main`                             |
| API (`apps/api`) | Any Docker host (Railway, Render, Fly.io…) | `deploy-api.yml` publishes `ghcr.io/<owner>/forkyou-api`, then calls the host's deploy hook |
| Database         | Managed Postgres 17 (Neon, Supabase, RDS…) | Migrations run when the API container starts                                                |

The API is a long-running Node process (it holds an in-memory cache and a DB pool), so it's a
container, not serverless functions.

## Pipelines

```
PR opened ──▶ CI: lint · build · typecheck · test (Postgres service) · Docker build
              Vercel: preview deployment of the web app

merge to main ──▶ CI ──(success)──▶ Deploy API: build + push image ──▶ deploy hook
                └──▶ Vercel: production deploy of the web app
```

- `.github/workflows/ci.yml` must pass before merging. A ruleset on `main` requires the
  **Lint, typecheck, test, build** and **Docker images build** checks, a pull request (squash
  merge only, resolved review threads) and linear history, and blocks force-pushes.
- `.github/workflows/deploy-api.yml` runs only after CI succeeds on `main` (or by hand via
  _Run workflow_). It uses the `production` GitHub environment, which only accepts deploys from
  `main` and waits for a maintainer to approve each run.

## One-time setup

### 1. Database

Create a Postgres 17 database and note its connection string (with `?sslmode=require` if the
provider needs it).

### 2. GitHub OAuth app (production)

- Homepage: `https://forkyou.dev`
- Callback: `https://forkyou.dev/api/auth/github/callback`

Use a separate OAuth app per environment (local, preview, production).

### 3. API host

Point the service at the image `ghcr.io/<owner>/forkyou-api:latest` (make the package public, or
give the host a GHCR pull token). Health check path: `/health`. Port: `4000`.

| Variable                                    | Value                                          |
| ------------------------------------------- | ---------------------------------------------- |
| `NODE_ENV`                                  | `production`                                   |
| `PORT`                                      | `4000` (or the host's injected port)           |
| `DATABASE_URL`                              | production connection string                   |
| `WEB_URL`                                   | `https://forkyou.dev`                          |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | production OAuth app                           |
| `GITHUB_REDIRECT_URI`                       | `https://forkyou.dev/api/auth/github/callback` |

Then copy the host's **deploy hook URL** into the GitHub secret `API_DEPLOY_HOOK_URL` (repo →
Settings → Environments → `production`). Without it, the workflow still publishes the image and
skips the trigger.

### 4. Vercel (web)

- Import the repo, **Root Directory** `apps/web`. Vercel detects pnpm and Turborepo.
- Environment variable: `API_URL` = the API's public URL (e.g. `https://api.forkyou.dev`).
- Domain: `forkyou.dev`.

Both browsers and editor extensions use `https://forkyou.dev/api/...`; Next.js rewrites those
requests to `API_URL`.

### Self-hosting the web app (optional)

To run the web app somewhere other than Vercel, use its container image:

```bash
docker build -f apps/web/Dockerfile --build-arg API_URL=https://api.example.com -t forkyou-web .
docker run -p 3000:3000 -e API_URL=https://api.example.com forkyou-web
```

`API_URL` is needed at build time, because Next.js bakes the `/api` rewrite into the build, and at
runtime, for server-side fetches. Serve it over HTTPS: in production the session cookie is
`__Host-` + `Secure`. `docker-compose.yml` shows the full stack wired together.

## Releasing

1. Merge to `main`.
2. CI runs; on success the API image is published and deployed, and Vercel deploys the web app.
3. Check `https://forkyou.dev/api/health` → `{"status":"ok"}`.

## Rolling back

- **API**: redeploy the previous image tag (`ghcr.io/<owner>/forkyou-api:sha-<previous>`) on the host.
  Migrations are forward-only, so a rollback must be compatible with the current schema. That's why
  destructive schema changes ship in two steps (see `data-model.md`).
- **After rolling back past the `daily_stats` rollup** (ADR 0006) and forward again, the older
  version will have stored sessions without updating the rollup. Rebuild it once from a checkout
  (the API image doesn't ship scripts), with `DATABASE_URL` set to the production database:
  `pnpm --filter @forkyou/api db:rebuild-rollups`. It's safe while the API is running.
- **Web**: _Promote_ the previous deployment in Vercel.

## Logs

In production (`NODE_ENV=production`) the API writes one JSON object per line to stdout; locally
it prints short readable lines. Logs never contain API keys, cookies, request bodies, query strings,
IP addresses, usernames or user ids.

| `msg`                        | Fields                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `request`                    | `method`, `route` (pattern, e.g. `/v1/keys/:id`), `status`, `ms`, `requestId` |
| `ingest`                     | `accepted`, `duplicates`, `rejected` (count per reason), `requestId`          |
| `unhandled error`            | `error` (stack trace), `requestId`; the client got a `500`                    |
| `leaderboard refresh failed` | `range`, `error`; the stale leaderboard is still being served                 |

`/health` isn't logged. A `500` response's request id matches its `unhandled error` line.

With the log saved to `api.log` (most hosts can export or stream it), [`jq`](https://jqlang.org)
answers the usual questions:

```bash
# Requests per route
jq -r 'select(.msg=="request") | .route' api.log | sort | uniq -c | sort -rn

# p95 latency per route (ms)
jq -s 'map(select(.msg=="request")) | group_by(.route) | map({route: .[0].route, n: length,
  p95: (map(.ms) | sort | .[(length * 0.95 | floor)])})' api.log

# Share of 5xx responses
jq -s 'map(select(.msg=="request")) | (map(select(.status >= 500)) | length) / length' api.log

# Rejected sessions by reason
jq -s 'map(select(.msg=="ingest") | .rejected | to_entries[]) | group_by(.key)
  | map({reason: .[0].key, sessions: (map(.value) | add)})' api.log
```

Targets to alert on are in [#17](https://github.com/SalehKhatri/forkyou/issues/17);
[performance.md](performance.md) has the load-test numbers to compare against.

## Moderation

To keep an account off the public leaderboard ([ADR 0007](adr/0007-leaderboard-moderation.md)),
run from a checkout with `DATABASE_URL` set to the production database:

```bash
pnpm --filter @forkyou/api leaderboard hide <username> --reason "24 h a day for a week"
pnpm --filter @forkyou/api leaderboard list
pnpm --filter @forkyou/api leaderboard show <username>    # undo
```

It takes effect within a minute. The user keeps their stats and sees a notice on their dashboard
with the appeal address; the reason stays private. Check the `ingest` logs (rejection reasons) and
the user's sessions before hiding anyone.

## Operations checklist

- [x] Ruleset on `main` with required CI checks
- [x] `production` environment limited to `main`, with a required reviewer
- [ ] `API_DEPLOY_HOOK_URL` secret in the `production` environment
- [ ] Database backups enabled at the provider (point-in-time recovery if available)
- [ ] Uptime check on `/api/health`
- [ ] Watch for `410` traffic on legacy paths; remove `routes/legacy.ts` when it stops
