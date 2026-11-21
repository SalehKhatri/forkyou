# Performance

Load-test results for the API, newest last. Each run says what changed, so later runs can be
compared with earlier ones. How to rerun: [`apps/api/scripts/load/`](../apps/api/scripts/load/README.md).

## Setup

- **Data:** 2,000 users with 30 days of sessions (2.37 million rows, 550 MB with indexes), from
  `seed.sql`.
- **Machine:** Docker on a laptop, with limits roughly like a small VPS: API 1 CPU / 1 GB, Postgres
  1 CPU / 2 GB (default Postgres settings, so 128 MB `shared_buffers`).
- **Traffic** (`run.ts`): each simulated editor sends presence every 60 s and uploads 1–2 sessions
  every 3–5 minutes, each followed by a status-bar request (`/v1/me/stats?range=7d` until
  2026-11-20, `/v1/me/today` since). The web side requests the
  leaderboard (random range) and the online list at fixed rates. 800 clients ≈ 800 people coding at
  the same time, about 23 requests per second.
- `SPEED=5` multiplies every client's rate by 5, approximating 4,000 people coding at once.

Latencies are measured by the load generator, so they include the network hop to the container.

## 2026-11-17 · Baseline (before caching changes)

### Query cost with 2.37 million sessions

| Query                          | Time           |
| ------------------------------ | -------------- |
| Leaderboard, day (uncached)    | 15 ms          |
| Leaderboard, week (uncached)   | 400 ms         |
| Leaderboard, month (uncached)  | 550 ms         |
| Leaderboard, any range, cached | 1–3 ms         |
| Stats 7d / 30d / 365d          | 35 / 6 / 14 ms |
| Online list                    | 2.5 ms         |

The week and month leaderboards aggregate every session in the window (a parallel scan of ~2.4M
rows, most of it read from disk). Their cost grows with the number of sessions. Personal stats use
the `(user_id, started_at)` index and stay fast.

### 800 clients, 10 minutes

13,796 requests, no errors.

| Endpoint                | n     | p50     | p95    | p99        | max          |
| ----------------------- | ----- | ------- | ------ | ---------- | ------------ |
| POST /v1/presence       | 7,999 | 7.6 ms  | 11 ms  | 24 ms      | 116 ms       |
| POST /v1/sessions       | 2,000 | 11.6 ms | 17 ms  | 45 ms      | 98 ms        |
| GET /v1/me/stats        | 1,999 | 5.3 ms  | 8 ms   | 12 ms      | 68 ms        |
| GET /v1/presence/online | 600   | 5.9 ms  | 8 ms   | 22 ms      | 53 ms        |
| GET /v1/leaderboard     | 1,198 | 3.5 ms  | 8.6 ms | **622 ms** | **1,616 ms** |

| Container | CPU avg | CPU peak | Memory         |
| --------- | ------- | -------- | -------------- |
| API       | 7%      | 16%      | 161 MB of 1 GB |
| Postgres  | 7%      | 48%      | 362 MB of 2 GB |

Everything except the leaderboard is fast with lots of headroom. Leaderboard requests that arrive
when the 30 s cache expires wait for the query (450–750 ms); when several arrive together they run
the query several times at once and wait up to 1.6 s.

### 5× (≈ 4,000 concurrent users), 5 minutes: collapse

|                        |                                        |
| ---------------------- | -------------------------------------- |
| Requests completed     | 1,213 (≈ 35,000 expected)              |
| Latency, all endpoints | p50 60–80 **seconds**, max ≈ 5 minutes |
| Postgres CPU           | 99.7% average                          |
| API CPU                | 6%                                     |

At 10 leaderboard requests per second, every request that arrived while the cache was refreshing
started its own copy of the 550 ms query. The copies competed for the CPU and ran slower, so more
piled up. They held all 10 database connections, and uploads, presence and stats queued behind
them. Fifteen copies were still running after the test ended. The extension traffic itself never
got a fair test.

This is the failure behind "the leaderboard takes forever": a slow query plus a cache that lets
concurrent requests run it in parallel.

## 2026-11-17 · Layer 1: leaderboard requests never wait for the query

