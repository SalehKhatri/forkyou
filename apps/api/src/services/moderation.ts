import { asc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

/**
 * Keeps an account off the public leaderboard (ADR 0007). Its owner keeps their dashboard,
 * stats and uploads, and sees that they're hidden. The reason is always in their data export;
 * with `showReason` it's also shown on their dashboard (ADR 0008). Takes effect when the
 * leaderboard cache next refreshes (under a minute). Returns false if no user has that username.
 */
export async function hideFromLeaderboard(
  db: Db,
  username: string,
  reason: string,
  now: Date = new Date(),
  { showReason = false }: { showReason?: boolean } = {},
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({
      leaderboardHiddenAt: now,
      leaderboardHiddenReason: reason,
      leaderboardHiddenReasonVisible: showReason,
    })
    .where(eq(users.username, username))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Undoes `hideFromLeaderboard`. Returns false if no user has that username. */
export async function showOnLeaderboard(db: Db, username: string): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({
      leaderboardHiddenAt: null,
      leaderboardHiddenReason: null,
      leaderboardHiddenReasonVisible: false,
    })
    .where(eq(users.username, username))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function listHiddenFromLeaderboard(
  db: Db,
): Promise<
  { username: string; hiddenAt: Date | null; reason: string | null; reasonVisible: boolean }[]
> {
  return db
    .select({
      username: users.username,
      hiddenAt: users.leaderboardHiddenAt,
      reason: users.leaderboardHiddenReason,
      reasonVisible: users.leaderboardHiddenReasonVisible,
    })
    .from(users)
    .where(isNotNull(users.leaderboardHiddenAt))
    .orderBy(asc(users.leaderboardHiddenAt));
}
