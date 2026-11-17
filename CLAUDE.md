# CLAUDE.md

@AGENTS.md

AGENTS.md has the project rules (contract, API, database, web, style). This file covers **how to
work** in this repo: workflow, tests, docs, CI/CD, git, and what being an open-source project means.
If the two ever disagree, AGENTS.md wins for code rules; flag the conflict.

## This project is open source

Treat every change as public and permanent. Anything committed (code, comments, tests, docs, commit
messages, git history) can be read, forked and archived by anyone.

- **No secrets, ever.** No API keys, tokens, OAuth credentials, connection strings with passwords,
  or `.env` contents in code, tests, docs, logs or commit messages. Use placeholders
  (`fy_example`, `postgres://localhost:5432/forkyou_v2`). If you find a committed secret, stop and
  tell the user: it must be rotated, and removing it from history isn't enough.
- **No real people's data.** Fixtures and examples use made-up users (`ada`, `linus`, `demo`). No
  real emails, GitHub ids of real accounts, production rows or screenshots with user data.
- **No private context.** Don't mention internal hosts, private dashboards, personal emails or
  machine-specific paths in committed files. Domains: `forkyou.dev` (ours) or `example.com`.
- **Privacy promises are public.** `docs/extensions.md` → _Privacy_ says what extensions collect.
  Collecting anything new (a field, a header, telemetry) needs an ADR and a docs update first, and is
  opt-in. Never log API keys, session tokens or request bodies.
- **The project is MIT-licensed** (`LICENSE`). Every package declares `"license": "MIT"`; new
  packages must too. Don't copy code from projects with incompatible licenses, and keep the
  copyright line in `LICENSE` unchanged.
- **Dependencies are a public liability.** Before adding one: check that it's maintained and that
  its license is MIT-compatible (MIT, BSD, ISC, Apache-2.0 are fine; flag GPL, AGPL, SSPL, BUSL or
  "non-commercial" licenses to the user rather than adding them), and prefer the standard library or
  what's already installed. Say why it's needed in the PR.
- **Security issues aren't discussed in public.** If you find a vulnerability, report it to the user
  privately. Don't describe it in commit messages, issues or PR titles until it's fixed.
- **Write for strangers.** Contributors won't have this conversation's context. Code, errors, docs
  and commit messages must make sense to someone new to the project.

## Workflow

1. **Understand first.** Read the relevant code and docs (`docs/architecture.md`, the ADRs) before
   changing anything. Follow existing patterns; don't introduce a second way of doing something.
2. **Plan non-trivial work.** For anything beyond a small fix, outline the approach, the files
   you'll touch, and any contract, schema or doc changes, and agree on it before writing code.
3. **Bugs start with a failing test.** Reproduce the bug in a test, watch it fail, then fix it. The
   test stays as a regression guard.
4. **Small, focused changes.** One concern per change. No drive-by refactors, reformatting or
   renames mixed into a feature or fix. Suggest them separately.
5. **Verify.** Run `pnpm check` (lint, typecheck, test, build). For UI changes, also run the app
   (`pnpm dev`, seeded with `pnpm --filter @forkyou/api db:seed`) and look at the page.
6. **Report honestly.** Say what you ran and what happened. If something failed, was skipped or
   couldn't be verified (e.g. Postgres or Docker not running), say so plainly. Never claim "tests
   pass" without running them.

Ask the user before: changing the wire contract in a non-additive way, adding a dependency, adding
an env var or secret, changing CI/CD, deleting data or migrations, or reversing a decision recorded
in an ADR.

## Tests

The bar: a change without tests isn't done. Tests are documentation of behaviour for contributors.

- **What to test:** every service function's rules, every endpoint's success and failure paths
  (401, 400, 404, rejection reasons), every bug fix (regression test), and pure helpers.
- **Where:** API integration tests in `apps/api/test/*.test.ts`; unit tests next to the source as
  `*.test.ts` (`packages/shared`, `apps/web/src/lib`).
- **Real Postgres, no DB mocks.** Use `apps/api/test/helpers.ts` (`setupTestDb`, `makeApp`,
  `createUserWithKey`, `createUserWithSession`, `session()`).
- **Deterministic.** Use the fixed `NOW` and `deps.now`, never the real clock. No network: GitHub is
  faked via `fakeGithub()`. No sleeps or timing assumptions. Tests must pass in any order.
- **Readable.** Test names state the behaviour ("rejects sessions overlapping ones already stored").
  Arrange, act, assert, with no logic or loops in assertions. Assert on exact values, not just status codes.
- **Never weaken a test to make it pass.** Don't delete assertions, loosen matchers, add `.skip`,
  or raise timeouts to get green. If a test is wrong, explain why before changing it.
