import {
  type AppointableStaffRole,
  type AuditPage,
  type HiddenAccount,
  type LeaderboardHide,
  STAFF_ROLES,
  type StaffMember,
  type StaffRole,
  type StaffUser,
  type StatsQuery,
} from "@forkyou/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "../db/client.js";
import { adminActions, apiKeys, type User, users } from "../db/schema.js";
import type { Env } from "../env.js";
import { outranks, staffRoleOf } from "../lib/staff.js";
import { days } from "../lib/time.js";
import { hideFromLeaderboard, listHiddenFromLeaderboard, showOnLeaderboard } from "./moderation.js";
import { getUserStats } from "./stats.js";

/** The staff member acting, as resolved by `requireStaff`. */
export type Actor = { id: string; role: StaffRole };

/** Why a staff action on another account was refused. */
export type Refusal = "not_found" | "outranked" | "not_staff" | "not_hidden";

type Outcome = { ok: true } | { ok: false; refusal: Refusal };

/** Locks `username`'s row for the rest of `tx` and checks that `actor` may act on it. */
async function lockTarget(
  tx: Tx,
  env: Env,
  actor: Actor,
  username: string,
): Promise<{ ok: true; target: User } | { ok: false; refusal: Refusal }> {
  const [target] = await tx.select().from(users).where(eq(users.username, username)).for("update");
  if (!target) return { ok: false, refusal: "not_found" };
  if (!outranks(actor.role, staffRoleOf(target, env))) return { ok: false, refusal: "outranked" };
  return { ok: true, target };
}

const toMember = (u: User, env: Env): StaffMember => ({
  username: u.username,
  avatarUrl: u.avatarUrl,
  // Only staff are ever passed in, so the role is never null here.
  role: staffRoleOf(u, env) ?? "moderator",
});

/** Everyone with a staff role, super admins included, most trusted first. */
export async function listStaff(db: Db, env: Env): Promise<StaffMember[]> {
  const rows = await db
    .select()
    .from(users)
    .where(
      or(
        isNotNull(users.staffRole),
        env.SUPER_ADMIN_GITHUB_IDS.length > 0
          ? inArray(users.githubId, env.SUPER_ADMIN_GITHUB_IDS)
          : undefined,
      ),
    )
    .orderBy(asc(users.username));
  return rows
    .map((u) => toMember(u, env))
    .sort((a, b) => STAFF_ROLES.indexOf(b.role) - STAFF_ROLES.indexOf(a.role));
}

/**
 * Gives `username` a staff role, or changes it (ADR 0009). The actor must outrank the account's
 * current role, so a super admin's own role can't be changed here. Records the change in
 * `admin_actions`; setting the role someone already has changes and records nothing.
 */
export async function appointStaff(
  db: Db,
  env: Env,
  actor: Actor,
  username: string,
  role: AppointableStaffRole,
  now: Date,
): Promise<{ ok: true; member: StaffMember } | { ok: false; refusal: Refusal }> {
  return db.transaction(async (tx) => {
    const locked = await lockTarget(tx, env, actor, username);
    if (!locked.ok) return locked;
    const { target } = locked;
    if (target.staffRole === role) return { ok: true, member: toMember(target, env) };

    const [updated] = await tx
      .update(users)
      .set({ staffRole: role })
      .where(eq(users.id, target.id))
      .returning();
    await tx.insert(adminActions).values({
      createdAt: now,
      actorId: actor.id,
      targetId: target.id,
      action: "staff.appoint",
      details: { role, previousRole: target.staffRole },
    });
    return { ok: true, member: toMember(updated ?? target, env) };
  });
}

/** Removes `username`'s staff role and records it. Super admins can't be removed here. */
export async function removeStaff(
  db: Db,
  env: Env,
  actor: Actor,
  username: string,
  now: Date,
): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const locked = await lockTarget(tx, env, actor, username);
    if (!locked.ok) return locked;
    const { target } = locked;
    if (staffRoleOf(target, env) === null) return { ok: false, refusal: "not_staff" };

    await tx.update(users).set({ staffRole: null }).where(eq(users.id, target.id));
    await tx.insert(adminActions).values({
      createdAt: now,
      actorId: actor.id,
      targetId: target.id,
      action: "staff.remove",
      details: { previousRole: target.staffRole },
    });
    return { ok: true };
  });
}

/**
 * Keeps `username` off the public leaderboard (ADR 0007, 0008) and records why. Staff can only
 * hide accounts ranked below them. Hiding an already hidden account replaces the reason.
 */
export async function hideAccount(
  db: Db,
  env: Env,
  actor: Actor,
  username: string,
  { reason, showReason }: LeaderboardHide,
  now: Date,
): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const locked = await lockTarget(tx, env, actor, username);
    if (!locked.ok) return locked;
    await hideFromLeaderboard(tx, username, reason, now, { showReason });
    await tx.insert(adminActions).values({
      createdAt: now,
      actorId: actor.id,
      targetId: locked.target.id,
      action: "leaderboard.hide",
      details: { reason, showReason },
    });
    return { ok: true };
  });
}

/** Puts a hidden account back on the leaderboard and records it. */
export async function showAccount(
  db: Db,
  env: Env,
  actor: Actor,
  username: string,
  now: Date,
): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const locked = await lockTarget(tx, env, actor, username);
    if (!locked.ok) return locked;
    if (locked.target.leaderboardHiddenAt === null) return { ok: false, refusal: "not_hidden" };
    await showOnLeaderboard(tx, username);
    await tx.insert(adminActions).values({
      createdAt: now,
      actorId: actor.id,
      targetId: locked.target.id,
      action: "leaderboard.show",
      details: { previousReason: locked.target.leaderboardHiddenReason },
    });
    return { ok: true };
  });
}

