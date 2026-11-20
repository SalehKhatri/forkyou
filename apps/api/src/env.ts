import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  WEB_URL: z.url().default("http://localhost:3000"),
  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),
  GITHUB_REDIRECT_URI: z.url().default("http://localhost:3000/api/auth/github/callback"),
  /**
   * GitHub ids (numbers, not usernames) of the super admins, comma-separated (ADR 0009). Empty
   * means nobody is a super admin, so no staff can be appointed.
   */
  SUPER_ADMIN_GITHUB_IDS: z
    .string()
    .default("")
    .refine((v) => /^\s*(\d+\s*(,\s*\d+\s*)*)?$/.test(v), {
      message: "Expected comma-separated GitHub ids, e.g. 12345,67890",
    })
    .transform((v) =>
      v
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map(Number),
    ),
});

export type Env = z.infer<typeof envSchema>;

/** Parse and validate the environment. Throws with a readable message on misconfiguration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
