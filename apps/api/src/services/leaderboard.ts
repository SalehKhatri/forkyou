import { LEADERBOARD_SIZE, type LeaderboardRange, type LeaderboardResponse } from "@forkyou/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { days } from "../lib/time.js";
import { isOnline } from "./presence.js";

/** Rolling windows, so the board never "resets" to empty at midnight UTC. */
const RANGE_DAYS: Record<LeaderboardRange, number> = { day: 1, week: 7, month: 30 };

type Row = {
  username: string;
  avatar_url: string | null;
  total: number;
  top_language: string | null;
  show_presence: boolean;
  last_seen_at: string | Date | null;
  offline_at: string | Date | null;
};

const toDate = (v: string | Date | null) => (v === null ? null : new Date(v));

export async function getLeaderboard(
  db: Db,
  range: LeaderboardRange,
  now: Date = new Date(),
): Promise<LeaderboardResponse> {
  const since = new Date(now.getTime() - days(RANGE_DAYS[range])).toISOString();

  // Whole UTC days come from the daily_stats rollup; only the partial day the window starts in
  // is read from raw sessions. Same totals as summing every session since `since`, but the work
  // grows with users × days instead of with sessions (ADR 0006, docs/performance.md).
  const rows = await db.execute<Row>(sql`
    with bounds as (
      select ${since}::timestamptz as since,
             (${since}::timestamptz at time zone 'UTC')::date as first_day
    ),
    windowed as (
      select ds.user_id, ds.language, ds.seconds::bigint as seconds
      from daily_stats ds, bounds b
      where ds.day > b.first_day
      union all
      select cs.user_id, cs.language, cs.duration_seconds::bigint
      from coding_sessions cs, bounds b
      where cs.started_at >= b.since
        and cs.started_at < (b.first_day + 1)::timestamp at time zone 'UTC'
    ),
    per_language as (
      select user_id, language, sum(seconds) as s from windowed group by 1, 2
    ),
    totals as (
      select user_id, sum(s)::int as total
      from per_language
      group by user_id
      order by total desc
      limit ${LEADERBOARD_SIZE}
    ),
    langs as (
      select distinct on (pl.user_id) pl.user_id, pl.language
      from per_language pl
      join totals t on t.user_id = pl.user_id
      order by pl.user_id, pl.s desc, pl.language
    )
    select u.username, u.avatar_url, t.total, l.language as top_language,
           u.show_presence, u.last_seen_at, u.offline_at
    from totals t
    join users u on u.id = t.user_id
    left join langs l on l.user_id = t.user_id
    order by t.total desc, u.username asc`);

  return {
    range,
    entries: rows.map((r, i) => ({
      rank: i + 1,
      username: r.username,
      avatarUrl: r.avatar_url,
      totalSeconds: r.total,
      topLanguage: r.top_language,
      online: isOnline(
        {
          showPresence: r.show_presence,
          lastSeenAt: toDate(r.last_seen_at),
          offlineAt: toDate(r.offline_at),
        },
        now,
      ),
    })),
  };
}
