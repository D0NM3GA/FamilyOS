import { describe, expect, it } from "vitest";
import { describeError, logLine } from "./log";

describe("logLine", () => {
  it("is one JSON object with time, level, event and the fields", () => {
    const line = logLine("info", "jobs.tick", { ms: 12, ok: true, skipped: undefined }, new Date("2026-11-07T12:00:00Z"));
    expect(JSON.parse(line)).toEqual({ time: "2026-11-07T12:00:00.000Z", level: "info", event: "jobs.tick", ms: 12, ok: true });
    expect(line).not.toContain("\n");
  });

  it("scrubs and clips string fields", () => {
    const line = JSON.parse(logLine("warn", "x", { url: "https://graph.example.com/me?$filter=mail eq 'dad@example.com'", long: "a".repeat(500) }));
    expect(line.url).not.toContain("example.com'");
    expect(line.long.length).toBeLessThanOrEqual(300);
  });
});

describe("describeError", () => {
  it("keeps a Prisma error to its class and code", () => {
    class PrismaClientKnownRequestError extends Error {
      code = "P2002";
    }
    expect(describeError(new PrismaClientKnownRequestError("Unique constraint failed on the fields: (`email`) value dad@example.com"))).toBe("PrismaClientKnownRequestError P2002");
  });

  it("gives other errors their class and a scrubbed message", () => {
    expect(describeError(new TypeError("fetch failed"))).toBe("TypeError: fetch failed");
    expect(describeError("plain")).toBe("plain");
    expect(describeError(42)).toBe("unknown error");
  });
});
