import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../context.js";
import type { Env } from "../env.js";
import { unauthorized } from "../lib/errors.js";
import { validateApiKey, validateAuthSession } from "../services/auth.js";

/** `__Host-` pins the cookie to our origin, but browsers only accept it over HTTPS. */
export const sessionCookieName = (env: Env) =>
  env.NODE_ENV === "production" ? "__Host-fy_session" : "fy_session";

export function sessionCookieOptions(env: Env, expires: Date) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax" as const,
    path: "/",
    expires,
  };
}

type Method = "apiKey" | "session";

/**
 * Authenticate the request and set `c.var.user`.
 * - `apiKey`: `Authorization: Bearer fy_…`, used by editor extensions.
 * - `session`: the login cookie, used by the web app (through its same-origin /api proxy).
 */
export const requireAuth = (...methods: Method[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const { db, env, now } = c.var.deps;

    if (methods.includes("apiKey")) {
      const header = c.req.header("authorization");
      const key = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
      if (key) {
        const user = await validateApiKey(db, key, now());
        if (!user) throw unauthorized();
        c.set("user", user);
        return next();
      }
    }

    if (methods.includes("session")) {
      const token = getCookie(c, sessionCookieName(env));
      if (token) {
        const result = await validateAuthSession(db, token, now());
        if (result) {
          if (result.renewedUntil) {
            setCookie(
              c,
              sessionCookieName(env),
              token,
              sessionCookieOptions(env, result.renewedUntil),
            );
          }
          c.set("user", result.user);
          return next();
        }
      }
    }

    throw unauthorized();
  });
