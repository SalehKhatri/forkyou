import { describe, expect, it } from "vitest";
import { users } from "../src/db/schema.js";
import { upsertGithubUser } from "../src/services/auth.js";
import { fakeGithub, makeApp, setupTestDb } from "./helpers.js";

const db = setupTestDb();
const app = makeApp(db);

const cookiesOf = (res: Response) =>
  Object.fromEntries(
    res.headers.getSetCookie().map((c) => {
      const [pair = ""] = c.split(";");
      const [name = "", value = ""] = pair.split("=");
      return [name, value];
    }),
  );

async function login(appUnderTest = app) {
  const start = await appUnderTest.request("/auth/github");
  const state = cookiesOf(start).fy_oauth_state;
  return appUnderTest.request(`/auth/github/callback?state=${state}&code=good-code`, {
    headers: { Cookie: `fy_oauth_state=${state}` },
  });
}

describe("GitHub login", () => {
  it("redirects to GitHub with a state cookie", async () => {
    const res = await app.request("/auth/github");
    expect(res.status).toBe(302);
    const state = cookiesOf(res).fy_oauth_state;
    expect(state).toBeTruthy();
    expect(res.headers.get("location")).toContain(`state=${state}`);
  });

  it("rejects a callback whose state doesn't match", async () => {
    const res = await app.request("/auth/github/callback?state=a&code=good-code", {
      headers: { Cookie: "fy_oauth_state=b" },
    });
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=state");
  });

  it("redirects with an error when GitHub rejects the code", async () => {
    const start = await app.request("/auth/github");
    const state = cookiesOf(start).fy_oauth_state;
    const res = await app.request(`/auth/github/callback?state=${state}&code=bad`, {
      headers: { Cookie: `fy_oauth_state=${state}` },
    });
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=github");
  });

  it("creates the user, sets a session cookie, and the cookie authenticates", async () => {
    const res = await login();
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
    const token = cookiesOf(res).fy_session;
    expect(token).toBeTruthy();
    const me = await app.request("/v1/me", { headers: { Cookie: `fy_session=${token}` } });
    expect(((await me.json()) as { username: string }).username).toBe("octo");
  });

  it("keeps one user per GitHub id when the username changes", async () => {
    await login();
    await login(
      makeApp(db, {
        github: fakeGithub({ githubId: 1, username: "renamed", name: null, avatarUrl: null }),
      }),
    );
    const rows = await db.select().from(users);
    expect(rows.map((u) => u.username)).toEqual(["renamed"]);
  });

  it("lets a new account take a username a stale account still holds", async () => {
    await upsertGithubUser(db, { githubId: 10, username: "taken", name: null, avatarUrl: null });
    const newcomer = await upsertGithubUser(db, {
      githubId: 11,
      username: "taken",
      name: null,
      avatarUrl: null,
    });
    expect(newcomer.username).toBe("taken");
    const stale = await upsertGithubUser(db, {
      githubId: 10,
      username: "renamed-away",
      name: null,
      avatarUrl: null,
    });
    expect(stale.username).toBe("renamed-away");
  });

  it("logs out by deleting the session", async () => {
    const token = cookiesOf(await login()).fy_session;
    const headers = { Cookie: `fy_session=${token}` };
    expect((await app.request("/auth/logout", { method: "POST", headers })).status).toBe(204);
    expect((await app.request("/v1/me", { headers })).status).toBe(401);
  });

  it("returns 503 when OAuth isn't configured", async () => {
    const res = await makeApp(db, { github: null }).request("/auth/github");
    expect(res.status).toBe(503);
  });
});
