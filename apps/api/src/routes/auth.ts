import { generateState } from "arctic";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../context.js";
import { AppError } from "../lib/errors.js";
import { sessionCookieName, sessionCookieOptions } from "../middleware/auth.js";
import { createAuthSession, deleteAuthSession, upsertGithubUser } from "../services/auth.js";

const STATE_COOKIE = "fy_oauth_state";

/** GitHub login. Mounted at /auth; reached by the browser via the web app's /api proxy. */
export const authRoutes = new Hono<AppEnv>()
  .get("/github", (c) => {
    const { github, env } = c.var.deps;
    if (!github) throw new AppError(503, "oauth_unconfigured", "GitHub login is not configured");
    const state = generateState();
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    return c.redirect(github.authorizationUrl(state).toString());
  })

  .get("/github/callback", async (c) => {
    const { github, db, env, now } = c.var.deps;
    if (!github) throw new AppError(503, "oauth_unconfigured", "GitHub login is not configured");

    const state = c.req.query("state");
    const code = c.req.query("code");
    const expected = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/" });
    if (!state || !code || !expected || state !== expected) {
      return c.redirect(`${env.WEB_URL}/login?error=state`);
    }

    let profile: Awaited<ReturnType<typeof github.exchangeCode>>;
    try {
      profile = await github.exchangeCode(code);
    } catch (err) {
      console.error("github oauth exchange failed", err);
      return c.redirect(`${env.WEB_URL}/login?error=github`);
    }

    const user = await upsertGithubUser(db, profile);
    const session = await createAuthSession(db, user.id, now());
    setCookie(
      c,
      sessionCookieName(env),
      session.token,
      sessionCookieOptions(env, session.expiresAt),
    );
    return c.redirect(`${env.WEB_URL}/dashboard`);
  })

  .post("/logout", async (c) => {
    const { db, env } = c.var.deps;
    const name = sessionCookieName(env);
    const token = getCookie(c, name);
    if (token) await deleteAuthSession(db, token);
    deleteCookie(c, name, { path: "/", secure: env.NODE_ENV === "production" });
    return c.body(null, 204);
  });
