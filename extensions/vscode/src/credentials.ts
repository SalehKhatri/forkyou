import type { MeResponse } from "@forkyou/shared";
import type { ApiFailure, ApiResult } from "./api.js";

/** Key in `context.secrets` (the OS keychain), separate from 1.x's plaintext `globalState` key. */
const SECRET_API_KEY = "apiKey";

/** The subset of `vscode.SecretStorage` this module uses. */
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

/**
 * The user's API key. Commands can overlap (a sign-in is still being checked when the user
 * clears the key or starts another sign-in), so only the most recent action takes effect: a
 * check that finishes after a newer sign-in or a clear never saves its key.
 */
export class Credentials {
  private generation = 0;

  constructor(private readonly secrets: SecretStore) {}

  get(): PromiseLike<string | undefined> {
    return this.secrets.get(SECRET_API_KEY);
  }

  /** Checks `key` with the server and saves it if valid and nothing newer happened meanwhile. */
  async signIn(
    key: string,
    verify: (key: string) => Promise<ApiResult<MeResponse>>,
  ): Promise<{ result: ApiResult<MeResponse>; saved: boolean }> {
    const generation = ++this.generation;
    const result = await verify(key);
    if (!result.ok || generation !== this.generation) return { result, saved: false };
    await this.secrets.store(SECRET_API_KEY, key);
    return { result, saved: true };
  }

  async clear(): Promise<void> {
    this.generation++;
    await this.secrets.delete(SECRET_API_KEY);
  }
}

/** What to tell the user when checking a key failed. */
export function keyCheckMessage(failure: ApiFailure, apiUrl: string): string {
  switch (failure) {
    case "unauthorized":
      return "ForkYou: that API key isn't valid or has been revoked.";
    case "outdated":
      return "ForkYou: this version of the extension is no longer supported. Please update it.";
    case "network":
      return `ForkYou: couldn't reach ${apiUrl}. Check your connection or the forkyou.apiUrl setting.`;
    default:
      return "ForkYou: couldn't check your API key right now. Try again in a minute.";
  }
}
