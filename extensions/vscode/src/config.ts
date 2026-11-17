export const DEFAULT_API_URL = "https://forkyou.dev/api";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The server to talk to, from the `forkyou.apiUrl` setting. Anything that isn't HTTPS (or plain
 * HTTP to this machine, for local development) falls back to the default, so a typo can't send
 * the API key over an unencrypted connection.
 */
export function resolveApiUrl(raw: string | undefined): { url: string; warning?: string } {
  const value = raw?.trim();
  if (!value) return { url: DEFAULT_API_URL };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      url: DEFAULT_API_URL,
      warning: `forkyou.apiUrl "${value}" isn't a URL; using the default`,
    };
  }
  const secure = parsed.protocol === "https:";
  const local = parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname);
  if (!secure && !local) {
    return {
      url: DEFAULT_API_URL,
      warning: `forkyou.apiUrl must use https (http only for localhost); using the default`,
    };
  }
  return { url: value.replace(/\/+$/, "") };
}

/** The web app for an API URL: `https://forkyou.dev/api` → `https://forkyou.dev`. */
export function webUrl(apiUrl: string): string {
  return apiUrl.endsWith("/api") ? apiUrl.slice(0, -"/api".length) : new URL(apiUrl).origin;
}

/** 2.0 keys are `fy_` + random base64url. 1.x keys were bare UUIDs and no longer work. */
export function isApiKeyFormat(value: string): boolean {
  return /^fy_[A-Za-z0-9_-]{20,}$/.test(value);
}
