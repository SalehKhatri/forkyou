import type { ReviewQueueEntry, StaffOverview, StaffRole } from "@forkyou/shared";
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
  /** The staff overview, cached for a minute: it aggregates the whole service. */
  overviewCache: TtlCache<StaffOverview>;
  /** The staff review queue, cached for a minute: it reads every session of the last week. */
  reviewQueueCache: TtlCache<ReviewQueueEntry[]>;
  log: Logger;
  now: () => Date;
};

export type AppEnv = {
  Variables: {
    deps: Deps;
    /** Set by `requireAuth`. */
    user: User;
    /** Set by `requireStaff`, on staff routes only. */
    staffRole: StaffRole;
  };
};

export type App = Hono<AppEnv>;
