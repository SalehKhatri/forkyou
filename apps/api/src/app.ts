import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Deps } from "./context.js";
import { AppError, errorBody } from "./lib/errors.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { legacyRoutes } from "./routes/legacy.js";
import { v1Routes } from "./routes/v1.js";

/**
 * Build the HTTP app. No CORS on purpose: browsers reach the API through the web app's
 * same-origin /api proxy, and editor extensions aren't browsers. That also makes the cookie
 * endpoints immune to cross-site JSON requests.
 */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use(requestId());
  if (deps.env.NODE_ENV !== "test") app.use(logger());
  app.use(secureHeaders());
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.route("/", healthRoutes);
  app.route("/auth", authRoutes);
  app.route("/v1", v1Routes);
  app.route("/", legacyRoutes);

  app.notFound((c) => c.json(errorBody("not_found", "Route not found"), 404));

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json(errorBody(err.code, err.message), err.status);
    if (err instanceof HTTPException) {
      return c.json(errorBody("http_error", err.message), err.status);
    }
    console.error(`[${c.get("requestId")}]`, err);
    return c.json(errorBody("internal", "Internal server error"), 500);
  });

  return app;
}
