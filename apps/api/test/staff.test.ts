import { meResponseSchema } from "@forkyou/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adminActions, users } from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";
import { createApiKey } from "../src/services/auth.js";
import { createUser, createUserWithSession, makeApp, setupTestDb } from "./helpers.js";

const db = setupTestDb();

/** An app whose SUPER_ADMIN_GITHUB_IDS lists `githubIds`. */
const appWithSuperAdmins = (...githubIds: number[]) =>
  makeApp(db, {
    env: {
      ...loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgres://unused/test" }),
      SUPER_ADMIN_GITHUB_IDS: githubIds,
    },
  });

const put = (role: unknown, cookie: { Cookie: string }) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json", ...cookie },
  body: JSON.stringify({ role }),
});

async function setRole(username: string, staffRole: "moderator" | "admin" | null) {
  await db.update(users).set({ staffRole }).where(eq(users.username, username));
}

const auditRows = () =>
  db
    .select({
      actorId: adminActions.actorId,
      targetId: adminActions.targetId,
      action: adminActions.action,
      details: adminActions.details,
    })
    .from(adminActions)
    .orderBy(adminActions.createdAt);

const outranked = {
  error: {
    code: "outranked",
    message: "You can't act on your own account or on staff ranked at or above you",
  },
};

describe("staffRole in /v1/me", () => {
  it("is null for someone who isn't staff", async () => {
    const { cookie } = await createUserWithSession(db, "ada");

    const me = meResponseSchema.parse(
      await (await makeApp(db).request("/v1/me", { headers: cookie })).json(),
    );

    expect(me.staffRole).toBeNull();
  });

  it("is super_admin for a GitHub id in SUPER_ADMIN_GITHUB_IDS, whatever is stored", async () => {
    const { user, cookie } = await createUserWithSession(db, "ada");
    await setRole("ada", "moderator");

    const res = await appWithSuperAdmins(user.githubId).request("/v1/me", { headers: cookie });

    expect(meResponseSchema.parse(await res.json()).staffRole).toBe("super_admin");
  });

  it("is the stored role for appointed staff", async () => {
    const { cookie } = await createUserWithSession(db, "ada");
    await setRole("ada", "admin");

    const me = meResponseSchema.parse(
      await (await makeApp(db).request("/v1/me", { headers: cookie })).json(),
    );

    expect(me.staffRole).toBe("admin");
  });
});

describe("staff access", () => {
  it("needs a browser session", async () => {
    const res = await makeApp(db).request("/v1/staff/members");

    expect(res.status).toBe(401);
  });

  it("refuses API keys, even a super admin's", async () => {
    const boss = await createUser(db, "boss");
    const { key } = await createApiKey(db, boss.id, "laptop");

    const res = await appWithSuperAdmins(boss.githubId).request("/v1/staff/members", {
      headers: { Authorization: `Bearer ${key}` },
    });

    expect(res.status).toBe(401);
  });

  it("refuses non-staff, moderators and admins when managing staff", async () => {
    const forbidden = {
      error: { code: "forbidden", message: "Your account doesn't have access to this" },
    };
    const app = makeApp(db);
    const { cookie: plain } = await createUserWithSession(db, "ada");
    const { cookie: moderator } = await createUserWithSession(db, "linus");
    const { cookie: admin } = await createUserWithSession(db, "grace");
    await setRole("linus", "moderator");
    await setRole("grace", "admin");

    const answers = await Promise.all(
      [plain, moderator, admin].map(async (cookie) => {
        const res = await app.request("/v1/staff/members/ada", put("moderator", cookie));
        return { status: res.status, body: await res.json() };
      }),
    );

    expect(answers).toEqual([
      { status: 403, body: forbidden },
      { status: 403, body: forbidden },
      { status: 403, body: forbidden },
    ]);
  });
});

