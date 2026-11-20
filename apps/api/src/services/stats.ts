import type { StatsRange, StatsResponse, TodayResponse } from "@forkyou/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { days } from "../lib/time.js";

const RANGE_DAYS: Record<StatsRange, number> = { "7d": 7, "30d": 30, "365d": 365 };
const TOP_N = 20;

/** Calendar day (YYYY-MM-DD) of `date` in `tz`. */
function dayIn(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
}

/**
 * A user's own stats for the last N days, bucketed by calendar day in their time zone.
 * Projects are private, so this is only ever served to the owner.
 */
export async function getUserStats(
  db: Db,
  userId: string,
  range: StatsRange,
  tz: string,
  now: Date = new Date(),
): Promise<StatsResponse> {
  const n = RANGE_DAYS[range];
  // Start from local midnight N-1 days ago, approximated by going back N full days.
  const since = new Date(now.getTime() - days(n)).toISOString();
  const base = sql`from coding_sessions where user_id = ${userId} and started_at >= ${since}::timestamptz`;

  const [dayRows, languageRows, projectRows] = await Promise.all([
    db.execute<{ day: string; seconds: number }>(sql`
      select to_char((started_at at time zone ${tz})::date, 'YYYY-MM-DD') as day,
             sum(duration_seconds)::int as seconds
      ${base} group by 1`),
    db.execute<{ language: string; seconds: number }>(sql`
      select language, sum(duration_seconds)::int as seconds
      ${base} group by 1 order by 2 desc limit ${TOP_N}`),
    db.execute<{ project: string; seconds: number }>(sql`
      select project, sum(duration_seconds)::int as seconds
      ${base} and project is not null group by 1 order by 2 desc limit ${TOP_N}`),
  ]);

  // Dense series: one entry per day, oldest first, zero-filled.
  const byDay = new Map(dayRows.map((r) => [r.day, r.seconds]));
  const series: StatsResponse["days"] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = dayIn(new Date(now.getTime() - days(i)), tz);
    series.push({ day, seconds: byDay.get(day) ?? 0 });
  }

  return {
    range,
    totalSeconds: series.reduce((sum, d) => sum + d.seconds, 0),
    days: series,
    languages: [...languageRows],
    projects: [...projectRows],
  };
}

/**
 * Seconds coded today, a calendar day in `tz`. Counts the same sessions as today's entry in
 * getUserStats (by start time), with one indexed query, because editors ask after every upload.
 */
export async function getTodaySeconds(
  db: Db,
  userId: string,
  tz: string,
  now: Date = new Date(),
): Promise<TodayResponse> {
  const day = dayIn(now, tz);
  // Today started at most 25 hours ago (a day with a DST change), so this bound never cuts it off;
  // it only lets the start-time index skip older sessions.
  const since = new Date(now.getTime() - days(2)).toISOString();
  const [row] = await db.execute<{ seconds: number }>(sql`
    select coalesce(sum(duration_seconds), 0)::int as seconds
    from coding_sessions
    where user_id = ${userId}
      and started_at >= ${since}::timestamptz
      and (started_at at time zone ${tz})::date = ${day}::date`);
  return { day, seconds: row?.seconds ?? 0 };
}
