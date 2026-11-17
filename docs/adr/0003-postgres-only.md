# 0003: Postgres only; no Redis, queues or rollups (for now)

**Status:** accepted · **Date:** 2026-11-16

## Context

1.x buffered sessions in Redis and flushed them to Postgres on a cron. That introduced a
read-modify-write race (lost data under concurrent syncs), an O(N) `KEYS` scan, and a second
datastore to run, for a write rate Postgres handles easily (clients already batch every 60 s).

## Decision

- Write sessions directly to Postgres in one transaction per batch.
- Compute stats and leaderboards from `coding_sessions` on read, with indexes on
  `(user_id, started_at)` and `started_at`.
- Cache the leaderboard for 30 s in-process (`TtlCache`) and in Next.js.
- Store presence as columns on `users`.

## Consequences

- One datastore, one source of truth, transactional ingestion.
- The in-process cache is per instance. With more than one API instance, clients may briefly see
  slightly different leaderboards (≤ 30 s). Acceptable.

## Revisit when

- Leaderboard or stats queries exceed ~100 ms p95 → add a `daily_stats` rollup maintained in the
  ingest transaction.
- More than one API instance needs a shared cache, or presence writes become significant → add Redis.
