import { GitHub } from "arctic";
import type { GithubProfile } from "./auth.js";

/** The slice of GitHub OAuth the app needs. Tests substitute a fake. */
export interface GithubOAuth {
  authorizationUrl(state: string): URL;
  exchangeCode(code: string): Promise<GithubProfile>;
}

type GithubUserResponse = { id: number; login: string; name: string | null; avatar_url: string };

export function createGithubOAuth(config: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): GithubOAuth {
  const client = new GitHub(config.clientId, config.clientSecret, config.redirectUri);
  return {
    authorizationUrl: (state) => client.createAuthorizationURL(state, []),
    async exchangeCode(code) {
      const tokens = await client.validateAuthorizationCode(code);
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokens.accessToken()}`,
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
