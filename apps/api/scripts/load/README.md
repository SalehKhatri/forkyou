# Load test

Checks how the API copes with realistic traffic and data volume. Results and the current
conclusions are in [docs/performance.md](../../../../docs/performance.md); rerun this before a
release that touches ingestion, presence, stats or the leaderboard.

- `seed.sql` creates 2,000 users with API keys (`fy_load_1` … `fy_load_2000`) and 30 days of
  sessions, about 2.4 million rows.
- `run.ts` simulates editor extensions on the VS Code extension's schedule (presence every
  60 s, an upload every 3–5 minutes followed by a stats request) plus leaderboard and online-list
  traffic, and prints latency per endpoint.

**Never run either against a database with real data.** Use the throwaway stack below.

## Run it

From the repo root, start a separate stack with its own database volume and resource limits
roughly like a small VPS (1 CPU and 1 GB for the API, 1 CPU and 2 GB for Postgres):

```bash
cat > /tmp/forkyou-load.yml <<'EOF'
services:
  postgres: { cpus: "1", mem_limit: 2g, volumes: ["loadpg:/var/lib/postgresql/data"] }
  api: { cpus: "1", mem_limit: 1g }
volumes:
  loadpg: { name: forkyou_loadtest_pgdata }
EOF
POSTGRES_PORT=5434 API_PORT=4100 docker compose -p forkyou-load \
  -f docker-compose.yml -f /tmp/forkyou-load.yml up -d --build --wait postgres api
docker exec -i forkyou-load-postgres-1 psql -U forkyou -d forkyou_v2 < apps/api/scripts/load/seed.sql
```

Then run the simulation (800 clients for 10 minutes):

```bash
BASE_URL=http://localhost:4100 CLIENTS=800 DURATION_S=600 \
  pnpm --filter @forkyou/api exec tsx scripts/load/run.ts
```

| Variable          | Default                 | Meaning                                                |
| ----------------- | ----------------------- | ------------------------------------------------------ |
| `CLIENTS`         | `800`                   | Simulated editors (up to 2,000, one per seeded key)    |
| `SPEED`           | `1`                     | Multiplies each client's request rate (`5` ≈ 5× users) |
| `DURATION_S`      | `600`                   | Length of the run                                      |
| `LEADERBOARD_RPS` | `2`                     | Leaderboard requests per second (random range)         |
| `ONLINE_RPS`      | `1`                     | Online-list requests per second                        |
| `BASE_URL`        | `http://localhost:4100` | API to test                                            |

Watch resource use alongside with `docker stats forkyou-load-api-1 forkyou-load-postgres-1`.

Clean up afterwards:

```bash
docker compose -p forkyou-load down
docker volume rm forkyou_loadtest_pgdata
```
