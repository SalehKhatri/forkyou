import { describe, expect, it } from "vitest";
import { LEGACY_KEY, removeLegacyKey } from "./legacy.js";

/** An in-memory stand-in for `vscode.Memento`. */
function memento(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (key: string) => values.get(key),
    update: async (key: string, value: unknown) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    },
  };
}

describe("removeLegacyKey", () => {
  it("deletes a 1.x key and reports that it found one", async () => {
    const state = memento({ [LEGACY_KEY]: "0b3f9b9e-6f43-4d6c-9a52-2f1d6f0c8a11", other: 1 });

    expect(await removeLegacyKey(state)).toBe(true);
    expect([...state.values.keys()]).toEqual(["other"]);
  });

  it("does nothing when there's no 1.x key", async () => {
    const state = memento({ other: 1 });

    expect(await removeLegacyKey(state)).toBe(false);
    expect([...state.values.keys()]).toEqual(["other"]);
  });
});
