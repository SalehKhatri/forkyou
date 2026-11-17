/**
 * Recomputes the daily_stats rollup from coding_sessions (ADR 0006).
 *   pnpm --filter @forkyou/api db:rebuild-rollups
 * Run it if the two might have drifted, e.g. after rolling back to an API version older than the
 * rollup and forward again (docs/deployment.md → Rolling back). Safe while the API is running.
 */
import { createDb } from "../src/db/client.js";
import { loadEnv } from "../src/env.js";
import { rebuildDailyStats } from "../src/services/rollups.js";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const started = Date.now();
const rows = await rebuildDailyStats(db);
console.log(`daily_stats rebuilt: ${rows} rows in ${Date.now() - started} ms`);
await close();
