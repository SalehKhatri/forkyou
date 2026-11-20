import type { AccountExport, MeResponse } from "@forkyou/shared";
import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { apiKeys, codingSessions, type User, users } from "../db/schema.js";

/**
 * Deletes a user and everything stored for them: login sessions, API keys, coding sessions and
 * their daily_stats rollup, all through `on delete cascade`. Takes the user's ingestion lock so a
 * batch that's being stored finishes first instead of failing halfway.
 */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    await tx.delete(users).where(eq(users.id, userId));
  });
}

/**
 * Everything ForkYou stores about a user, for them to download, including the moderation reason
 * even if it isn't shown on their dashboard (ADR 0008). Leaves out secrets: API key and session
 * token hashes.
 */
export async function exportAccount(
  db: Db,
  user: User,
  me: MeResponse,
  now: Date,
): Promise<AccountExport> {
  const [keys, sessions] = await Promise.all([
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id))
      .orderBy(asc(apiKeys.createdAt)),
    db
      .select()
      .from(codingSessions)
      .where(eq(codingSessions.userId, user.id))
      .orderBy(asc(codingSessions.startedAt)),
  ]);
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  return {
    exportedAt: now.toISOString(),
    user: {
      ...me,
      leaderboardHiddenReason: user.leaderboardHiddenAt ? user.leaderboardHiddenReason : null,
      githubId: user.githubId,
      lastSeenAt: iso(user.lastSeenAt),
      presenceLanguage: user.presenceLanguage,
      presenceEditor: user.presenceEditor,
    },
    apiKeys: keys.map((k) => ({
      ...k,
      lastUsedAt: iso(k.lastUsedAt),
      createdAt: k.createdAt.toISOString(),
      revokedAt: iso(k.revokedAt),
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt.toISOString(),
      durationSeconds: s.durationSeconds,
      language: s.language,
      project: s.project,
      editor: s.editor as AccountExport["sessions"][number]["editor"],
      linesAdded: s.linesAdded,
      linesRemoved: s.linesRemoved,
      receivedAt: s.receivedAt.toISOString(),
    })),
  };
}
