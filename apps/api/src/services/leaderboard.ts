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

  const rows = await db.execute<Row>(sql`
    with totals as (
      select user_id, sum(duration_seconds)::int as total
      from coding_sessions
      where started_at >= ${since}::timestamptz
      group by user_id
      order by total desc
      limit ${LEADERBOARD_SIZE}
    ),
    langs as (
      select distinct on (user_id) user_id, language
      from (
        select cs.user_id, cs.language, sum(cs.duration_seconds) as s
        from coding_sessions cs
        join totals t on t.user_id = cs.user_id
        where cs.started_at >= ${since}::timestamptz
        group by 1, 2
      ) per_language
      order by user_id, s desc, language
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
