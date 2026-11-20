import { auditPageSchema, hiddenAccountSchema, sessionInputSchema } from "@forkyou/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";
import { ingestSessions } from "../src/services/ingest.js";
import {
  createUser,
  createUserWithSession,
  makeApp,
  NOW,
  session,
  setupTestDb,
} from "./helpers.js";

const db = setupTestDb();

/** The time every request sees; tests move it with `at()` so audit order is known. */
let clock = NOW;
const at = (secondsAfterNow: number) => {
  clock = new Date(NOW.getTime() + secondsAfterNow * 1000);
};

/** An app that knows the given super admins and reads `clock`, starting at NOW. */
function app(...superAdminGithubIds: number[]) {
  clock = NOW;
  return makeApp(db, {
    env: {
      ...loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgres://unused/test" }),
      SUPER_ADMIN_GITHUB_IDS: superAdminGithubIds,
    },
    now: () => clock,
  });
}

async function staff(username: string, role: "moderator" | "admin") {
  const created = await createUserWithSession(db, username);
  await db.update(users).set({ staffRole: role }).where(eq(users.username, username));
  return created;
}

const hide = (body: unknown, cookie: { Cookie: string }) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json", ...cookie },
  body: JSON.stringify(body),
});

const moderationOf = async (username: string) => {
  const [row] = await db
    .select({
      hiddenAt: users.leaderboardHiddenAt,
      reason: users.leaderboardHiddenReason,
      visible: users.leaderboardHiddenReasonVisible,
    })
    .from(users)
    .where(eq(users.username, username));
  return row;
};

const outranked = {
  error: {
    code: "outranked",
    message: "You can't act on your own account or on staff ranked at or above you",
  },
};

describe("PUT /v1/staff/users/:username/leaderboard-hidden", () => {
  it("lets a moderator hide an account, with the reason shown if asked", async () => {
    const { cookie } = await staff("mod", "moderator");
    await createUser(db, "ada");

    const res = await app().request(
      "/v1/staff/users/ada/leaderboard-hidden",
      hide({ reason: "24 h a day for a week", showReason: true }, cookie),
    );

    expect(res.status).toBe(204);
    expect(await moderationOf("ada")).toEqual({
      hiddenAt: NOW,
      reason: "24 h a day for a week",
      visible: true,
    });
  });

  it("keeps the reason off the dashboard unless asked", async () => {
    const { cookie } = await staff("mod", "moderator");
    await createUser(db, "ada");

    await app().request(
      "/v1/staff/users/ada/leaderboard-hidden",
      hide({ reason: "scripted uploads" }, cookie),
    );

    expect((await moderationOf("ada"))?.visible).toBe(false);
  });

  it("takes the account off the public leaderboard at once", async () => {
    const { cookie } = await staff("mod", "moderator");
    const ada = await createUser(db, "ada");
    await ingestSessions(db, ada.id, [sessionInputSchema.parse(session())], NOW);
    const a = app();

    await a.request("/v1/staff/users/ada/leaderboard-hidden", hide({ reason: "x" }, cookie));
    const board = (await (await a.request("/v1/leaderboard?range=day")).json()) as {
      entries: unknown[];
    };

    expect(board.entries).toEqual([]);
  });

  it("won't let a moderator hide another moderator or an admin", async () => {
    const { cookie } = await staff("mod", "moderator");
    await staff("peer", "moderator");
    await staff("boss", "admin");
    const a = app();

    const peer = await a.request(
      "/v1/staff/users/peer/leaderboard-hidden",
      hide({ reason: "x" }, cookie),
    );
    const boss = await a.request(
      "/v1/staff/users/boss/leaderboard-hidden",
      hide({ reason: "x" }, cookie),
    );

    expect([peer.status, boss.status]).toEqual([403, 403]);
    expect(await peer.json()).toEqual(outranked);
    expect((await moderationOf("peer"))?.hiddenAt).toBeNull();
  });

  it("lets an admin hide a moderator", async () => {
    const { cookie } = await staff("boss", "admin");
    await staff("mod", "moderator");

    const res = await app().request(
      "/v1/staff/users/mod/leaderboard-hidden",
      hide({ reason: "testing their own account" }, cookie),
    );

    expect(res.status).toBe(204);
  });

  it("refuses someone who isn't staff", async () => {
    const { cookie } = await createUserWithSession(db, "linus");
    await createUser(db, "ada");

    const res = await app().request(
      "/v1/staff/users/ada/leaderboard-hidden",
      hide({ reason: "x" }, cookie),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "Your account doesn't have access to this" },
    });
  });

  it("needs a reason", async () => {
    const { cookie } = await staff("mod", "moderator");
    await createUser(db, "ada");

    const res = await app().request(
      "/v1/staff/users/ada/leaderboard-hidden",
      hide({ reason: " " }, cookie),
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown user", async () => {
    const { cookie } = await staff("mod", "moderator");

    const res = await app().request(
      "/v1/staff/users/nobody/leaderboard-hidden",
      hide({ reason: "x" }, cookie),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "User not found" } });
  });
});

