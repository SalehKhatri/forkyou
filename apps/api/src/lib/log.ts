/**
 * Structured logs. Production writes one JSON object per line, so the host's log viewer (or `jq`)
 * can compute request rates, latency percentiles and error rates; development writes short
 * readable lines. See docs/deployment.md → Logs.
 *
 * Never log personal data or secrets: no API keys, cookies, request bodies, query strings, IP
 * addresses, usernames or user ids (CLAUDE.md → privacy).
 */
export type LogValue = string | number | boolean | null | Record<string, number>;
export type LogFields = Record<string, LogValue>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  /** `error` is logged as its stack trace (or message) under `error`. */
  error(msg: string, error: unknown, fields?: LogFields): void;
}

export type LogFormat = "json" | "pretty";

export function createLogger(
  format: LogFormat,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  now: () => Date = () => new Date(),
): Logger {
  const emit = (level: "info" | "error", msg: string, fields: LogFields = {}) => {
    if (format === "json") {
      write(JSON.stringify({ time: now().toISOString(), level, msg, ...fields }));
    } else {
      write(pretty(level, msg, fields));
    }
  };
  return {
    info: (msg, fields) => emit("info", msg, fields),
    error: (msg, error, fields = {}) => emit("error", msg, { ...fields, error: describe(error) }),
  };
}

/** A logger that keeps lines in memory, for tests. */
export function memoryLogger(): Logger & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger("json", (line) => lines.push(JSON.parse(line)));
  return { ...logger, lines };
}

function pretty(level: string, msg: string, fields: LogFields): string {
  if (msg === "request") {
    return `${fields.method} ${fields.route} ${fields.status} ${fields.ms}ms`;
  }
  const rest = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join(" ");
  return `${level === "error" ? "ERROR " : ""}${msg}${rest ? ` ${rest}` : ""}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
