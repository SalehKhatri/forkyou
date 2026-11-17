import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "../src/db/schema.js";
import { createUserWithKey, json, makeApp, NOW, setupTestDb } from "./helpers.js";

const db = setupTestDb();
const at = (msFromNow: number) => () => new Date(NOW.getTime() + msFromNow);

async function online(app = makeApp(db)) {
  const res = await app.request("/v1/presence/online");
  return (await res.json()) as {
    count: number;
    users: { username: string; language: string | null }[];
  };
}

describe("presence", () => {
  it("shows a user online after a heartbeat, with their language", async () => {
    const { auth } = await createUserWithKey(db, "alice");
    const app = makeApp(db);
    const res = await app.request("/v1/presence", json({ online: true, language: "rust" }, auth));
    expect(res.status).toBe(204);
    expect(await online()).toMatchObject({
      count: 1,
      users: [{ username: "alice", language: "rust" }],
    });
  });

  it("goes offline immediately on an explicit sign-off", async () => {
    const { auth } = await createUserWithKey(db);
    const app = makeApp(db);
    await app.request("/v1/presence", json({ online: true }, auth));
    await makeApp(db, { now: at(1000) }).request("/v1/presence", json({ online: false }, auth));
    expect((await online(makeApp(db, { now: at(2000) }))).count).toBe(0);
  });

  it("times out when heartbeats stop (crashed editor)", async () => {
    const { auth } = await createUserWithKey(db);
    await makeApp(db).request("/v1/presence", json({ online: true }, auth));
    expect((await online(makeApp(db, { now: at(149_000) }))).count).toBe(1);
    expect((await online(makeApp(db, { now: at(151_000) }))).count).toBe(0);
  });

  it("comes back online after a sign-off when heartbeats resume", async () => {
    const { auth } = await createUserWithKey(db);
    await makeApp(db).request("/v1/presence", json({ online: false }, auth));
    await makeApp(db, { now: at(1000) }).request("/v1/presence", json({ online: true }, auth));
    expect((await online(makeApp(db, { now: at(2000) }))).count).toBe(1);
  });

  it("respects showPresence and showLanguage", async () => {
    const hidden = await createUserWithKey(db, "hidden");
    const quiet = await createUserWithKey(db, "quiet");
    await db.update(users).set({ showPresence: false }).where(eq(users.id, hidden.user.id));
    await db.update(users).set({ showLanguage: false }).where(eq(users.id, quiet.user.id));
    const app = makeApp(db);
    await app.request("/v1/presence", json({ online: true, language: "go" }, hidden.auth));
    await app.request("/v1/presence", json({ online: true, language: "go" }, quiet.auth));
    expect(await online()).toMatchObject({
      count: 1,
      users: [{ username: "quiet", language: null }],
    });
  });
});
