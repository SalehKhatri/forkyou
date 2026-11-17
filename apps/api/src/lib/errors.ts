import type { ApiError } from "@forkyou/shared";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Throw from any handler to return the standard error envelope. */
export class AppError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(status, { message });
  }
}

export const unauthorized = () => new AppError(401, "unauthorized", "Authentication required");
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);

export function errorBody(code: string, message: string): ApiError {
  return { error: { code, message } };
}
