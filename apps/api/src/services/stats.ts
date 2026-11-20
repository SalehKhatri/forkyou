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

/** Whole days from `a` to `b`, both YYYY-MM-DD. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / days(1));
}

/**
 * The longest run of consecutive days in `activeDays` (YYYY-MM-DD, ascending, distinct), and the
 * run that's still going: one that includes today, or yesterday, since today isn't over yet.
 */
export function countStreaks(
  activeDays: string[],
  today: string,
): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  let previous: string | undefined;
  for (const day of activeDays) {
    run = previous !== undefined && daysBetween(previous, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  const stillGoing = previous !== undefined && daysBetween(previous, today) <= 1;
  return { current: stillGoing ? run : 0, longest };
}

/**
 * A user's own stats for the last N days, bucketed by calendar day in their time zone. Every
 * figure covers the same days, except the streak, which is all-time. Projects are private, so
 * this is only ever served to the owner.
 */
export async function getUserStats(
  db: Db,
  userId: string,
  range: StatsRange,
  tz: string,
  now: Date = new Date(),
): Promise<StatsResponse> {
  const n = RANGE_DAYS[range];
  // Every figure covers the same calendar days as the series: today and the N-1 before it, in
  // `tz`. `since` (N×24h back) is a looser bound that lets the start-time index narrow the scan.
  const firstDay = dayIn(new Date(now.getTime() - days(n - 1)), tz);
  const since = new Date(now.getTime() - days(n)).toISOString();
  const base = sql`from coding_sessions where user_id = ${userId}
    and started_at >= ${since}::timestamptz
    and (started_at at time zone ${tz})::date >= ${firstDay}::date`;

  const [dayRows, languageRows, projectRows, hourRows, editorRows, lineRows, activeDayRows] =
    await Promise.all([
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
      // Each session's time is split across the local hours it spans. Hours are cut in absolute
      // time, so a session across a DST change or in a half-hour offset zone is still split right.
      db.execute<{ weekday: number; hour: number; seconds: number }>(sql`
      select extract(isodow from h at time zone ${tz})::int as weekday,
             extract(hour from h at time zone ${tz})::int as hour,
             round(sum(extract(epoch from least(s.ended_at, h + interval '1 hour')
                                   - greatest(s.started_at, h))))::int as seconds
      from (select started_at, ended_at ${base}) s,
           generate_series(date_trunc('hour', s.started_at, ${tz}), s.ended_at, interval '1 hour') h
      where h < s.ended_at
      group by 1, 2`),
      db.execute<{ editor: string; seconds: number }>(sql`
      select editor, sum(duration_seconds)::int as seconds
      ${base} group by 1 order by 2 desc`),
      db.execute<{ added: number; removed: number }>(sql`
      select coalesce(sum(lines_added), 0)::int as added,
             coalesce(sum(lines_removed), 0)::int as removed
      ${base}`),
      db.execute<{ day: string }>(sql`
      select distinct to_char((started_at at time zone ${tz})::date, 'YYYY-MM-DD') as day
      from coding_sessions where user_id = ${userId} order by 1`),
    ]);

  // Dense series: one entry per day, oldest first, zero-filled.
  const byDay = new Map(dayRows.map((r) => [r.day, r.seconds]));
  const series: StatsResponse["days"] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = dayIn(new Date(now.getTime() - days(i)), tz);
    series.push({ day, seconds: byDay.get(day) ?? 0 });
  }

  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of hourRows) {
    const row = heatmap[r.weekday - 1]; // isodow: 1 = Monday
    if (row) row[r.hour] = r.seconds;
  }

  const totalSeconds = series.reduce((sum, d) => sum + d.seconds, 0);
  const active = series.filter((d) => d.seconds > 0);
  // The earliest of equally long days, so the answer doesn't change as later days tie it.
  const bestDay = active.reduce<StatsResponse["days"][number] | null>(
    (best, d) => (best === null || d.seconds > best.seconds ? d : best),
    null,
  );

  return {
    range,
    totalSeconds,
    days: series,
    languages: [...languageRows],
    projects: [...projectRows],
    heatmap,
    streak: countStreaks(
      activeDayRows.map((r) => r.day),
      dayIn(now, tz),
    ),
    highlights: {
      activeDays: active.length,
      dailyAverageSeconds: active.length > 0 ? Math.round(totalSeconds / active.length) : 0,
      bestDay,
    },
    editors: [...editorRows],
    lines: lineRows[0] ?? { added: 0, removed: 0 },
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
