# Development

## Run everything with Docker

If you only want to try the app, or work on something without installing Node and Postgres:

```bash
docker compose up --build        # web http://localhost:3000, api http://localhost:4000
docker compose run --rm seed     # demo users; prints an API key and a session cookie
docker compose down              # stop; add -v to also delete the database
```

- Data lives in the `forkyou_pgdata` volume and survives `down`/`up`.
- Ports are bound to `127.0.0.1` only. If one is taken (say, you also run Postgres natively), set
  `POSTGRES_PORT`, `API_PORT` or `WEB_PORT` in a `.env` file at the repo root.
- GitHub login: create an OAuth app as described [below](#github-oauth-for-real-login) and put
  `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in that same root `.env`.
- The images rebuild only with `--build`. After pulling changes, run `docker compose up --build`.

The stack runs the production images (`apps/api/Dockerfile`, `apps/web/Dockerfile`), so it doesn't
hot-reload. For day-to-day development, use the setup below.

## Prerequisites

- Node 24 (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable`)
- PostgreSQL 17: native (`brew install postgresql@17`), or `docker compose up -d postgres` from
  the repo root

## First-time setup

```bash
pnpm install

# Databases (native Postgres). With Docker, `docker compose up -d postgres` creates both;
# use the forkyou:forkyou URLs from docker-compose.yml in your .env.
createdb forkyou_v2
createdb forkyou_v2_test

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

pnpm db:migrate
pnpm dev            # web http://localhost:3000, api http://localhost:4000
```

### GitHub OAuth (for real login)

1. Go to https://github.com/settings/developers → **New OAuth App**.
2. Homepage URL: `http://localhost:3000`
3. Authorization callback URL: `http://localhost:3000/api/auth/github/callback`
   (through the web proxy, so the cookie is set on the web origin).
4. Put the client id and secret in `apps/api/.env` and restart `pnpm dev`.

Without these, the app runs but "Continue with GitHub" returns `503 oauth_unconfigured`.

### Testing without GitHub

```bash
pnpm --filter @forkyou/api db:seed
```

This creates demo users with a week of sessions and prints an API key and a session cookie. Set the
cookie in DevTools (Application → Cookies → `fy_session`) to browse as the demo user, and use the
key with curl:

```bash
curl -H "Authorization: Bearer fy_…" http://localhost:4000/v1/me
```

## Everyday commands

| Command                                         | Notes                                                         |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                                      | Turbo builds `packages/shared` first, then watches everything |
| `pnpm check`                                    | What CI runs. Run it before pushing.                          |
| `pnpm test`                                     | All packages. API tests need `TEST_DATABASE_URL`.             |
| `pnpm --filter @forkyou/api test:watch`         | API tests in watch mode                                       |
| `pnpm --filter @forkyou/api db:studio`          | Drizzle Studio (browse the DB)                                |
| `pnpm --filter @forkyou/api db:rebuild-rollups` | Recompute `daily_stats` from `coding_sessions`                |
| `pnpm --filter @forkyou/api leaderboard list`   | Accounts hidden from the leaderboard (`hide`, `show` too)     |
| `pnpm lint:fix`                                 | Format and autofix                                            |

## Tests

- **API** (`apps/api/test/`): integration tests against a real Postgres. Each test starts from empty
  tables, the clock is fixed (`NOW` in `helpers.ts`), and GitHub is faked. The setup refuses to run
  against a database whose name doesn't contain `test`.
- **Shared** (`packages/shared/src/*.test.ts`): schema rules.
- **Web** (`apps/web/src/**/*.test.ts`): pure helpers (formatting).

## Making changes

**Contract change** (request/response shape or limit):

1. Edit `packages/shared/src/schemas.ts` or `constants.ts`.
2. Update the API handler or service, then the web usage.
3. Update `docs/api.md`. Is it additive? If not, read "Versioning" there first.

**Schema change**:

1. Edit `apps/api/src/db/schema.ts`.
2. `pnpm db:generate`, review the SQL, `pnpm db:migrate`.
3. Commit `apps/api/drizzle/` with the change. Update `docs/data-model.md`.

**New environment variable**: add it to `apps/api/src/env.ts` (validated at startup), the right
`.env.example`, and `docs/deployment.md`.

## VS Code extension

Run the dev build in a separate VS Code profile, so it doesn't touch your settings or clash with
ForkYou from the Marketplace. Create the profile once, pointing the extension at your local server:

```bash
mkdir -p ~/.forkyou-vscode-dev/user-data/User
echo '{ "forkyou.apiUrl": "http://localhost:3000/api" }' > ~/.forkyou-vscode-dev/user-data/User/settings.json
```

Then, with `pnpm dev` running:

```bash
pnpm --filter forkyou dev        # rebuild the extension on change (its own terminal)
code --user-data-dir ~/.forkyou-vscode-dev/user-data \
  --extensions-dir ~/.forkyou-vscode-dev/extensions \
  --extensionDevelopmentPath="$PWD/extensions/vscode" --new-window
```

Run **ForkYou: Configure API Key** with a key from `db:seed` or Settings. Logs are under
**ForkYou: Show Log**. Run **Developer: Reload Window** to pick up a rebuild.

- Run `code` from a regular terminal. In VS Code's integrated terminal it hands the request to the
  current window, which ignores `--user-data-dir`.
- Keep the profile path short. VS Code puts a socket in it, and macOS limits socket paths to about
  100 characters; with a longer path VS Code exits without an error.
- `forkyou.apiUrl` only works in user settings (it's ignored in workspace settings), which is why
  it goes in the profile.

`pnpm --filter forkyou package` builds `extensions/vscode/forkyou-<version>.vsix`, which you can
install with `code --install-extension <file>`.

## Troubleshooting

| Symptom                                               | Fix                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `Cannot find module '@forkyou/shared'` or stale types | `pnpm --filter @forkyou/shared build` (turbo does this for `dev`/`build`)   |
| Tests fail with connection refused                    | Postgres isn't running, or `forkyou_v2_test` doesn't exist                  |
| `Invalid environment` on API start                    | A variable in `apps/api/.env` is missing or malformed; the message names it |
| Login redirects to `/login?error=state`               | The OAuth state cookie expired (10 min) or cookies are blocked; retry       |
| Dashboard redirects to `/login`                       | Not signed in, or the API isn't running on `API_URL`                        |
