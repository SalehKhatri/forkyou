import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";
import { errorBody } from "./errors.js";

/** zValidator that answers with the standard error envelope instead of Zod's raw output. */
export const validate = <T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(errorBody("invalid_request", z.prettifyError(result.error)), 400);
    }
  });
