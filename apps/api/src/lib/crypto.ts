import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** API keys carry a recognisable prefix so leaked keys are easy to spot (e.g. by secret scanners). */
export function generateApiKey(): string {
  return `fy_${generateToken()}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
