/**
 * Local demo data, so the app is usable without GitHub OAuth.
 *   pnpm --filter @forkyou/api db:seed
 * Prints an API key (for extensions/curl) and a session cookie (for the browser).
 */
import { randomUUID } from "node:crypto";
import { createDb } from "../src/db/client.js";
import { loadEnv } from "../src/env.js";
import { createApiKey, createAuthSession, upsertGithubUser } from "../src/services/auth.js";
import { ingestSessions } from "../src/services/ingest.js";
import { recordPresence } from "../src/services/presence.js";

const env = loadEnv();
if (env.NODE_ENV === "production") throw new Error("Refusing to seed a production database");

const { db, close } = createDb(env.DATABASE_URL);
const languages = ["typescript", "rust", "python", "go", "typescriptreact"];
const projects = ["forkyou", "dotfiles", "api"];
const now = Date.now();

const people = [
  { githubId: 9_000_001, username: "demo", name: "Demo User" },
  { githubId: 9_000_002, username: "ada", name: null },
  { githubId: 9_000_003, username: "linus", name: null },
  { githubId: 9_000_004, username: "grace", name: null },
];

let demoKey = "";
let demoToken = "";
for (const [i, p] of people.entries()) {
  const user = await upsertGithubUser(db, { ...p, avatarUrl: null });
  const sessions = [];
  for (let day = 0; day < 6; day++) {
    for (let s = 0; s < 4 - i; s++) {
      const minutes = 5 + ((day * 7 + s * 3 + i) % 10);
      const endsAgo = day * 1440 + s * 20 + 5;
      sessions.push({
        id: randomUUID(),
        startedAt: new Date(now - (endsAgo + minutes) * 60_000).toISOString(),
        durationSeconds: minutes * 60,
        language: languages[(day + s + i) % languages.length] ?? "typescript",
        project: projects[s % projects.length],
        editor: "vscode" as const,
        linesAdded: 10,
        linesRemoved: 2,
      });
    }
  }
  await ingestSessions(db, user.id, sessions);
  if (i < 2) await recordPresence(db, user.id, { online: true, language: "typescript" });
  if (i === 0) {
    demoKey = (await createApiKey(db, user.id, "seed")).key;
    demoToken = (await createAuthSession(db, user.id)).token;
  }
}

console.log(`Seeded ${people.length} users.

API key (Authorization: Bearer …):
  ${demoKey}

Browser login: open http://localhost:3000, then in DevTools → Application → Cookies set
  fy_session = ${demoToken}
`);
await close();
