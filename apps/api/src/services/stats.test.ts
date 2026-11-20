import { describe, expect, it } from "vitest";
import { countStreaks } from "./stats.js";

describe("countStreaks", () => {
  it("is zero with no coding at all", () => {
    expect(countStreaks([], "2026-11-16")).toEqual({ current: 0, longest: 0 });
  });

  it("counts a run that includes today as current", () => {
    expect(countStreaks(["2026-11-14", "2026-11-15", "2026-11-16"], "2026-11-16")).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it("keeps the streak going when the last coding was yesterday, since today isn't over", () => {
    expect(countStreaks(["2026-11-14", "2026-11-15"], "2026-11-16")).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it("breaks the current streak after a whole day without coding, keeping the longest", () => {
    expect(countStreaks(["2026-11-13", "2026-11-14"], "2026-11-16")).toEqual({
      current: 0,
      longest: 2,
    });
  });

  it("reports the longest run even when it was long ago", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-11-10", "2026-11-16"];

    expect(countStreaks(days, "2026-11-16")).toEqual({ current: 1, longest: 3 });
  });

  it("counts across month ends and leap days", () => {
    expect(countStreaks(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01")).toEqual({
      current: 3,
      longest: 3,
    });
  });
});