`TtlCache` now serves the stale copy while one background refresh runs, shares a single load
between concurrent requests, and the API warms every range at startup. The query itself is
unchanged (still ~550 ms for the month).

### 800 clients, 10 minutes

13,842 requests, no errors.

| Endpoint                | n     | p50     | p95    | p99       | max       |
| ----------------------- | ----- | ------- | ------ | --------- | --------- |
| POST /v1/presence       | 8,000 | 7.4 ms  | 12 ms  | 32 ms     | 128 ms    |
| POST /v1/sessions       | 2,022 | 11.5 ms | 18 ms  | 37 ms     | 108 ms    |
| GET /v1/me/stats        | 2,022 | 5.4 ms  | 9 ms   | 12 ms     | 86 ms     |
| GET /v1/presence/online | 600   | 5.8 ms  | 9 ms   | 32 ms     | 58 ms     |
| GET /v1/leaderboard     | 1,198 | 3.3 ms  | 5.4 ms | **10 ms** | **36 ms** |

| Container | CPU avg | CPU peak | Memory         |
| --------- | ------- | -------- | -------------- |
| API       | 7%      | 22%      | 152 MB of 1 GB |
| Postgres  | 9%      | 53%      | 364 MB of 2 GB |

Leaderboard p99 went from 622 ms to 10 ms (max 1.6 s → 36 ms). The Postgres CPU peaks are the
background refreshes, which no request waits for.

### 5× (≈ 4,000 concurrent users), 5 minutes

34,444 requests (≈ 115 per second), no errors.

| Endpoint                | n      | p50    | p95    | p99   | max    |
| ----------------------- | ------ | ------ | ------ | ----- | ------ |
| POST /v1/presence       | 19,993 | 5.5 ms | 16 ms  | 39 ms | 204 ms |
| POST /v1/sessions       | 4,990  | 7.1 ms | 17 ms  | 52 ms | 226 ms |
| GET /v1/me/stats        | 4,990  | 3.3 ms | 7 ms   | 14 ms | 145 ms |
| GET /v1/presence/online | 1,494  | 3.7 ms | 9 ms   | 36 ms | 80 ms  |
| GET /v1/leaderboard     | 2,977  | 1.8 ms | 4.5 ms | 10 ms | 100 ms |

| Container | CPU avg | CPU peak | Memory         |
| --------- | ------- | -------- | -------------- |
| API       | 16%     | 25%      | 157 MB of 1 GB |
| Postgres  | 15%     | 44%      | 370 MB of 2 GB |

The same load that collapsed the baseline now runs with every endpoint under 52 ms at p99 and both
containers averaging under a fifth of a CPU. The leaderboard query still costs ~550 ms each time it
refreshes and grows with the number of sessions; Layer 2 addresses that.

## 2026-11-17 · Layer 2: daily_stats rollup ([ADR 0006](adr/0006-daily-stats-rollup.md))

The leaderboard reads whole days from `daily_stats` (seconds per user, UTC day and language) and
only the window's partial first day from raw sessions. The backfill migration turned 2.37M
sessions into 336k rollup rows (42 MB) in seconds; the rollup's total matched the sessions' total
exactly.

### Query cost (uncached, best of 5, measured in Postgres)

| Range | Before (raw sessions) | After (rollup) |
| ----- | --------------------- | -------------- |
| Day   | 15 ms                 | 3.5 ms         |
| Week  | 400 ms                | 19 ms          |
| Month | 550 ms                | 49 ms          |

### 800 clients, 10 minutes

13,805 requests, no errors.

| Endpoint                | n     | p50     | p95    | p99   | max    |
| ----------------------- | ----- | ------- | ------ | ----- | ------ |
| POST /v1/presence       | 7,999 | 7.6 ms  | 12 ms  | 19 ms | 123 ms |
| POST /v1/sessions       | 2,004 | 12.2 ms | 18 ms  | 29 ms | 139 ms |
| GET /v1/me/stats        | 2,004 | 5.5 ms  | 9 ms   | 12 ms | 88 ms  |
| GET /v1/presence/online | 600   | 6.2 ms  | 10 ms  | 21 ms | 80 ms  |
| GET /v1/leaderboard     | 1,198 | 3.5 ms  | 5.6 ms | 10 ms | 62 ms  |

