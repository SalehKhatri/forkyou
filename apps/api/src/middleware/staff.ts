import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../context.js";
import { AppError } from "../lib/errors.js";
import { type Capability, can, staffRoleOf } from "../lib/staff.js";

/**
 * Lets the request through only if the signed-in user's role has `capability` (ADR 0009), and
 * sets `c.var.staffRole`. Mount it after `requireAuth("session")`. The role is re-read on every
 * request, so removing someone's role takes effect immediately.
 */
export const requireStaff = (capability: Capability) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const role = staffRoleOf(c.var.user, c.var.deps.env);
    if (role === null || !can(role, capability)) {
      throw new AppError(403, "forbidden", "Your account doesn't have access to this");
    }
    c.set("staffRole", role);
    await next();
  });