describe("DELETE /v1/staff/users/:username/leaderboard-hidden", () => {
  const show = (cookie: { Cookie: string }) => ({ method: "DELETE", headers: cookie });

  it("puts a hidden account back and clears the reason", async () => {
    const { cookie } = await staff("mod", "moderator");
    await createUser(db, "ada");
    const a = app();
    await a.request(
      "/v1/staff/users/ada/leaderboard-hidden",
      hide({ reason: "x", showReason: true }, cookie),
    );

    const res = await a.request("/v1/staff/users/ada/leaderboard-hidden", show(cookie));

    expect(res.status).toBe(204);
    expect(await moderationOf("ada")).toEqual({ hiddenAt: null, reason: null, visible: false });
  });

  it("returns 404 for an account that isn't hidden", async () => {
    const { cookie } = await staff("mod", "moderator");
    await createUser(db, "ada");

    const res = await app().request("/v1/staff/users/ada/leaderboard-hidden", show(cookie));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "Hidden account not found" },
    });
  });
});

describe("GET /v1/staff/leaderboard-hidden", () => {
  it("lists hidden accounts for any staff member", async () => {
    const { cookie } = await staff("mod", "moderator");
    await createUser(db, "ada");
    const a = app();
    await a.request("/v1/staff/users/ada/leaderboard-hidden", hide({ reason: "bot" }, cookie));

    const res = await a.request("/v1/staff/leaderboard-hidden", { headers: cookie });

    expect(hiddenAccountSchema.array().parse(await res.json())).toEqual([
      { username: "ada", hiddenAt: NOW.toISOString(), reason: "bot", reasonVisible: false },
    ]);
  });
});

describe("GET /v1/staff/audit", () => {
  it("is for admins and super admins, not moderators", async () => {
    const { cookie } = await staff("mod", "moderator");

    const res = await app().request("/v1/staff/audit", { headers: cookie });

    expect(res.status).toBe(403);
  });

  it("lists every staff action newest first, with who did what to whom", async () => {
    const { user: owner, cookie: ownerCookie } = await createUserWithSession(db, "owner");
    const { cookie: adminCookie } = await staff("boss", "admin");
    await createUser(db, "ada");
    const a = app(owner.githubId);
    await a.request("/v1/staff/members/ada", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...ownerCookie },
      body: JSON.stringify({ role: "moderator" }),
    });
    at(1);
    await a.request("/v1/staff/users/ada/leaderboard-hidden", hide({ reason: "x" }, adminCookie));
    at(2);
    await a.request("/v1/staff/users/ada/leaderboard-hidden", {
      method: "DELETE",
      headers: adminCookie,
    });

    const res = await a.request("/v1/staff/audit", { headers: adminCookie });

    expect(auditPageSchema.parse(await res.json())).toEqual({
      entries: [
        {
          id: expect.any(String),
          action: "leaderboard.show",
          actor: "boss",
          target: "ada",
          details: { previousReason: "x" },
          createdAt: "2026-11-16T12:00:02.000Z",
        },
        {
          id: expect.any(String),
          action: "leaderboard.hide",
          actor: "boss",
          target: "ada",
          details: { reason: "x", showReason: false },
          createdAt: "2026-11-16T12:00:01.000Z",
        },
        {
          id: expect.any(String),
          action: "staff.appoint",
          actor: "owner",
          target: "ada",
          details: { role: "moderator", previousRole: null },
          createdAt: "2026-11-16T12:00:00.000Z",
        },
      ],
      next: null,
    });
  });

  it("pages with the `next` cursor until there are no more", async () => {
    const { cookie } = await staff("boss", "admin");
    await createUser(db, "ada");
    await createUser(db, "linus");
    const a = app();
    await a.request("/v1/staff/users/ada/leaderboard-hidden", hide({ reason: "first" }, cookie));
    at(1);
    await a.request("/v1/staff/users/linus/leaderboard-hidden", hide({ reason: "second" }, cookie));

    const first = auditPageSchema.parse(
      await (await a.request("/v1/staff/audit?limit=1", { headers: cookie })).json(),
    );
    const second = auditPageSchema.parse(
      await (
        await a.request(`/v1/staff/audit?limit=1&before=${encodeURIComponent(first.next ?? "")}`, {
          headers: cookie,
        })
      ).json(),
    );

    expect(first.entries.map((e) => e.target)).toEqual(["linus"]);
    expect(second.entries.map((e) => e.target)).toEqual(["ada"]);
    expect(second.next).toBeNull();
  });

  it("doesn't skip or repeat entries that share a timestamp across pages", async () => {
    const { cookie } = await staff("boss", "admin");
    await createUser(db, "ada");
    await createUser(db, "linus");
    const a = app();
    await a.request("/v1/staff/users/ada/leaderboard-hidden", hide({ reason: "same" }, cookie));
    await a.request("/v1/staff/users/linus/leaderboard-hidden", hide({ reason: "same" }, cookie));

    const first = auditPageSchema.parse(
      await (await a.request("/v1/staff/audit?limit=1", { headers: cookie })).json(),
    );
    const second = auditPageSchema.parse(
      await (
        await a.request(`/v1/staff/audit?limit=1&before=${encodeURIComponent(first.next ?? "")}`, {
          headers: cookie,
        })
      ).json(),
    );

    expect([...first.entries, ...second.entries].map((e) => e.target).sort()).toEqual([
      "ada",
      "linus",
    ]);
  });

  it("rejects a cursor it didn't produce", async () => {
    const { cookie } = await staff("boss", "admin");

    const res = await app().request("/v1/staff/audit?before=yesterday", { headers: cookie });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "invalid_request", message: "Unknown audit cursor" },
    });
  });
});