- Run one file while iterating (`pnpm --filter @forkyou/api exec vitest run test/ingest.test.ts`),
  then the full suite before finishing.

## Documentation

Docs are part of the change, not a follow-up. Update them in the same change:

| You changed…                                            | Update                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A request/response shape, endpoint, limit or error code | `docs/api.md` (+ `packages/shared`)                                                    |
| The database schema                                     | `docs/data-model.md` + a generated migration                                           |
| Extension behaviour or what is collected                | `docs/extensions.md` (+ an ADR if collection changes)                                  |
| Setup, scripts or env vars                              | `docs/development.md`, the relevant `.env.example`, `README.md` if it's in quick start |
| Deployment, CI, secrets, infrastructure                 | `docs/deployment.md`                                                                   |
| Architecture or a significant trade-off                 | `docs/architecture.md` and a new ADR in `docs/adr/`                                    |
| Rules for contributors or agents                        | `AGENTS.md` (code rules) or this file (workflow)                                       |

Writing style:

- Short sentences, active voice, concrete examples. Show a real request or command rather than
  describing it.
- Every command in the docs must actually work when copy-pasted from the repo root.
- Explain _why_ when a rule isn't obvious. Contributors follow rules they understand.
- ADRs are numbered `NNNN-kebab-title.md`, follow the existing format (Context / Decision /
  Consequences), and are never rewritten after acceptance. Supersede them with a new ADR.
- Code comments explain intent and invariants, not mechanics. Public service functions get a doc
  comment stating their guarantees (see `ingestSessions`).

## CI/CD

- **CI must stay green.** `.github/workflows/ci.yml` runs `lint:ci`, build, typecheck and tests
  against Postgres, plus a Docker build of the API. Anything that passes locally but fails in CI is
  a bug to fix, not to bypass.
- **Never bypass checks:** no `--no-verify`, no disabling a job or test to get a merge through, no
  `continue-on-error` on required steps.
- **Workflows are code.** Changes to `.github/workflows/` need the user's approval. Keep
  `permissions:` minimal, pin third-party actions to a major version (or a commit SHA for anything
  outside `actions/*` and `docker/*`), and never echo secrets.
- **Secrets live in GitHub Environments**, never in workflow files. A new secret means updating
  `docs/deployment.md` with its name, purpose and where to set it.
- **Deploys only from `main`, after CI.** `deploy-api.yml` publishes the API image; Vercel deploys the
  web app. Don't add manual deploy steps or deploy from branches.
- **Migrations must be rollback-safe.** The previous API version must keep working against the new
  schema. Use expand → migrate → contract: add columns as nullable or with defaults, ship code that
  stops using a column, and only then drop it in a later release.
- **Docker image:** keep it slim and non-root (`USER node`); the build context is the repo root.
  If you change the build, check `pnpm deploy --filter @forkyou/api --prod --legacy <dir>` still
  produces `dist/`, `drizzle/` and production `node_modules`.

## Git and pull requests

- Never commit directly to `main`. Branch as `feat/…`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`.
- **Conventional Commits:** `feat(api): add presence heartbeat`, `fix(web): …`, `docs: …`,
  `test(api): …`, `chore(deps): …`. Scopes: `api`, `web`, `shared`, `ci`, `docs`. Mark breaking
  contract changes with `!` and a `BREAKING CHANGE:` footer.
- Commit messages explain _why_, not just what. No secrets, no internal links, no private details.
- Fill in `.github/pull_request_template.md`. Keep PRs reviewable (roughly under 400 changed lines
  excluding generated files); split larger work.
- Only commit, push, open PRs or create releases when the user asks. Never force-push shared
  branches or rewrite published history.
- Don't commit generated or local files: `dist/`, `.next/`, `.turbo/`, `.env*` (except
  `.env.example`), editor settings, or OS files.

## Code quality

- Match the surrounding code. The best change looks like it was always there.
- Prefer deleting code to adding it. No dead code, commented-out code, or unused exports.
- No `TODO` without a linked issue. No `console.log` debugging left behind; intentional logs are
  `console.error`/`console.warn` with context and no secrets or personal data.
- Handle errors at the boundary with the standard envelope. Don't swallow errors silently.
- Accessibility and both colour schemes are requirements, not polish, for any UI change.
- Performance: no N+1 queries, and keep new indexes in line with real queries. Measure before
  optimising, and record the measurement in the PR or ADR.

## Local environment notes

- Tests need Postgres (`pg_isready`, or `docker compose up -d postgres`). If it isn't running, say so; never
  skip the tests.
- `pnpm --filter @forkyou/api db:seed` creates demo users and prints an API key and a session
  cookie, so you can use the app without GitHub OAuth.
- After editing `packages/shared`, rebuild it or run through turbo; consumers import its `dist`.
