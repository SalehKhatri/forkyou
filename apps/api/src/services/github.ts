import type { GithubProfile } from "./auth.js";

/** The slice of GitHub OAuth the app needs. Tests substitute a fake. */
export interface GithubOAuth {
  authorizationUrl(state: string): URL;
  exchangeCode(code: string): Promise<GithubProfile>;
}

type TokenResponse = { access_token?: string; error?: string };
type GithubUserResponse = { id: number; login: string; name: string | null; avatar_url: string };

/**
 * GitHub's web application flow (docs.github.com, "Authorizing OAuth apps"), with no scopes: the
 * public profile is all ForkYou reads. Errors never include the code or the access token, because
 * the caller logs them.
 */
export function createGithubOAuth(
  config: { clientId: string; clientSecret: string; redirectUri: string },
  fetchFn: typeof fetch = fetch,
): GithubOAuth {
  return {
    authorizationUrl(state) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("state", state);
      return url;
    },

    async exchangeCode(code) {
      const tokenRes = await fetchFn("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "User-Agent": "forkyou" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.redirectUri,
        }),
      });
      if (!tokenRes.ok) throw new Error(`GitHub token exchange returned ${tokenRes.status}`);
      // GitHub reports a bad or expired code with 200 and an `error` field.
      const token = (await tokenRes.json()) as TokenResponse;
      if (!token.access_token) {
        throw new Error(`GitHub token exchange failed: ${token.error ?? "no access_token"}`);
      }

      const res = await fetchFn("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "forkyou",
        },
      });
      if (!res.ok) throw new Error(`GitHub /user returned ${res.status}`);
      const body = (await res.json()) as GithubUserResponse;
      return {
        githubId: body.id,
        username: body.login,
        name: body.name,
        avatarUrl: body.avatar_url,
      };
    },
  };
}
