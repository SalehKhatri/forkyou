import { describe, expect, it } from "vitest";
import { TtlCache } from "./cache.js";

/** A load the test finishes by hand, counting how many times it was started. */
function controlledLoad<T>() {
  const pending: { resolve: (v: T) => void; reject: (e: Error) => void }[] = [];
  const load = () =>
    new Promise<T>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  return {
    load,
    get started() {
      return pending.length;
    },
    resolve: (i: number, value: T) => pending[i]?.resolve(value),
    reject: (i: number, error: Error) => pending[i]?.reject(error),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TtlCache", () => {
  it("returns a fresh value without loading again", async () => {
    const cache = new TtlCache<string>(1000);
    let loads = 0;
    const load = async () => `v${++loads}`;

    expect(await cache.getOrSet("k", load, 0)).toBe("v1");
    expect(await cache.getOrSet("k", load, 999)).toBe("v1");
    expect(loads).toBe(1);
  });

  it("shares one load between concurrent callers when nothing is cached", async () => {
    const cache = new TtlCache<string>(1000);
    const l = controlledLoad<string>();

    const a = cache.getOrSet("k", l.load, 0);
    const b = cache.getOrSet("k", l.load, 0);
    l.resolve(0, "v1");

    expect(await Promise.all([a, b])).toEqual(["v1", "v1"]);
    expect(l.started).toBe(1);
  });

  it("serves a stale value immediately and refreshes it once in the background", async () => {
    const cache = new TtlCache<string>(1000);
    await cache.getOrSet("k", async () => "old", 0);
    const l = controlledLoad<string>();

    const first = await cache.getOrSet("k", l.load, 1500);
    const second = await cache.getOrSet("k", l.load, 1600);
    l.resolve(0, "new");
    await flush();

    expect([first, second]).toEqual(["old", "old"]);
    expect(l.started).toBe(1);
    expect(await cache.getOrSet("k", l.load, 1700)).toBe("new");
  });

  it("keeps serving the stale value when a refresh fails, and retries on the next request", async () => {
    const errors: unknown[] = [];
    const cache = new TtlCache<string>(1000, { onError: (_key, error) => errors.push(error) });
    await cache.getOrSet("k", async () => "old", 0);
    const l = controlledLoad<string>();

    expect(await cache.getOrSet("k", l.load, 1500)).toBe("old");
    l.reject(0, new Error("db down"));
    await flush();
    expect(await cache.getOrSet("k", l.load, 1600)).toBe("old");

    expect(errors).toEqual([new Error("db down")]);
    expect(l.started).toBe(2);
  });

  it("makes callers wait for fresh data once the value is too stale to show", async () => {
    const cache = new TtlCache<string>(1000, { maxStaleMs: 5000 });
    await cache.getOrSet("k", async () => "ancient", 0);

    expect(await cache.getOrSet("k", async () => "fresh", 6001)).toBe("fresh");
  });

  it("rejects when nothing is cached and the load fails, then retries next time", async () => {
    const cache = new TtlCache<string>(1000);

    await expect(
      cache.getOrSet("k", async () => Promise.reject(new Error("db down")), 0),
    ).rejects.toThrow("db down");
    expect(await cache.getOrSet("k", async () => "v1", 1)).toBe("v1");
  });

  it("doesn't let a load that started before clear() store its result", async () => {
    const cache = new TtlCache<string>(1000);
    const l = controlledLoad<string>();

    const before = cache.getOrSet("k", l.load, 0);
    cache.clear();
    l.resolve(0, "before-clear");
    await before;

    expect(await cache.getOrSet("k", async () => "after-clear", 1)).toBe("after-clear");
  });
});
