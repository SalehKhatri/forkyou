import { describe, expect, it } from "vitest";
import { loadEnv } from "../env.js";
import { can, outranks, staffRoleOf } from "./staff.js";

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://unused/test",
  SUPER_ADMIN_GITHUB_IDS: "7, 42",
});

describe("SUPER_ADMIN_GITHUB_IDS", () => {
  it("parses comma-separated GitHub ids, tolerating spaces", () => {
    expect(env.SUPER_ADMIN_GITHUB_IDS).toEqual([7, 42]);
  });

  it("is empty by default, so nobody is a super admin", () => {
    const plain = loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgres://unused/test" });

    expect(plain.SUPER_ADMIN_GITHUB_IDS).toEqual([]);
  });

  it("refuses usernames, so a renamed or recycled GitHub login can't become super admin", () => {
    expect(() =>
      loadEnv({ DATABASE_URL: "postgres://unused/test", SUPER_ADMIN_GITHUB_IDS: "octocat" }),
    ).toThrow("Expected comma-separated GitHub ids");
  });
});

describe("staffRoleOf", () => {
  it("makes configured GitHub ids super admins, whatever is stored", () => {
    expect(staffRoleOf({ githubId: 42, staffRole: null }, env)).toBe("super_admin");
    expect(staffRoleOf({ githubId: 42, staffRole: "moderator" }, env)).toBe("super_admin");
  });

  it("uses the stored role for everyone else", () => {
    expect(staffRoleOf({ githubId: 5, staffRole: "admin" }, env)).toBe("admin");
    expect(staffRoleOf({ githubId: 5, staffRole: null }, env)).toBeNull();
  });
});

describe("can", () => {
  it("gives moderators review and leaderboard moderation only", () => {
    expect(can("moderator", "review")).toBe(true);
    expect(can("moderator", "moderate")).toBe(true);
    expect(can("moderator", "revokeKeys")).toBe(false);
    expect(can("moderator", "readAudit")).toBe(false);
    expect(can("moderator", "manageStaff")).toBe(false);
  });

  it("adds key revocation and the audit log for admins, but not managing staff", () => {
    expect(can("admin", "revokeKeys")).toBe(true);
    expect(can("admin", "readAudit")).toBe(true);
    expect(can("admin", "manageStaff")).toBe(false);
  });

  it("gives super admins everything", () => {
    expect(can("super_admin", "manageStaff")).toBe(true);
    expect(can("super_admin", "review")).toBe(true);
  });

  it("gives non-staff nothing", () => {
    expect(can(null, "review")).toBe(false);
  });
});

describe("outranks", () => {
  it("lets staff act only on lower ranks", () => {
    expect(outranks("moderator", null)).toBe(true);
    expect(outranks("admin", "moderator")).toBe(true);
    expect(outranks("super_admin", "admin")).toBe(true);
  });

  it("never lets staff act on their own rank or above", () => {
    expect(outranks("moderator", "moderator")).toBe(false);
    expect(outranks("moderator", "admin")).toBe(false);
    expect(outranks("admin", "super_admin")).toBe(false);
    expect(outranks("super_admin", "super_admin")).toBe(false);
  });

  it("gives non-staff no rank over anyone", () => {
    expect(outranks(null, null)).toBe(false);
  });
});
