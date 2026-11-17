import { describe, expect, it } from "vitest";
import { formatDuration } from "./format.js";

describe("formatDuration", () => {
  it("shows minutes under an hour", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59)).toBe("0m");
    expect(formatDuration(45 * 60 + 30)).toBe("45m");
  });

  it("shows hours and minutes from an hour up", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(2 * 3600 + 5 * 60 + 59)).toBe("2h 5m");
    expect(formatDuration(26 * 3600)).toBe("26h 0m");
  });

  it("treats negative input as zero", () => {
    expect(formatDuration(-5)).toBe("0m");
  });
});
