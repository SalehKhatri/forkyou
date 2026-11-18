import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { dailyStats } from "../db/schema.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** UTC calendar day (YYYY-MM-DD) a session is counted under in `daily_stats`. */
export const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Adds newly stored sessions to `daily_stats`. Call inside the transaction that inserted them,
 * with only the rows actually inserted, so the rollup always equals the sum of `coding_sessions`.
 */
export async function addToDailyStats(
  tx: Transaction,
  userId: string,
  sessions: { startedAt: Date; language: string; durationSeconds: number }[],
): Promise<void> {
  const totals = new Map<string, { day: string; language: string; seconds: number }>();
  for (const s of sessions) {
    const day = utcDay(s.startedAt);
    const key = `${day}\u0000${s.language}`;
    const entry = totals.get(key) ?? { day, language: s.language, seconds: 0 };
    entry.seconds += s.durationSeconds;
    totals.set(key, entry);
  }
  if (totals.size === 0) return;
  await tx
    .insert(dailyStats)
    .values([...totals.values()].map((t) => ({ userId, ...t })))
    .onConflictDoUpdate({
      target: [dailyStats.userId, dailyStats.day, dailyStats.language],
      set: { seconds: sql`${dailyStats.seconds} + excluded.seconds` },
    });
}

/**
 * Recomputes `daily_stats` from `coding_sessions`. Needed only if the two drifted apart, e.g.
 * after rolling back to an API version that predates the rollup and then forward again
 * (docs/deployment.md → Rolling back). Safe to run while the API is up: uploads wait for it to
 * finish (a few seconds per million sessions).
 */
export async function rebuildDailyStats(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    // Hold off inserts meanwhile, so no session is counted twice or missed. Reads continue.
    await tx.execute(sql`lock table coding_sessions in share mode`);
    await tx.execute(sql`delete from daily_stats`);
    const rows = await tx.execute(sql`
      insert into daily_stats (user_id, day, language, seconds)
      select user_id, (started_at at time zone 'UTC')::date, language, sum(duration_seconds)::int
      from coding_sessions
      group by 1, 2, 3
      returning 1`);
    return rows.length;
  });
}
