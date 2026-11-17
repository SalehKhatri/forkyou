# Contributing to ForkYou

Thanks for helping out! ForkYou is a small project maintained by one person, so clear, focused
contributions get merged fastest.

## Before you start

- **Bugs:** search the [issues](../../issues) first, then open one using the bug template.
- **Features:** open an issue to discuss it **before** writing code. ForkYou 2.0 deliberately keeps
  a small scope (see [docs/architecture.md](docs/architecture.md) → "What's deliberately not here"),
  so not every good idea fits. Agreeing first saves you wasted work.
- **Security problems:** don't open a public issue. See [SECURITY.md](SECURITY.md).
- **Small fixes** (typos, docs, obvious bugs) can go straight to a pull request.

## Development setup

Follow [docs/development.md](docs/development.md). In short:

```bash
pnpm install
createdb forkyou_v2 && createdb forkyou_v2_test   # or: docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:migrate
pnpm --filter @forkyou/api db:seed                # demo data; no GitHub app needed
pnpm dev
```

Before writing code, read [AGENTS.md](AGENTS.md). It holds the project's code rules (contract first,
thin handlers, real-database tests, and so on). It's written for AI agents, but it's the most concise
guide for humans too.

## Making a change

1. Fork the repo and create a branch: `feat/…`, `fix/…`, `docs/…`, `chore/…` or `refactor/…`.
2. Keep the change focused on one thing. Unrelated cleanups go in a separate PR.
3. **Add tests.** New behaviour needs tests, and bug fixes need a test that failed before the fix.
   API tests run against a real Postgres; see `apps/api/test/helpers.ts`.
4. **Update docs** in the same PR when you change behaviour, the API, setup or deployment. The table
   in [CLAUDE.md](CLAUDE.md) → _Documentation_ lists which file covers what.
5. Run the full check. CI runs exactly the same:

   ```bash
   pnpm check   # lint, typecheck, test, build
   ```

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add presence heartbeat endpoint
fix(web): show leaderboard empty state on first load
docs: explain session overlap rule
```

Scopes: `api`, `web`, `shared`, `ci`, `docs`. Breaking changes to the API contract use `!`
(`feat(api)!: …`) and a `BREAKING CHANGE:` footer explaining the migration.

## Pull requests

- Fill in the PR template, including how you tested the change.
- Keep PRs small: under about 400 changed lines (excluding generated files) gets reviewed fastest.
- CI must pass. Don't disable checks or tests to make it green; ask for help instead.
- Be patient: this is a solo-maintained project, so reviews may take a few days.

## Using AI assistants

AI tools are welcome. `AGENTS.md` and `CLAUDE.md` exist so they follow the project's conventions.
You're responsible for what you submit: read and understand every line, make sure the tests are
meaningful, and don't submit code you couldn't explain in review.

## Licensing

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE). Only submit code you have the right to contribute, and don't copy code from
projects with incompatible licenses.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind and assume good faith.