export async function listHiddenAccounts(db: Db): Promise<HiddenAccount[]> {
  const rows = await listHiddenFromLeaderboard(db);
  return rows.map((r) => ({
    ...r,
    // Only hidden accounts are listed, so hiddenAt is always set.
    hiddenAt: (r.hiddenAt ?? new Date(0)).toISOString(),
  }));
}

const actors = alias(users, "actors");
const targets = alias(users, "targets");

// Cursor: "<created_at ISO>~<id>". Both parts, because several entries can share a timestamp.
// Audit rows get `created_at` from the app clock (millisecond precision), so the ISO string
// round-trips exactly; a database-generated microsecond timestamp wouldn't.
const encodeCursor = (createdAt: Date, id: string) => `${createdAt.toISOString()}~${id}`;
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = cursor.split("~");
  const createdAt = new Date(iso ?? "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  return id && uuid.test(id) && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

/**
 * The audit log, newest first, `limit` entries at a time, older than the `before` cursor. Returns
 * null for a malformed cursor.
 */
export async function readAudit(
  db: Db,
  { before, limit }: { before?: string; limit: number },
): Promise<AuditPage | null> {
  const cursor = before === undefined ? undefined : decodeCursor(before);
  if (cursor === null) return null;
  const rows = await db
    .select({
      id: adminActions.id,
      action: adminActions.action,
      actor: actors.username,
      target: targets.username,
      details: adminActions.details,
      createdAt: adminActions.createdAt,
    })
    .from(adminActions)
    .leftJoin(actors, eq(actors.id, adminActions.actorId))
    .leftJoin(targets, eq(targets.id, adminActions.targetId))
    .where(
      cursor === undefined
        ? undefined
        : sql`(${adminActions.createdAt}, ${adminActions.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
    )
    .orderBy(desc(adminActions.createdAt), desc(adminActions.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    entries: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    next: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * An account as staff see it when reviewing it: profile, moderation state, key activity, recent
 * totals and stats in `tz`. Leaves out project names (private to their owner, ADR 0009), API keys
 * and tokens. Any staff member can look up any account; looking isn't acting. Returns null for an
 * unknown username.
 */
export async function lookupUser(
  db: Db,
  env: Env,
  username: string,
  { range, tz }: Pick<StatsQuery, "range" | "tz">,
  now: Date,
): Promise<StaffUser | null> {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user) return null;

  const window = (n: number) => new Date(now.getTime() - days(n)).toISOString();
  const [[keys], [recent], stats] = await Promise.all([
    db
      .select({
        active: sql<number>`count(*)::int`,
        lastUsedAt: sql<Date | string | null>`max(${apiKeys.lastUsedAt})`,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt))),
    db.execute<{ day: number; week: number; month: number }>(sql`
      select coalesce(sum(duration_seconds) filter (where started_at >= ${window(1)}::timestamptz), 0)::int as day,
             coalesce(sum(duration_seconds) filter (where started_at >= ${window(7)}::timestamptz), 0)::int as week,
             coalesce(sum(duration_seconds), 0)::int as month
      from coding_sessions
      where user_id = ${user.id} and started_at >= ${window(30)}::timestamptz`),
    getUserStats(db, user.id, { range, tz }, now),
  ]);

  return {
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
    lastSeenAt: iso(user.lastSeenAt),
    staffRole: staffRoleOf(user, env),
    leaderboard: {
      hidden: user.leaderboardHiddenAt !== null,
      hiddenAt: iso(user.leaderboardHiddenAt),
      reason: user.leaderboardHiddenReason,
      reasonVisible: user.leaderboardHiddenReasonVisible,
    },
    apiKeys: {
      active: keys?.active ?? 0,
      // A raw max() isn't mapped by Drizzle, so normalise whatever the driver returns.
      lastUsedAt: keys?.lastUsedAt ? new Date(keys.lastUsedAt).toISOString() : null,
    },
    recent: recent ?? { day: 0, week: 0, month: 0 },
    stats: { ...stats, projects: [] },
  };
}

/**
 * Revokes every active API key of `username`, for a compromised or abusive account. Their editors
 * stop uploading until they create a new key; nothing else changes. Records how many were revoked.
 * Revoking an account with no active keys changes and records nothing.
 */
export async function revokeUserKeys(
  db: Db,
  env: Env,
  actor: Actor,
  username: string,
  now: Date,
): Promise<{ ok: true; revoked: number } | { ok: false; refusal: Refusal }> {
  return db.transaction(async (tx) => {
    const locked = await lockTarget(tx, env, actor, username);
    if (!locked.ok) return locked;
    const revoked = await tx
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.userId, locked.target.id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (revoked.length > 0) {
      await tx.insert(adminActions).values({
        createdAt: now,
        actorId: actor.id,
        targetId: locked.target.id,
        action: "keys.revoke",
        details: { count: revoked.length },
      });
    }
    return { ok: true, revoked: revoked.length };
  });
}

/**
 * Marks a flagged account as reviewed and fine. Its current flags leave the review queue; new
 * evidence after this brings it back (see `getReviewQueue`). Recorded as `review.dismiss`.
 */
export async function dismissReview(
  db: Db,
  env: Env,
  actor: Actor,
  username: string,
  note: string | undefined,
  now: Date,
): Promise<Outcome> {
  return db.transaction(async (tx) => {
    const locked = await lockTarget(tx, env, actor, username);
    if (!locked.ok) return locked;
    await tx.insert(adminActions).values({
      createdAt: now,
      actorId: actor.id,
      targetId: locked.target.id,
      action: "review.dismiss",
      details: note ? { note } : {},
    });
    return { ok: true };
  });
}
