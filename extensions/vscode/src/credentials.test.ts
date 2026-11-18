import { describe, expect, it } from "vitest";
import type { ApiResult } from "./api.js";
import { Credentials, keyCheckMessage } from "./credentials.js";

const ME = {
  id: "8f9a3c1e-2b4d-4e6f-8a1b-3c5d7e9f0a2b",
  username: "ada",
  name: null,
  avatarUrl: null,
  showPresence: true,
  showLanguage: true,
  leaderboardHidden: false,
  leaderboardHiddenReason: null,
  createdAt: "2026-11-16T10:00:00.000Z",
};
const OK = { ok: true, data: ME } as const;
const UNAUTHORIZED = { ok: false, failure: "unauthorized", status: 401, message: "no" } as const;

/** An in-memory stand-in for `vscode.SecretStorage`. */
function secretStore() {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
}

/** A verification the test finishes by hand, to interleave it with other calls. */
function pendingVerify() {
  let finish: (result: ApiResult<typeof ME>) => void = () => {};
  const verify = () =>
    new Promise<ApiResult<typeof ME>>((resolve) => {
      finish = resolve;
    });
  return { verify, finish: (result: ApiResult<typeof ME>) => finish(result) };
}

describe("Credentials.signIn", () => {
  it("saves a key the server accepts", async () => {
    const secrets = secretStore();
    const credentials = new Credentials(secrets);

    const outcome = await credentials.signIn("fy_good", async () => OK);

    expect(outcome).toEqual({ result: OK, saved: true });
    expect(await credentials.get()).toBe("fy_good");
  });

  it("doesn't save a key the server rejects", async () => {
    const secrets = secretStore();
    const credentials = new Credentials(secrets);

    const outcome = await credentials.signIn("fy_bad", async () => UNAUTHORIZED);

    expect(outcome).toEqual({ result: UNAUTHORIZED, saved: false });
    expect(secrets.values.size).toBe(0);
  });

  it("doesn't save a key that was cleared while it was being checked", async () => {
    const credentials = new Credentials(secretStore());
    const check = pendingVerify();

    const signingIn = credentials.signIn("fy_good", check.verify);
    await credentials.clear();
    check.finish(OK);

    expect(await signingIn).toEqual({ result: OK, saved: false });
    expect(await credentials.get()).toBeUndefined();
  });

  it("keeps the newer key when an older sign-in finishes last", async () => {
    const credentials = new Credentials(secretStore());
    const older = pendingVerify();

    const first = credentials.signIn("fy_older", older.verify);
    await credentials.signIn("fy_newer", async () => OK);
    older.finish(OK);

    expect(await first).toEqual({ result: OK, saved: false });
    expect(await credentials.get()).toBe("fy_newer");
  });
});

describe("keyCheckMessage", () => {
  const url = "http://localhost:3000/api";

  it("explains each failure", () => {
    expect(keyCheckMessage("unauthorized", url)).toBe(
      "ForkYou: that API key isn't valid or has been revoked.",
    );
    expect(keyCheckMessage("outdated", url)).toBe(
      "ForkYou: this version of the extension is no longer supported. Please update it.",
    );
    expect(keyCheckMessage("network", url)).toBe(
      "ForkYou: couldn't reach http://localhost:3000/api. Check your connection or the forkyou.apiUrl setting.",
    );
    expect(keyCheckMessage("server", url)).toBe(
      "ForkYou: couldn't check your API key right now. Try again in a minute.",
    );
    expect(keyCheckMessage("rejected", url)).toBe(
      "ForkYou: couldn't check your API key right now. Try again in a minute.",
    );
  });
});
