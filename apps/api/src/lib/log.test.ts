import { describe, expect, it } from "vitest";
import { createLogger } from "./log.js";

const NOW = new Date("2026-11-18T09:00:00.000Z");

function capture(format: "json" | "pretty") {
  const lines: string[] = [];
  return {
    logger: createLogger(
      format,
      (line) => lines.push(line),
      () => NOW,
    ),
    lines,
  };
}

describe("createLogger", () => {
  it("writes one JSON object per line in json format", () => {
    const { logger, lines } = capture("json");

    logger.info("request", { method: "GET", route: "/v1/me", status: 200, ms: 4.2 });

    expect(lines).toEqual([
      '{"time":"2026-11-18T09:00:00.000Z","level":"info","msg":"request","method":"GET","route":"/v1/me","status":200,"ms":4.2}',
    ]);
  });

  it("includes an error's stack under `error`", () => {
    const { logger, lines } = capture("json");
    const error = new Error("boom");

    logger.error("unhandled error", error, { requestId: "abc" });

    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      time: "2026-11-18T09:00:00.000Z",
      level: "error",
      msg: "unhandled error",
      requestId: "abc",
      error: error.stack,
    });
  });

  it("writes short readable lines in pretty format", () => {
    const { logger, lines } = capture("pretty");

    logger.info("request", { method: "POST", route: "/v1/sessions", status: 200, ms: 12.5 });
    logger.info("ingest", { accepted: 2, rejected: { overlaps_existing: 1 } });
    logger.error("leaderboard refresh failed", "db down", { range: "week" });

    expect(lines).toEqual([
      "POST /v1/sessions 200 12.5ms",
      'ingest accepted=2 rejected={"overlaps_existing":1}',
      "ERROR leaderboard refresh failed range=week error=db down",
    ]);
  });
});
