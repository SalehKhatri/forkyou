import { STAFF_ROLES, type StaffRole } from "@forkyou/shared";
import type { User } from "../db/schema.js";
import type { Env } from "../env.js";

/**
 * What each role may do (ADR 0009). Fixed in code on purpose: permissions aren't configurable, so
 * there's nothing to misconfigure or escalate. Each capability names the least trusted role that
 * has it; every more trusted role has it too.
 */
const CAPABILITIES = {
  /** Overview stats, the review queue and user lookup. */
  review: "moderator",
  /** Hide or show an account on the leaderboard. */
  moderate: "moderator",
  /** Revoke another user's API keys. */
  revokeKeys: "admin",
  /** Read the audit log. */
  readAudit: "admin",
  /** Appoint or remove admins and moderators. */
  manageStaff: "super_admin",
} as const satisfies Record<string, StaffRole>;

export type Capability = keyof typeof CAPABILITIES;

const rank = (role: StaffRole | null) => (role === null ? -1 : STAFF_ROLES.indexOf(role));

/**
 * A user's effective role. Super admins come only from SUPER_ADMIN_GITHUB_IDS, which overrides
 * whatever is stored, so the app and the database can neither grant nor remove it.
 */
export function staffRoleOf(
  user: Pick<User, "githubId" | "staffRole">,
  env: Env,
): StaffRole | null {
  if (env.SUPER_ADMIN_GITHUB_IDS.includes(user.githubId)) return "super_admin";
  return user.staffRole;
}

export function can(role: StaffRole | null, capability: Capability): boolean {
  return rank(role) >= rank(CAPABILITIES[capability]);
}

/** Staff may only act on accounts ranked strictly below them, so never on themselves or peers. */
export function outranks(actor: StaffRole | null, target: StaffRole | null): boolean {
  return actor !== null && rank(actor) > rank(target);
}
