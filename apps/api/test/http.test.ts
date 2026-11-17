import { describe, expect, it } from "vitest";
import { createApiKey } from "../src/services/auth.js";
import {
  createUserWithKey,
  createUserWithSession,
  json,
  makeApp,
  session,
  setupTestDb,
} from "./helpers.js";

const db = setupTestDb();
const app = makeApp(db);

describe("POST /v1/sessions", () => {
  it("requires an API key", async () => {
    const res = await app.request("/v1/sessions", json({ sessions: [session()] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: "Authentication required" },
    });
  });

  it("rejects an unknown key", async () => {
    const res = await app.request(
      "/v1/sessions",
      json({ sessions: [session()] }, { Authorization: "Bearer fy_nope" }),
    );
    expect(res.status).toBe(401);
  });

  it("does not accept the browser cookie (editors only)", async () => {
    const { cookie } = await createUserWithSession(db);
    const res = await app.request("/v1/sessions", json({ sessions: [session()] }, cookie));
    expect(res.status).toBe(401);
  });

  it("validates the body with a readable error envelope", async () => {
    const { auth } = await createUserWithKey(db);
    const res = await app.request("/v1/sessions", json({ sessions: [] }, auth));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("rejects oversized bodies with the error envelope", async () => {
    const { auth } = await createUserWithKey(db);
    const res = await app.request(
      "/v1/sessions",
      json({ sessions: [session({ project: "x".repeat(600_000) })] }, auth),
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "payload_too_large",
    );
  });

  it("ingests a batch", async () => {
    const { auth } = await createUserWithKey(db);
    const res = await app.request("/v1/sessions", json({ sessions: [session()] }, auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
  });
});

describe("API keys", () => {
  it("can be created, listed and revoked from a browser session", async () => {
    const { cookie } = await createUserWithSession(db);
    const created = await app.request("/v1/keys", json({ name: "laptop" }, cookie));
    expect(created.status).toBe(201);
    const key = (await created.json()) as { id: string; key: string; prefix: string };
    expect(key.key).toMatch(/^fy_/);
    expect(key.key.startsWith(key.prefix)).toBe(true);

    const list = await app.request("/v1/keys", { headers: cookie });
    const keys = (await list.json()) as unknown[];
    expect(keys).toHaveLength(1);
    expect(JSON.stringify(keys)).not.toContain(key.key);

    const del = await app.request(`/v1/keys/${key.id}`, { method: "DELETE", headers: cookie });
    expect(del.status).toBe(204);
    const after = await app.request("/v1/me", { headers: { Authorization: `Bearer ${key.key}` } });
    expect(after.status).toBe(401);
  });

  it("cannot be minted with an API key", async () => {
    const { auth } = await createUserWithKey(db);
    expect((await app.request("/v1/keys", json({ name: "x" }, auth))).status).toBe(401);
  });

  it("cannot be revoked by another user", async () => {
    const { user: owner } = await createUserWithSession(db, "owner");
    const { id } = await createApiKey(db, owner.id, "k");
    const { cookie } = await createUserWithSession(db, "intruder");
    const res = await app.request(`/v1/keys/${id}`, { method: "DELETE", headers: cookie });
    expect(res.status).toBe(404);
  });
});

describe("/v1/me", () => {
  it("returns the user for a cookie or a key", async () => {
    const { cookie } = await createUserWithSession(db, "cookie-user");
    const { auth } = await createUserWithKey(db, "key-user");
    const a = (await (await app.request("/v1/me", { headers: cookie })).json()) as {
      username: string;
    };
    const b = (await (await app.request("/v1/me", { headers: auth })).json()) as {
      username: string;
    };
    expect(a.username).toBe("cookie-user");
    expect(b.username).toBe("key-user");
  });

  it("updates privacy settings", async () => {
    const { cookie } = await createUserWithSession(db);
    const res = await app.request("/v1/me/settings", {
      method: "PATCH",
      headers: { ...cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ showPresence: false }),
    });
    expect(((await res.json()) as { showPresence: boolean }).showPresence).toBe(false);
  });

  it("rejects an unknown time zone for stats", async () => {
    const { cookie } = await createUserWithSession(db);
    const res = await app.request("/v1/me/stats?tz=Mars/Base", { headers: cookie });
    expect(res.status).toBe(400);
  });
});

describe("misc", () => {
  it("reports health", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ status: "ok" });
  });

  it("answers 1.x extension endpoints with 410", async () => {
    const res = await app.request("/activities/sync", json([]));
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("extension_outdated");
  });

  it("returns the error envelope for unknown routes", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});
