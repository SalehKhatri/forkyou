import type { Hono } from "hono";
import type { Db } from "./db/client.js";
import type { User } from "./db/schema.js";
import type { Env } from "./env.js";
import type { TtlCache } from "./lib/cache.js";
import type { Logger } from "./lib/log.js";
import type { GithubOAuth } from "./services/github.js";

/** Everything a request handler may depend on. Built once in createApp; replaced in tests. */
export type Deps = {
  db: Db;
  env: Env;
  github: GithubOAuth | null;
  leaderboardCache: TtlCache<unknown>;
  log: Logger;
  now: () => Date;
};

export type AppEnv = {
  Variables: {
    deps: Deps;
    /** Set by `requireAuth`. */
    user: User;
  };
};

export type App = Hono<AppEnv>;
