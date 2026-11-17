import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { loadEnv } from "./env.js";
import { TtlCache } from "./lib/cache.js";
import { createGithubOAuth } from "./services/github.js";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);

const github =
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? createGithubOAuth({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        redirectUri: env.GITHUB_REDIRECT_URI,
      })
    : null;
if (!github) console.warn("GITHUB_CLIENT_ID/SECRET not set: login is disabled");

const app = createApp({
  db,
  env,
  github,
  leaderboardCache: new TtlCache(30_000),
  now: () => new Date(),
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await close();
      process.exit(0);
    });
  });
}
