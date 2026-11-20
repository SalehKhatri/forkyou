import {
  type AppointableStaffRole,
  STAFF_ROLES,
  type StaffMember,
  type StaffRole,
} from "@forkyou/shared";
import { asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { adminActions, type User, users } from "../db/schema.js";
import type { Env } from "../env.js";
import { outranks, staffRoleOf } from "../lib/staff.js";

/** The staff member acting, as resolved by `requireStaff`. */
export type Actor = { id: string; role: StaffRole };

/** Why a staff action on another account was refused. */
export type Refusal = "not_found" | "outranked" | "not_staff";

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
): Promise<{ ok: true; member: StaffMember } | { ok: false; refusal: Refusal }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.username, username))
      .for("update");
    if (!target) return { ok: false, refusal: "not_found" };
    if (!outranks(actor.role, staffRoleOf(target, env))) return { ok: false, refusal: "outranked" };
    if (target.staffRole === role) return { ok: true, member: toMember(target, env) };

    const [updated] = await tx
      .update(users)
      .set({ staffRole: role })
      .where(eq(users.id, target.id))
      .returning();
    await tx.insert(adminActions).values({
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
): Promise<{ ok: true } | { ok: false; refusal: Refusal }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.username, username))
      .for("update");
    if (!target) return { ok: false, refusal: "not_found" };
    const targetRole = staffRoleOf(target, env);
    if (targetRole === null) return { ok: false, refusal: "not_staff" };
    if (!outranks(actor.role, targetRole)) return { ok: false, refusal: "outranked" };

    await tx.update(users).set({ staffRole: null }).where(eq(users.id, target.id));
    await tx.insert(adminActions).values({
      actorId: actor.id,
      targetId: target.id,
      action: "staff.remove",
      details: { previousRole: target.staffRole },
    });
    return { ok: true };
  });
}
