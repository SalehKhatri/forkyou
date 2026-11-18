import { describe, expect, it } from "vitest";
import { ApiClient } from "./api.js";

/** A /v1/me response from a server that predates `leaderboardHidden`. */
const ME = {
  id: "8f9a3c1e-2b4d-4e6f-8a1b-3c5d7e9f0a2b",
  username: "ada",
  name: "Ada",
  avatarUrl: null,
  showPresence: true,
  showLanguage: true,
  createdAt: "2026-11-16T10:00:00.000Z",
};

type Call = { url: string; init: RequestInit };

/** An ApiClient whose fetch returns `response` (or throws it) and records each call. */
function client(response: Response | Error) {
  const calls: Call[] = [];
  const api = new ApiClient({
    baseUrl: () => "https://forkyou.example.com/api",
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    },
  });
  return { api, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ApiClient.me", () => {
  it("sends the key as a bearer token and returns the parsed user", async () => {
    const { api, calls } = client(json(200, ME));

    const result = await api.me("fy_example");

    // Fields added later get their defaults, so older servers keep working.
    expect(result).toEqual({ ok: true, data: { ...ME, leaderboardHidden: false } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://forkyou.example.com/api/v1/me");
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.headers).toEqual({ authorization: "Bearer fy_example" });
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("reports a 401 as unauthorized with the server's message", async () => {
    const { api } = client(
      json(401, { error: { code: "unauthorized", message: "Authentication required" } }),
    );

    expect(await api.me("fy_revoked")).toEqual({
      ok: false,
      failure: "unauthorized",
      status: 401,
      message: "Authentication required",
    });
  });

  it("reports a 410 as outdated", async () => {
    const { api } = client(json(410, { error: { code: "extension_outdated", message: "Update" } }));

    expect(await api.me("fy_example")).toMatchObject({
      ok: false,
      failure: "outdated",
      status: 410,
    });
  });

  it("reports other 4xx responses as rejected", async () => {
    const { api } = client(json(400, { error: { code: "invalid_request", message: "bad" } }));

    expect(await api.me("fy_example")).toEqual({
      ok: false,
      failure: "rejected",
      status: 400,
      message: "bad",
    });
  });

  it("reports 5xx responses without an error envelope as server failures", async () => {
    const { api } = client(new Response("Bad Gateway", { status: 502 }));

    expect(await api.me("fy_example")).toEqual({
      ok: false,
      failure: "server",
      status: 502,
      message: "HTTP 502",
    });
  });

  it("reports a 200 with an unexpected body as a server failure", async () => {
    const { api } = client(json(200, { hello: "world" }));

    expect(await api.me("fy_example")).toEqual({
      ok: false,
      failure: "server",
      status: 200,
      message: "Unexpected response",
    });
  });

  it("reports a request that never got a response as a network failure", async () => {
    const { api } = client(new TypeError("fetch failed"));

    expect(await api.me("fy_example")).toEqual({
      ok: false,
      failure: "network",
      message: "fetch failed",
    });
  });
});

describe("ApiClient.request", () => {
  it("sends a JSON body with a content type", async () => {
    const { api, calls } = client(new Response(null, { status: 204 }));

    const result = await api.request("POST", "/v1/presence", "fy_example", { online: false }, null);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(calls[0]?.init.headers).toEqual({
      authorization: "Bearer fy_example",
      "content-type": "application/json",
    });
    expect(calls[0]?.init.body).toBe('{"online":false}');
  });
});
