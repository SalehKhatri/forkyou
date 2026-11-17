# ForkYou

Track the time you actually spend coding, straight from your editor. See where it goes, climb the
leaderboard, and see who's coding right now.

This is **ForkYou 2.0**, a ground-up rewrite. It keeps the core (editor plugins → ingestion → stats),
cuts everything else, and fixes the reliability problems of 1.x.

> [!NOTE]
> **Status: pre-release.** The API and web app run locally, natively or with `docker compose up`
> (see [Quick start](#quick-start)). Editor extensions and the hosted service at `forkyou.dev`
> aren't available yet. Until they are, the seed command generates demo data.

## How it works

```
VS Code / JetBrains / Neovim ──(API key)──▶  API (Hono)  ──▶  PostgreSQL
                                                 ▲
Browser ──▶  Web (Next.js)  ──/api/* proxy───────┘
```

- **Editor extensions** record coding sessions and send them in batches, plus a presence heartbeat.
- **API** validates sessions (no overlaps, no future time), stores them idempotently, and serves
  stats, the leaderboard and who's online.
- **Web** shows your dashboard, the leaderboard and settings. It talks to the API through a
  same-origin `/api` proxy.

Details: [docs/architecture.md](docs/architecture.md).

## Quick start

**With Docker** (nothing else to install):

```bash
docker compose up --build        # web → http://localhost:3000, api → http://localhost:4000
docker compose run --rm seed     # demo users; prints an API key and a browser session cookie
```

**For development** you need Node 24 (`.nvmrc`), pnpm 10 and PostgreSQL 17 (native, or
`docker compose up -d postgres`):

```bash
pnpm install
createdb forkyou_v2 && createdb forkyou_v2_test     # or: docker compose up -d postgres
cp apps/api/.env.example apps/api/.env              # add GitHub OAuth credentials to enable login
cp apps/web/.env.example apps/web/.env.local
pnpm db:migrate
pnpm dev                                            # web → :3000, api → :4000
```

Full setup, including the GitHub OAuth app: [docs/development.md](docs/development.md).

## Scripts

| Command                       | What it does                                                   |
| ----------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                    | Run API and web in watch mode                                  |
| `pnpm check`                  | Everything CI runs: lint, typecheck, test, build               |
| `pnpm test`                   | Unit and integration tests (needs the test database)           |
| `pnpm lint` / `pnpm lint:fix` | Biome lint and format check / autofix                          |
| `pnpm db:generate`            | Create a migration from changes to `apps/api/src/db/schema.ts` |
| `pnpm db:migrate`             | Apply migrations to `DATABASE_URL`                             |

## Repository layout

```
apps/api          Hono API: ingestion, auth, stats, presence (Node, Drizzle, Postgres)
apps/web          Next.js app: landing, leaderboard, dashboard, settings
packages/shared   Wire contract: Zod schemas, types and limits shared by every client
extensions/vscode VS Code extension (published as ForkYou.forkyou)
docs/             Architecture, API reference, data model, development, deployment, ADRs
```

## Documentation

- [Architecture](docs/architecture.md): components, request flows, design principles
- [API reference](docs/api.md): endpoints, auth, errors, limits
- [Data model](docs/data-model.md): tables and invariants
- [Extension protocol](docs/extensions.md): what an editor plugin must do
- [Development](docs/development.md): local setup, testing, migrations
- [Deployment](docs/deployment.md): CI/CD, environments, secrets
- [Decision records](docs/adr/): why things are the way they are

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and please follow the
[code of conduct](CODE_OF_CONDUCT.md). Found a security issue? See [SECURITY.md](SECURITY.md) and
report it privately.

## License

[MIT](LICENSE) © Saleh Khatri