| Container | CPU avg | CPU peak | Memory         |
| --------- | ------- | -------- | -------------- |
| API       | 8%      | 17%      | 152 MB of 1 GB |
| Postgres  | 5%      | 12%      | 344 MB of 2 GB |

### 5× (≈ 4,000 concurrent users), 5 minutes

34,428 requests (≈ 115 per second), no errors.

| Endpoint                | n      | p50    | p95    | p99    | max    |
| ----------------------- | ------ | ------ | ------ | ------ | ------ |
| POST /v1/presence       | 19,983 | 5.2 ms | 13 ms  | 20 ms  | 312 ms |
| POST /v1/sessions       | 4,987  | 6.9 ms | 14 ms  | 20 ms  | 155 ms |
| GET /v1/me/stats        | 4,987  | 3.0 ms | 6 ms   | 9 ms   | 46 ms  |
| GET /v1/presence/online | 1,494  | 3.4 ms | 7 ms   | 10 ms  | 151 ms |
| GET /v1/leaderboard     | 2,977  | 1.7 ms | 4.1 ms | 6.7 ms | 108 ms |

| Container | CPU avg | CPU peak | Memory         |
| --------- | ------- | -------- | -------------- |
| API       | 16%     | 26%      | 157 MB of 1 GB |
| Postgres  | 14%     | 20%      | 355 MB of 2 GB |

The Postgres CPU peaks from leaderboard refreshes are gone (53% → 12% at 800 clients, 44% → 20%
at 5×). The extra rollup write per upload doesn't show: upload p99 is 20–29 ms.

## 2026-11-20 · Status bar moves to `/v1/me/today`

Richer personal stats (heatmap, all-time streak, highlights, editors, lines) made
`/v1/me/stats` heavier. The extension was asking for it after every upload but only shows today's
total, so it now asks `/v1/me/today` instead: one indexed sum over today's sessions. The full
stats are left to the dashboard.

### One heavy user: a year at 6 h/day (32,850 sessions), 40 warm requests

| Request                                     | p50    | p95    |
| ------------------------------------------- | ------ | ------ |
| `/v1/me/today`                              | 2.9 ms | 5.2 ms |
| `/v1/me/stats?range=7d` with the new fields | 17 ms  | 19 ms  |
| `/v1/me/stats?range=30d`                    | 40 ms  | 80 ms  |
| `/v1/me/stats?range=365d`                   | 190 ms | 284 ms |

At 7 days, about 15 ms of that is the all-time streak scan, which grows with every user's history.
At 365 days, the heatmap (64 ms in Postgres) and the daily series (28 ms) dominate. Reading the
sessions once in a single statement only brought the 365-day database time from about 140 to
100 ms, because the cost is the per-session time-zone maths. That's acceptable for a dashboard
tab, so there's no rollup for it (ADR 0006).

With the `project` and `language` filters (same user, one of 12 projects and 6 languages), the
heavy figures only aggregate the matching sessions, so filtered requests are cheaper:

| Request (`range=365d`)            | p50    | p95    |
| --------------------------------- | ------ | ------ |
| no filter                         | 192 ms | 285 ms |
| `project=project-3`               | 40 ms  | 62 ms  |
| `language=rust`                   | 40 ms  | 91 ms  |
| `project=project-3&language=rust` | 22 ms  | 55 ms  |

### 800 clients, 10 minutes

13,761 requests, no errors. CPU and memory weren't recorded for this run.

| Endpoint                | n     | p50     | p95    | p99    | max    |
| ----------------------- | ----- | ------- | ------ | ------ | ------ |
| POST /v1/presence       | 7,999 | 7.5 ms  | 11 ms  | 15 ms  | 117 ms |
| POST /v1/sessions       | 1,982 | 13.0 ms | 20 ms  | 30 ms  | 150 ms |
| GET /v1/me/today        | 1,982 | 4.0 ms  | 6.1 ms | 7.9 ms | 69 ms  |
| GET /v1/presence/online | 600   | 5.9 ms  | 8.4 ms | 14 ms  | 63 ms  |
| GET /v1/leaderboard     | 1,198 | 3.4 ms  | 5.0 ms | 7.0 ms | 36 ms  |

