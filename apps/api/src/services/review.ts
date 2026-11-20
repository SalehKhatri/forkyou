import type { ReviewFlag, ReviewQueueEntry } from "@forkyou/shared";
import { and, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";
import { days } from "../lib/time.js";

/**
 * What puts an account in the review queue (ADR 0009). Tune these here; they only decide what a
 * human is asked to look at, never what happens to the account.
 */
export const REVIEW = {
  /** Both flags look at the last 7 days, like the weekly leaderboard. */
  windowDays: 7,
  /** No breaks: this long with no gap between sessions longer than `maxBreakMinutes`. People
   * stop to eat, get coffee or step away; a script doesn't. */
  noBreaksHours: 8,
  maxBreakMinutes: 10,
  /** Sudden jump: a week this many times the average of the `baselineWeeks` before it, and at
   * least `jumpMinHours`, which keeps light users who double their time out of the queue. */
  jumpFactor: 5,
  jumpMinHours: 20,
  baselineWeeks: 3,
} as const;

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Accounts with patterns worth a human look, most time this week first. Leaves out accounts
 * already hidden from the leaderboard. A dismissal (`review.dismiss` in the audit log) hides the
 * flags whose evidence began before it: a new unbroken stretch after the review flags the account
 * again, and a jump returns only if it's still there once the 7-day window starts after the
 * review. Reads every session of the last week, so callers should cache the result.
 */
export async function getReviewQueue(db: Db, now: Date): Promise<ReviewQueueEntry[]> {
  const since = new Date(now.getTime() - days(REVIEW.windowDays));
  const weekStart = utcDay(new Date(now.getTime() - days(REVIEW.windowDays - 1)));
  const baselineStart = utcDay(
    new Date(now.getTime() - days(REVIEW.windowDays * (REVIEW.baselineWeeks + 1) - 1)),
  );

  const [stretches, weeks, dismissals] = await Promise.all([
    // Gaps and islands: a new stretch starts wherever the gap since the previous session ends is
    // longer than the allowed break.
    db.execute<{ user_id: string; started: Date; ended: Date }>(sql`
      with s as (
        select user_id, started_at, ended_at,
               case when started_at - lag(ended_at) over w
                         <= make_interval(mins => ${REVIEW.maxBreakMinutes})
                    then 0 else 1 end as breaks
        from coding_sessions
        where started_at >= ${since.toISOString()}::timestamptz
        window w as (partition by user_id order by started_at)
      ), g as (
        select user_id, started_at, ended_at,
               sum(breaks) over (partition by user_id order by started_at) as stretch
        from s
      )
      select user_id, min(started_at) as started, max(ended_at) as ended
      from g group by user_id, stretch
      having max(ended_at) - min(started_at) >= make_interval(hours => ${REVIEW.noBreaksHours})`),
    db.execute<{ user_id: string; week: number; baseline: number }>(sql`
      select user_id,
             coalesce(sum(seconds) filter (where day >= ${weekStart}::date), 0)::int as week,
             coalesce(sum(seconds) filter (where day < ${weekStart}::date), 0)::int as baseline
      from daily_stats where day >= ${baselineStart}::date group by user_id`),
    db.execute<{ target_id: string; at: Date }>(sql`
      select target_id, max(created_at) as at from admin_actions
      where action = 'review.dismiss' and target_id is not null group by target_id`),
  ]);

  const dismissedAt = new Map(dismissals.map((d) => [d.target_id, new Date(d.at).getTime()]));
  const after = (userId: string, evidenceFrom: Date) =>
    evidenceFrom.getTime() > (dismissedAt.get(userId) ?? Number.NEGATIVE_INFINITY);
  const weekSeconds = new Map(weeks.map((w) => [w.user_id, w.week]));

  const flags = new Map<string, ReviewFlag[]>();
  const add = (userId: string, flag: ReviewFlag) =>
    flags.set(userId, [...(flags.get(userId) ?? []), flag]);

  for (const s of stretches) {
    const from = new Date(s.started);
    const to = new Date(s.ended);
    if (!after(s.user_id, from)) continue;
    add(s.user_id, {
      kind: "no_breaks",
      from: from.toISOString(),
      to: to.toISOString(),
      seconds: Math.round((to.getTime() - from.getTime()) / 1000),
    });
  }
  const windowStart = new Date(`${weekStart}T00:00:00.000Z`);
  for (const w of weeks) {
    const baselineWeek = Math.round(w.baseline / REVIEW.baselineWeeks);
    const jumped =
      w.week >= REVIEW.jumpMinHours * 3600 && w.week >= REVIEW.jumpFactor * baselineWeek;
    if (!jumped || !after(w.user_id, windowStart)) continue;
    add(w.user_id, { kind: "sudden_jump", weekSeconds: w.week, baselineWeekSeconds: baselineWeek });
  }
  if (flags.size === 0) return [];

  const people = await db
    .select({ id: users.id, username: users.username, avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(inArray(users.id, [...flags.keys()]), isNull(users.leaderboardHiddenAt)));
  return people
    .map((p) => ({
      username: p.username,
      avatarUrl: p.avatarUrl,
      weekSeconds: weekSeconds.get(p.id) ?? 0,
      flags: flags.get(p.id) ?? [],
    }))
    .sort((a, b) => b.weekSeconds - a.weekSeconds || a.username.localeCompare(b.username));
}
