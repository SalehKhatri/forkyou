import { describe, expect, it } from "vitest";
import { parseTheme, revealRadius, themeCookie } from "./theme";

describe("parseTheme", () => {
  it("is light by default, with no cookie", () => {
    expect(parseTheme(undefined)).toBe("light");
  });

  it("is dark only when dark was chosen", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
  });

  it("treats anything unexpected as light", () => {
    expect(parseTheme("DARK")).toBe("light");
    expect(parseTheme("")).toBe("light");
  });
});

describe("themeCookie", () => {
  it("stores the theme site-wide for a year", () => {
    expect(themeCookie("dark")).toBe("fy_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
  });
});

describe("revealRadius", () => {
  it("reaches the farthest corner of the viewport", () => {
    // From the top-right corner of a 1000×600 viewport, the farthest corner is bottom-left.
    expect(revealRadius(1000, 0, 1000, 600)).toBeCloseTo(Math.hypot(1000, 600));
  });

  it("covers the viewport from its centre", () => {
    expect(revealRadius(500, 300, 1000, 600)).toBeCloseTo(Math.hypot(500, 300));
  });
});
