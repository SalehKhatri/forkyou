import { asc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

/**
 * Keeps an account off the public leaderboard (ADR 0007). Its owner keeps their dashboard,
 * stats and uploads, and sees that they're hidden; `reason` is a private note for the maintainer.
 * Takes effect when the leaderboard cache next refreshes (under a minute). Returns false if no
 * user has that username.
 */
export async function hideFromLeaderboard(
  db: Db,
  username: string,
  reason: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ leaderboardHiddenAt: now, leaderboardHiddenReason: reason })
    .where(eq(users.username, username))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Undoes `hideFromLeaderboard`. Returns false if no user has that username. */
export async function showOnLeaderboard(db: Db, username: string): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ leaderboardHiddenAt: null, leaderboardHiddenReason: null })
    .where(eq(users.username, username))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function listHiddenFromLeaderboard(
  db: Db,
): Promise<{ username: string; hiddenAt: Date | null; reason: string | null }[]> {
  return db
    .select({
      username: users.username,
      hiddenAt: users.leaderboardHiddenAt,
      reason: users.leaderboardHiddenReason,
    })
    .from(users)
    .where(isNotNull(users.leaderboardHiddenAt))
    .orderBy(asc(users.leaderboardHiddenAt));
}
