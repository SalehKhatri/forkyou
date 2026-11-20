/**
 * Simulates editor extensions (and some web traffic) against an API seeded by seed.sql.
 * See apps/api/scripts/load/README.md.
 *
 *   BASE_URL=http://localhost:4100 CLIENTS=800 DURATION_S=600 \
 *     pnpm --filter @forkyou/api exec tsx scripts/load/run.ts
 *
 * Each client follows the VS Code extension's schedule: presence every 60 s, an upload of 1-2
 * sessions every 3-5 minutes, and a /v1/me/today request after each upload (the status bar).
 * The web side requests the leaderboard and the online list at fixed rates. Prints latency per endpoint
 * every 30 s and a summary at the end.
 */
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4100";
const CLIENTS = Number(process.env.CLIENTS ?? 800);
const DURATION_MS = Number(process.env.DURATION_S ?? 600) * 1000;
/** Multiplies every client's request rate, to simulate more users than CLIENTS. */
const SPEED = Number(process.env.SPEED ?? 1);
const LEADERBOARD_RPS = Number(process.env.LEADERBOARD_RPS ?? 2);
const ONLINE_RPS = Number(process.env.ONLINE_RPS ?? 1);

const LANGUAGES = ["typescript", "python", "rust", "go", "java"];
const latencies = new Map<string, number[]>();
const statuses = new Map<string, number>();
let stopping = false;

function record(endpoint: string, ms: number, status: string) {
  const list = latencies.get(endpoint) ?? [];
  list.push(ms);
  latencies.set(endpoint, list);
  const key = `${endpoint} ${status}`;
  statuses.set(key, (statuses.get(key) ?? 0) + 1);
}

async function call(endpoint: string, path: string, init: RequestInit = {}) {
  const started = performance.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, init);
    await res.arrayBuffer();
    record(endpoint, performance.now() - started, String(res.status));
  } catch (error) {
    record(endpoint, performance.now() - started, `error:${(error as Error).message}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min: number, max: number) => min + Math.random() * (max - min);

async function client(n: number) {
  const headers = {
    authorization: `Bearer fy_load_${n}`,
    "content-type": "application/json",
  };
  const language = LANGUAGES[n % LANGUAGES.length];
  let lastEnd = Date.now() - 600_000;

  const presence = async () => {
    await sleep(between(0, 60_000) / SPEED);
    while (!stopping) {
      await call("POST /v1/presence", "/v1/presence", {
        method: "POST",
        headers,
        body: JSON.stringify({ online: true, language, editor: "vscode" }),
      });
      await sleep(60_000 / SPEED);
    }
  };

  const uploads = async () => {
    await sleep(between(0, 240_000) / SPEED);
    while (!stopping) {
      // One or two back-to-back sessions ending now, never overlapping earlier ones.
      const now = Date.now();
      const sessions = [];
      let start = Math.max(lastEnd + 1000, now - 480_000);
      const count = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < count; i++) {
        const end = i === count - 1 ? now : start + (now - start) / 2;
        const durationSeconds = Math.floor((end - start) / 1000);
        if (durationSeconds >= 1) {
          sessions.push({
            id: randomUUID(),
            startedAt: new Date(start).toISOString(),
            durationSeconds: Math.min(durationSeconds, 900),
            language,
            project: "load",
            editor: "vscode",
          });
        }
        start = end + 1000;
      }
      lastEnd = now;
      if (sessions.length > 0) {
        await call("POST /v1/sessions", "/v1/sessions", {
          method: "POST",
          headers,
          body: JSON.stringify({ sessions }),
        });
        await call("GET /v1/me/today", "/v1/me/today?tz=UTC", { headers });
      }
      await sleep(between(180_000, 300_000) / SPEED);
    }
  };

  await Promise.all([presence(), uploads()]);
}

async function fixedRate(endpoint: string, rps: number, path: () => string) {
  if (rps <= 0) return;
  while (!stopping) {
    void call(endpoint, path());
    await sleep(1000 / rps);
  }
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function report(label: string, since: Map<string, number>) {
  const lines = [`--- ${label}`];
  let total = 0;
  for (const [endpoint, list] of [...latencies].sort()) {
    const fresh = list.slice(since.get(endpoint) ?? 0);
    since.set(endpoint, list.length);
    total += fresh.length;
    const sorted = [...fresh].sort((a, b) => a - b);
    lines.push(
      `${endpoint.padEnd(24)} n=${String(fresh.length).padStart(6)}  p50=${percentile(sorted, 50).toFixed(1)}ms  p95=${percentile(sorted, 95).toFixed(1)}ms  p99=${percentile(sorted, 99).toFixed(1)}ms  max=${(sorted.at(-1) ?? 0).toFixed(1)}ms`,
    );
  }
  lines.push(`requests: ${total}`);
  console.log(lines.join("\n"));
}

const started = Date.now();
console.log(`${CLIENTS} clients × speed ${SPEED} for ${DURATION_MS / 1000}s against ${BASE_URL}`);
const window = new Map<string, number>();
const ticker = setInterval(
  () => report(`${Math.round((Date.now() - started) / 1000)}s (last 30s)`, window),
  30_000,
);
const work = [
  ...Array.from({ length: CLIENTS }, (_, i) => client(i + 1)),
  fixedRate("GET /v1/leaderboard", LEADERBOARD_RPS, () => {
    const ranges = ["day", "week", "month"];
    return `/v1/leaderboard?range=${ranges[Math.floor(Math.random() * 3)]}`;
  }),
  fixedRate("GET /v1/presence/online", ONLINE_RPS, () => "/v1/presence/online"),
];
await sleep(DURATION_MS);
stopping = true;
clearInterval(ticker);
report("whole run", new Map());
console.log("--- status codes");
for (const [key, count] of [...statuses].sort()) console.log(`${key.padEnd(40)} ${count}`);
process.exit(0);
void work;
