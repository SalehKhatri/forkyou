import { describe, expect, it } from "vitest";
import { formatDuration, languageName, percent } from "./format";

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [59, "0m"],
    [60, "1m"],
    [3720, "1h 2m"],
    [90_000, "25h 0m"],
    [-5, "0m"],
  ])("%i -> %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("languageName", () => {
  it("maps known ids and passes unknown ones through", () => {
    expect(languageName("typescriptreact")).toBe("TSX");
    expect(languageName("zig")).toBe("zig");
    expect(languageName(null)).toBe("—");
  });
});

describe("percent", () => {
  it("handles a zero total", () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
  });
});
