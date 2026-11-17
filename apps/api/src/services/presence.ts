import { type OnlineUser, PRESENCE, type PresenceInput } from "@forkyou/shared";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";
import { seconds } from "../lib/time.js";

/** Record a heartbeat (`online: true`) or an explicit sign-off (`online: false`). */
export async function recordPresence(
  db: Db,
  userId: string,
  input: PresenceInput,
  now: Date = new Date(),
): Promise<void> {
  if (input.online) {
    await db
      .update(users)
      .set({
        lastSeenAt: now,
        offlineAt: null,
        presenceLanguage: input.language ?? null,
        presenceEditor: input.editor ?? null,
      })
      .where(eq(users.id, userId));
  } else {
    await db.update(users).set({ offlineAt: now }).where(eq(users.id, userId));
  }
}

/** SQL condition: user is online right now and allows their presence to be shown. */
export function isOnlineSql(now: Date = new Date()) {
  const since = new Date(now.getTime() - seconds(PRESENCE.onlineWindowSeconds));
  return and(
    eq(users.showPresence, true),
    gt(users.lastSeenAt, since),
    or(isNull(users.offlineAt), lt(users.offlineAt, users.lastSeenAt)),
  );
}

export async function listOnlineUsers(
  db: Db,
  { limit = 100, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<{ count: number; users: OnlineUser[] }> {
  const where = isOnlineSql(now);
  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        username: users.username,
        avatarUrl: users.avatarUrl,
        language: sql<
          string | null
        >`case when ${users.showLanguage} then ${users.presenceLanguage} end`,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.lastSeenAt))
      .limit(limit),
    db.select({ count: sql<number>`count(*)::int` }).from(users).where(where),
  ]);
  return {
    count: countRow?.count ?? 0,
    users: rows.map((r) => ({
      ...r,
      lastSeenAt: (r.lastSeenAt ?? now).toISOString(),
    })),
  };
}

/** Same rule as `isOnlineSql`, for rows already loaded. */
export function isOnline(
  row: { showPresence: boolean; lastSeenAt: Date | null; offlineAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!row.showPresence || !row.lastSeenAt) return false;
  if (now.getTime() - row.lastSeenAt.getTime() >= seconds(PRESENCE.onlineWindowSeconds)) {
    return false;
  }
  return !row.offlineAt || row.offlineAt < row.lastSeenAt;
}
