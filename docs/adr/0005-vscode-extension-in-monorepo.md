# 0005: VS Code extension 2.0 lives in the monorepo and replaces 1.x in place

**Status:** accepted · **Date:** 2026-11-17

## Context

ForkYou 1.x for VS Code (`ForkYou.forkyou`, about 2,000 installs) lived in a separate repository.
It calls endpoints that now return `410`, signs requests with a shared secret
([ADR 0002](0002-no-request-signing.md)), sends file paths, keeps its API key in plain
`globalState` and holds unsynced activity in memory only. Fixing it means replacing nearly every
file, so 2.0 is a rewrite.

## Decision

- The extension lives in `extensions/vscode` in this repository and bundles `@forkyou/shared`
  with esbuild, so it validates against the same schemas and limits as the API. A contract change
  and the extension change that follows it can land in one pull request.
- It ships as **2.0.0 under the same Marketplace ID**, so 1.x users get it as an automatic update.
  On first start, 2.0 deletes the 1.x key from `globalState` without sending it anywhere and asks
  for a new key.
- The API key lives in `SecretStorage` (the OS keychain).
- `forkyou.apiUrl` is an application-scoped setting (user settings only) and must be HTTPS, or HTTP
  to localhost. A cloned repository's `.vscode/settings.json` can't redirect the key, and a typo
  can't send it unencrypted.
- Session logic, the queue and the API client are plain TypeScript with no `vscode` import, so
  they're unit-tested with Vitest like the rest of the repo. `extension.ts` only wires them to
  editor events.
- Every VS Code window runs its own extension host and they share `globalState`. Each window
  therefore keeps its own queue and adopts the queues of windows that stopped updating theirs.
  Adopting a queue can resend sessions; the server recognises them as duplicates by id. It can
  never lose them.

## Consequences

- 2.0 must not be published until the 2.0 API is reachable at `forkyou.dev`: auto-update moves
  every 1.x user at once.
- Extensions are part of `pnpm check`, so a contract change that breaks the extension fails CI.
- The bundle includes Zod (about 450 KB minified). Acceptable for now; `zod/mini` is the option if
  size matters.
- With two windows open, each sends presence. An idle window can briefly mark the user offline
  while they code in another, until the next heartbeat (≤ 60 s). Accepted for now.
