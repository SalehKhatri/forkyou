# 0006: Roll sessions up into daily_stats for the leaderboard

**Status:** accepted · **Date:** 2026-11-17

## Context

[ADR 0003](0003-postgres-only.md) computes every read from `coding_sessions` and says to add a
`daily_stats` rollup once leaderboard or stats queries pass ~100 ms at p95.

Load testing with 2,000 users and 30 days of sessions (2.37 million rows) on VPS-sized containers
([performance.md](../performance.md)) measured:

- leaderboard query: **400 ms** for the week and **550 ms** for the month, growing linearly with the
  number of sessions;
- personal stats: 6–35 ms, thanks to the `(user_id, started_at)` index.

Serving the cached leaderboard while it refreshes (the change before this ADR) means no request
waits for that query any more, but the query still runs every 30 seconds per range, and its cost
would keep growing with history. ForkYou 1.x's leaderboard became slow exactly this way.

## Decision

- Add **`daily_stats(user_id, day, language, seconds)`**, keyed by user, the **UTC day** a session
  started and language.
- **`ingestSessions` maintains it** in the same transaction that inserts sessions, under the
  existing per-user advisory lock, from the rows the insert actually returned. It therefore always
  equals the sum of `coding_sessions`, and duplicates or rejected sessions never touch it.
- **The leaderboard** reads whole days from `daily_stats` and only the partial day its rolling
  window starts in from `coding_sessions`. The totals are exactly the same as summing every session
  in the window; tests compare the two around the window's edges.
- **Personal stats stay on `coding_sessions`.** They bucket by the user's own time zone, which a
  UTC rollup can't do exactly, and they're already fast.
- A migration backfills existing sessions; `db:rebuild-rollups` (`rebuildDailyStats`) recomputes
  the table from scratch if it ever drifts.

## Consequences

- The month leaderboard query went from 550 ms to 49 ms and the week from 400 ms to 19 ms on the
  same data. Its cost now grows with users × active days × languages (336k rollup rows for 2.37M
  sessions), not with sessions.
- Each upload does one extra small upsert. Storage: about 42 MB of rollup per 2.4M sessions.
- A second write path now encodes "what counts": anything that changes stored sessions must go
  through `ingestSessions` (already a rule in AGENTS.md) or be followed by a rebuild.
- Rolling back to an API version older than this ADR and forward again leaves sessions stored in
  between out of the rollup. `docs/deployment.md` says to run `db:rebuild-rollups` after such a
  rollback.
- Projects aren't in the rollup; the leaderboard doesn't need them. A future per-project or
  per-editor leaderboard would extend the key.
