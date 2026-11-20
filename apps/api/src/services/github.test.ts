import { describe, expect, it } from "vitest";
import { createGithubOAuth } from "./github.js";

const config = {
  clientId: "client-123",
  clientSecret: "secret-456",
  redirectUri: "https://forkyou.dev/api/auth/github/callback",
};

type Call = { url: string; init: RequestInit | undefined };

/** A fetch that answers each call with the next response and records what was asked. */
function fakeFetch(...responses: Response[]) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${String(input)}`);
    return next;
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

const ada = {
  id: 1001,
  login: "ada",
  name: "Ada Lovelace",
  avatar_url: "https://a.test/o",
};

describe("createGithubOAuth", () => {
  it("builds the authorize URL with the client id, redirect URI and state, and no scopes", () => {
    const url = createGithubOAuth(config).authorizationUrl("state-abc");

    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-123",
      redirect_uri: "https://forkyou.dev/api/auth/github/callback",
      state: "state-abc",
    });
  });

  it("exchanges the code for a token, then reads the profile with it", async () => {
    const { fn, calls } = fakeFetch(json({ access_token: "gho_token" }), json(ada));

    const profile = await createGithubOAuth(config, fn).exchangeCode("code-789");

    expect(profile).toEqual({
      githubId: 1001,
      username: "ada",
      name: "Ada Lovelace",
      avatarUrl: "https://a.test/o",
    });
    expect(calls[0]?.url).toBe("https://github.com/login/oauth/access_token");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(Object.fromEntries(calls[0]?.init?.body as URLSearchParams)).toEqual({
      client_id: "client-123",
      client_secret: "secret-456",
      code: "code-789",
      redirect_uri: "https://forkyou.dev/api/auth/github/callback",
    });
    expect(calls[1]?.url).toBe("https://api.github.com/user");
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe("Bearer gho_token");
  });

  it("fails when GitHub rejects the code, which it reports with 200 and an error field", async () => {
    const { fn, calls } = fakeFetch(json({ error: "bad_verification_code" }));

    await expect(createGithubOAuth(config, fn).exchangeCode("expired")).rejects.toThrow(
      "GitHub token exchange failed: bad_verification_code",
    );
    expect(calls).toHaveLength(1);
  });

  it("fails when the token endpoint returns an error status", async () => {
    const { fn } = fakeFetch(json({}, 502));

    await expect(createGithubOAuth(config, fn).exchangeCode("code")).rejects.toThrow(
      "GitHub token exchange returned 502",
    );
  });

  it("fails when the profile request is refused, without putting the token in the error", async () => {
    const { fn } = fakeFetch(json({ access_token: "gho_token" }), json({}, 401));

    const error = await createGithubOAuth(config, fn)
      .exchangeCode("code")
      .catch((e: Error) => e);

    expect(error).toEqual(new Error("GitHub /user returned 401"));
  });
});