The status-bar request is cheaper than before (p50 5.5 → 4.0 ms, p99 12 → 7.9 ms), and the other
endpoints match the Layer 2 run.

## 2026-11-21 · Staff overview (`GET /v1/staff/overview`)

The overview aggregates the whole service, so each figure was measured on its own against the
2.37M-session data (warm, in Postgres) before choosing how to compute it:

| Figure                                     | Time       | Source                          |
| ------------------------------------------ | ---------- | ------------------------------- |
| Users, sign-ups per day                    | < 1 ms     | `users`                         |
| Active users today / 7 days / 30 days      | 140 ms     | `daily_stats`                   |
| Seconds and active users per day (30 days) | 50 ms      | `daily_stats`                   |
| Language mix (30 days)                     | 110 ms     | `daily_stats`                   |
| Editor mix (30 days)                       | 1,000 ms   | raw sessions (no rollup column) |
| Editor mix (7 days)                        | 100–250 ms | raw sessions                    |
| Sessions per day (30 days)                 | 390 ms     | raw sessions                    |

Sessions per day was left out (seconds and active users per day answer the same question), and the
editor mix covers 7 days. The API caches the result for a minute and serves the stale copy while it
refreshes. Over HTTP, the first request after the API starts took 1.5 s, which includes opening
database connections; after that, p50 5.2 ms and p95 8.3 ms.

## 2026-11-21 · Staff review queue (`GET /v1/staff/review-queue`)

The "no breaks" flag finds unbroken stretches with a window function over every session of the
last 7 days; "sudden jump" reads the `daily_stats` rollup. Measured on the load-test data (warm,
in Postgres):

| Flag        | Time       | Rows                              |
| ----------- | ---------- | --------------------------------- |
| no breaks   | 470–610 ms | 260k sessions in the 7-day window |
| sudden jump | 65–75 ms   | `daily_stats`, 4 weeks            |

A full week at the load test's rate is about 560k sessions, so "no breaks" could approach a second.
That's why the result is cached for a minute and served stale while it refreshes, like the overview.
Over HTTP: first request 0.25 s (after the data had aged out of part of the window), then p50
2.2 ms and p95 3.4 ms.

## Summary

| Run                    | Requests | Errors | Worst p99 (endpoint)       | Postgres CPU avg / peak |
| ---------------------- | -------- | ------ | -------------------------- | ----------------------- |
| Baseline · 800 clients | 13,796   | 0      | 622 ms (leaderboard)       | 7% / 48%                |
| Baseline · 5×          | 1,213    | 0      | minutes (all, collapse)    | 99.7% / 107%            |
| Layer 1 · 800 clients  | 13,842   | 0      | 37 ms (sessions)           | 9% / 53%                |
| Layer 1 · 5×           | 34,444   | 0      | 52 ms (sessions)           | 15% / 44%               |
| Layer 2 · 800 clients  | 13,805   | 0      | 29 ms (sessions)           | 5% / 12%                |
| Layer 2 · 5×           | 34,428   | 0      | 20 ms (sessions, presence) | 14% / 20%               |
| `/me/today` · 800      | 13,761   | 0      | 30 ms (sessions)           | not recorded            |

**Conclusions:**

- A small VPS (2 vCPU, ~3 GB for the API and Postgres) handles about 4,000 people coding at once with
  every endpoint under 20 ms at p99 and both processes under a fifth of a CPU on average. 800 people
  (our planning number) use well under 10%.
- The leaderboard was the only bottleneck. Layer 1 stops requests from waiting for it and stops
  concurrent refreshes from piling up; Layer 2 makes the refresh itself cheap and keeps it from
  growing with session history.
- Not yet tested: more than 2,000 distinct users (the seed's limit), months of history, and a real
  network between the web app, the API and the database. Live measurements are tracked in
  [#17](https://github.com/SalehKhatri/forkyou/issues/17).
