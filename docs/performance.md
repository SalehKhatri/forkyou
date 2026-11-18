# Performance

Load-test results for the API, newest last. Each run says what changed, so later runs can be
compared with earlier ones. How to rerun: [`apps/api/scripts/load/`](../apps/api/scripts/load/README.md).

## Setup

- **Data:** 2,000 users with 30 days of sessions (2.37 million rows, 550 MB with indexes), from
  `seed.sql`.
- **Machine:** Docker on a laptop, with limits roughly like a small VPS: API 1 CPU / 1 GB, Postgres
  1 CPU / 2 GB (default Postgres settings, so 128 MB `shared_buffers`).
- **Traffic** (`run.ts`): each simulated editor sends presence every 60 s and uploads 1–2 sessions
  every 3–5 minutes, each followed by a stats request (the status bar). The web side requests the
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
