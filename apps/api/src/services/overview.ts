import type { StaffOverview } from "@forkyou/shared";
import { count, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";
import type { Env } from "../env.js";
import { days } from "../lib/time.js";
import { isOnlineSql } from "./presence.js";

const DAYS = 30;
const TOP_LANGUAGES = 10;

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The service at a glance for staff (ADR 0009). Daily figures come from the `daily_stats` rollup
 * (UTC days), so they stay cheap as sessions pile up; only the editor mix reads raw sessions, over
 * 7 days rather than 30, because the rollup has no editor column. Measurements are in
 * docs/performance.md. Callers should cache the result.
 */
export async function getOverview(db: Db, env: Env, now: Date): Promise<StaffOverview> {
  const today = utcDay(now);
  const firstDay = utcDay(new Date(now.getTime() - days(DAYS - 1)));
  const weekStart = utcDay(new Date(now.getTime() - days(6)));
  const superAdmins = env.SUPER_ADMIN_GITHUB_IDS;

  const [[userCounts], [online], [active], dayRows, signupRows, languageRows, editorRows] =
    await Promise.all([
      db
        .select({
          total: count(),
          staff: sql<number>`count(*) filter (where ${
            superAdmins.length > 0
              ? or(isNotNull(users.staffRole), inArray(users.githubId, superAdmins))
              : isNotNull(users.staffRole)
          })::int`,
          hidden: sql<number>`count(*) filter (where ${isNotNull(users.leaderboardHiddenAt)})::int`,
        })
        .from(users),
      db.select({ n: count() }).from(users).where(isOnlineSql(now)),
      db.execute<{ today: number; week: number; month: number }>(sql`
        select count(distinct user_id) filter (where day = ${today}::date)::int as today,
               count(distinct user_id) filter (where day >= ${weekStart}::date)::int as week,
               count(distinct user_id)::int as month
        from daily_stats where day >= ${firstDay}::date`),
      db.execute<{ day: string; seconds: number; active_users: number }>(sql`
        select to_char(day, 'YYYY-MM-DD') as day, sum(seconds)::int as seconds,
               count(distinct user_id)::int as active_users
        from daily_stats where day >= ${firstDay}::date group by day`),
      db.execute<{ day: string; signups: number }>(sql`
        select to_char((created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day,
               count(*)::int as signups
        from users where created_at >= ${firstDay}::date group by 1`),
      db.execute<{ language: string; seconds: number }>(sql`
        select language, sum(seconds)::int as seconds
        from daily_stats where day >= ${firstDay}::date
        group by 1 order by 2 desc limit ${TOP_LANGUAGES}`),
      db.execute<{ editor: string; seconds: number }>(sql`
        select editor, sum(duration_seconds)::int as seconds
        from coding_sessions where started_at >= ${new Date(now.getTime() - days(7)).toISOString()}::timestamptz
        group by 1 order by 2 desc`),
    ]);

  const activity = new Map(dayRows.map((r) => [r.day, r]));
  const signups = new Map(signupRows.map((r) => [r.day, r.signups]));
  const series: StaffOverview["days"] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = utcDay(new Date(now.getTime() - days(i)));
    const a = activity.get(day);
    series.push({
      day,
      signups: signups.get(day) ?? 0,
      activeUsers: a?.active_users ?? 0,
      seconds: a?.seconds ?? 0,
    });
  }

  return {
    generatedAt: now.toISOString(),
    users: {
      total: userCounts?.total ?? 0,
      staff: userCounts?.staff ?? 0,
      hiddenFromLeaderboard: userCounts?.hidden ?? 0,
    },
    activeUsers: active ?? { today: 0, week: 0, month: 0 },
    onlineNow: online?.n ?? 0,
    days: series,
    languages: [...languageRows],
    editors: [...editorRows],
  };
}
