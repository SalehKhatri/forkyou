import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL, isApiKeyFormat, resolveApiUrl, webUrl } from "./config.js";

describe("resolveApiUrl", () => {
  it("uses the default when the setting is empty", () => {
    expect(resolveApiUrl(undefined)).toEqual({ url: DEFAULT_API_URL });
    expect(resolveApiUrl("  ")).toEqual({ url: DEFAULT_API_URL });
  });

  it("accepts https URLs and strips trailing slashes", () => {
    expect(resolveApiUrl("https://forkyou.example.com/api/")).toEqual({
      url: "https://forkyou.example.com/api",
    });
  });

  it("accepts plain http to this machine for local development", () => {
    expect(resolveApiUrl("http://localhost:3000/api")).toEqual({
      url: "http://localhost:3000/api",
    });
    expect(resolveApiUrl("http://127.0.0.1:4000")).toEqual({ url: "http://127.0.0.1:4000" });
  });

  it("refuses plain http to other hosts, so the key never travels unencrypted", () => {
    expect(resolveApiUrl("http://forkyou.example.com/api")).toEqual({
      url: DEFAULT_API_URL,
      warning: "forkyou.apiUrl must use https (http only for localhost); using the default",
    });
  });

  it("falls back to the default for values that aren't URLs", () => {
    expect(resolveApiUrl("forkyou.dev")).toEqual({
      url: DEFAULT_API_URL,
      warning: 'forkyou.apiUrl "forkyou.dev" isn\'t a URL; using the default',
    });
  });
});

describe("webUrl", () => {
  it("strips the /api proxy path", () => {
    expect(webUrl("https://forkyou.dev/api")).toBe("https://forkyou.dev");
    expect(webUrl("http://localhost:3000/api")).toBe("http://localhost:3000");
  });

  it("uses the origin when pointed at the API directly", () => {
    expect(webUrl("http://localhost:4000")).toBe("http://localhost:4000");
  });
});

describe("isApiKeyFormat", () => {
  it("accepts 2.0 keys", () => {
    expect(isApiKeyFormat("fy_3q2-dUe7Yb_0aX9kLmN4pQrStUvWxYz012345678")).toBe(true);
  });

  it("rejects 1.x keys (bare UUIDs) and other text", () => {
    expect(isApiKeyFormat("0b3f9b9e-6f43-4d6c-9a52-2f1d6f0c8a11")).toBe(false);
    expect(isApiKeyFormat("fy_")).toBe(false);
    expect(isApiKeyFormat("fy_has spaces in it and more")).toBe(false);
  });
});
