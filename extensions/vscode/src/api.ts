import { type MeResponse, meResponseSchema } from "@forkyou/shared";

/** How a failed request should be handled. See docs/extensions.md → Sync. */
export type ApiFailure =
  /** 401: the key is missing, wrong or revoked. Stop and ask for a new one. */
  | "unauthorized"
  /** 410: this extension version is no longer supported. Ask the user to update. */
  | "outdated"
  /** Other 4xx: a bug in the extension. Don't retry the same request. */
  | "rejected"
  /** 5xx or an unexpected response body. Retry later. */
  | "server"
  /** No response at all (offline, DNS, timeout). Retry later. */
  | "network";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: ApiFailure; status?: number; message: string };

/** Anything with Zod's `safeParse`, so this module doesn't need its own zod dependency. */
type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Read on every request, so a settings change applies without a reload. */
  baseUrl: () => string;
  fetch?: FetchFn;
  timeoutMs?: number;
}

/** Thin client for the ForkYou API. Never throws: every outcome is an `ApiResult`. */
export class ApiClient {
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** The key's owner. Used to check a key before saving it. */
  me(apiKey: string): Promise<ApiResult<MeResponse>> {
    return this.request("GET", "/v1/me", apiKey, undefined, meResponseSchema);
  }

  async request<T>(
    method: "GET" | "POST",
    path: string,
    apiKey: string,
    body: unknown,
    schema: Schema<T> | null,
  ): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.options.baseUrl()}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return { ok: false, failure: "network", message: errorMessage(error) };
    }

    if (!res.ok) {
      const failure: ApiFailure =
        res.status === 401
          ? "unauthorized"
          : res.status === 410
            ? "outdated"
            : res.status >= 500
              ? "server"
              : "rejected";
      return { ok: false, failure, status: res.status, message: await serverMessage(res) };
    }

    if (schema === null) return { ok: true, data: undefined as T };
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, failure: "server", status: res.status, message: "Unexpected response" };
  }
}

/** The `message` from the API's error envelope, or the HTTP status if there isn't one. */
async function serverMessage(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => undefined);
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body as { error?: { message?: unknown } };
    if (typeof error?.message === "string") return error.message;
  }
  return `HTTP ${res.status}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "Request timed out";
  return error instanceof Error ? error.message : String(error);
}