describe("PUT /v1/staff/members/:username", () => {
  it("lets a super admin appoint a moderator, and records it", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    const ada = await createUser(db, "ada");

    const res = await appWithSuperAdmins(boss.githubId).request(
      "/v1/staff/members/ada",
      put("moderator", cookie),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: "ada", avatarUrl: null, role: "moderator" });
    expect(await auditRows()).toEqual([
      {
        actorId: boss.id,
        targetId: ada.id,
        action: "staff.appoint",
        details: { role: "moderator", previousRole: null },
      },
    ]);
  });

  it("changes an existing role and records the previous one", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    await createUser(db, "ada");
    await setRole("ada", "moderator");

    await appWithSuperAdmins(boss.githubId).request("/v1/staff/members/ada", put("admin", cookie));

    expect((await auditRows()).map((r) => r.details)).toEqual([
      { role: "admin", previousRole: "moderator" },
    ]);
  });

  it("does nothing, and records nothing, when the role is already set", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    await createUser(db, "ada");
    await setRole("ada", "admin");

    const res = await appWithSuperAdmins(boss.githubId).request(
      "/v1/staff/members/ada",
      put("admin", cookie),
    );

    expect(await res.json()).toEqual({ username: "ada", avatarUrl: null, role: "admin" });
    expect(await auditRows()).toEqual([]);
  });

  it("takes effect on the appointee's next request", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    const { cookie: adaCookie } = await createUserWithSession(db, "ada");
    const app = appWithSuperAdmins(boss.githubId);

    await app.request("/v1/staff/members/ada", put("moderator", cookie));
    const me = meResponseSchema.parse(
      await (await app.request("/v1/me", { headers: adaCookie })).json(),
    );

    expect(me.staffRole).toBe("moderator");
  });

  it("can't change a super admin's role, not even your own", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    const other = await createUser(db, "other-boss");
    const app = appWithSuperAdmins(boss.githubId, other.githubId);

    const self = await app.request("/v1/staff/members/boss", put("moderator", cookie));
    const peer = await app.request("/v1/staff/members/other-boss", put("admin", cookie));

    expect([self.status, peer.status]).toEqual([403, 403]);
    expect(await self.json()).toEqual(outranked);
    expect(await auditRows()).toEqual([]);
  });

  it("returns 404 for a username that has never signed in", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");

    const res = await appWithSuperAdmins(boss.githubId).request(
      "/v1/staff/members/nobody",
      put("moderator", cookie),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "User not found" } });
  });

  it("can't appoint a super admin", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    await createUser(db, "ada");

    const res = await appWithSuperAdmins(boss.githubId).request(
      "/v1/staff/members/ada",
      put("super_admin", cookie),
    );

    expect(res.status).toBe(400);
    expect(
      (await db.select().from(users).where(eq(users.username, "ada")))[0]?.staffRole,
    ).toBeNull();
  });
});

describe("DELETE /v1/staff/members/:username", () => {
  const del = (cookie: { Cookie: string }) => ({ method: "DELETE", headers: cookie });

  it("removes a staff role, records it, and takes effect immediately", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    const { user: ada, cookie: adaCookie } = await createUserWithSession(db, "ada");
    await setRole("ada", "admin");
    const app = appWithSuperAdmins(boss.githubId);

    const res = await app.request("/v1/staff/members/ada", del(cookie));
    const me = meResponseSchema.parse(
      await (await app.request("/v1/me", { headers: adaCookie })).json(),
    );

    expect(res.status).toBe(204);
    expect(me.staffRole).toBeNull();
    expect(await auditRows()).toEqual([
      {
        actorId: boss.id,
        targetId: ada.id,
        action: "staff.remove",
        details: { previousRole: "admin" },
      },
    ]);
  });

  it("returns 404 for someone who isn't staff", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    await createUser(db, "ada");

    const res = await appWithSuperAdmins(boss.githubId).request(
      "/v1/staff/members/ada",
      del(cookie),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "Staff member not found" },
    });
  });

  it("can't remove a super admin", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");

    const res = await appWithSuperAdmins(boss.githubId).request(
      "/v1/staff/members/boss",
      del(cookie),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(outranked);
  });
});

describe("GET /v1/staff/members", () => {
  it("lists super admins and appointed staff, most trusted first", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    await createUser(db, "ada");
    await createUser(db, "linus");
    await createUser(db, "grace");
    await setRole("linus", "moderator");
    await setRole("grace", "admin");

    const res = await appWithSuperAdmins(boss.githubId).request("/v1/staff/members", {
      headers: cookie,
    });

    expect(await res.json()).toEqual([
      { username: "boss", avatarUrl: null, role: "super_admin" },
      { username: "grace", avatarUrl: null, role: "admin" },
      { username: "linus", avatarUrl: null, role: "moderator" },
    ]);
  });
});

describe("audit records and account deletion", () => {
  it("keeps the record but forgets who, when an account is deleted", async () => {
    const { user: boss, cookie } = await createUserWithSession(db, "boss");
    const { cookie: adaCookie } = await createUserWithSession(db, "ada");
    const app = appWithSuperAdmins(boss.githubId);
    await app.request("/v1/staff/members/ada", put("moderator", cookie));

    await app.request("/v1/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...adaCookie },
      body: JSON.stringify({ confirm: "ada" }),
    });

    expect(await auditRows()).toEqual([
      {
        actorId: boss.id,
        targetId: null,
        action: "staff.appoint",
        details: { role: "moderator", previousRole: null },
      },
    ]);
  });
});
