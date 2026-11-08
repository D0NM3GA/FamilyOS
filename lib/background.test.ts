import { describe, expect, it } from "vitest";
import { backgroundJobsEnabled } from "./background";

describe("background jobs switch", () => {
  it("on in production, never during next build, overridable", () => {
    expect(backgroundJobsEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(backgroundJobsEnabled({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBe(false);
    expect(backgroundJobsEnabled({ NODE_ENV: "production", BACKGROUND_JOBS: "0" })).toBe(false);
    expect(backgroundJobsEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(backgroundJobsEnabled({ NODE_ENV: "development", BACKGROUND_JOBS: "1" })).toBe(true);
    expect(backgroundJobsEnabled({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("a tick (Phase 61)", () => {
  it("runs every job even when one fails, and records each", async () => {
    const { runTick } = await import("./background");
    const ran: string[] = [];
    const ok: [string, string | null][] = [];
    const failed: string[] = [];
    const result = await runTick(
      [
        { name: "zone", run: async () => void ran.push("zone") },
        {
          name: "money",
          run: async () => {
            ran.push("money");
            throw new Error("bank feed down");
          },
        },
        { name: "entra", run: async () => void ran.push("entra") },
        { name: "cleanup", run: async () => (ran.push("cleanup"), "2 old sessions, 0 old notifications") },
      ],
      { ok: async (n, d) => void ok.push([n, d]), failed: async (n) => void failed.push(n) },
    );
    expect(result).toBe(false);
    expect(ran).toEqual(["zone", "money", "entra", "cleanup"]);
    expect(failed).toEqual(["money"]);
    expect(ok).toEqual([
      ["zone", null],
      ["entra", null],
      ["cleanup", "2 old sessions, 0 old notifications"],
    ]);
  });

  it("a heartbeat that can't be written doesn't stop the tick", async () => {
    const { runTick } = await import("./background");
    const ran: string[] = [];
    const result = await runTick(
      [
        { name: "zone", run: async () => void ran.push("zone") },
        { name: "money", run: async () => void ran.push("money") },
      ],
      {
        ok: async () => {
          throw new Error("database away");
        },
        failed: async () => {},
      },
    );
    expect(result).toBe(true);
    expect(ran).toEqual(["zone", "money"]);
  });
});

describe("the outside check-in", () => {
  it("adds /fail after a bad tick, and only takes http(s)", async () => {
    const { pingUrl } = await import("./background");
    expect(pingUrl("https://hc.example.com/ping/abc", true)).toBe("https://hc.example.com/ping/abc");
    expect(pingUrl("https://hc.example.com/ping/abc/", false)).toBe("https://hc.example.com/ping/abc/fail");
    expect(pingUrl("http://checks.home.test/ping/abc", false)).toBe("http://checks.home.test/ping/abc/fail");
    expect(pingUrl("file:///etc/passwd", true)).toBeNull();
    expect(pingUrl("not a url", true)).toBeNull();
    expect(pingUrl(undefined, true)).toBeNull();
  });

  it("never throws, whatever the checker does", async () => {
    const { ping } = await import("./background");
    await expect(ping("https://hc.example.com/x", true, (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch)).resolves.toBeUndefined();
    const seen: string[] = [];
    await ping("https://hc.example.com/x", false, (async (u: string) => (seen.push(u), new Response("", { status: 200 }))) as unknown as typeof fetch);
    expect(seen).toEqual(["https://hc.example.com/x/fail"]);
  });
});

describe("a job that hangs (Phase 67b)", () => {
  it("is recorded as timed out, and the jobs after it still run", async () => {
    const { runTick } = await import("./background");
    const ran: string[] = [];
    const failed: [string, string][] = [];
    const ok: string[] = [];
    const result = await runTick(
      [
        { name: "entra", run: () => new Promise(() => {}) },
        { name: "reminders", run: async () => void ran.push("reminders") },
      ],
      { ok: async (n) => void ok.push(n), failed: async (n, err) => void failed.push([n, err instanceof Error ? err.message : String(err)]) },
      20,
    );
    expect(result).toBe(false);
    expect(failed).toEqual([["entra", "timed out"]]);
    expect(ran).toEqual(["reminders"]);
    expect(ok).toEqual(["reminders"]);
  });

  it("a job that throws before its first await is still caught", async () => {
    const { runTick } = await import("./background");
    const failed: string[] = [];
    const result = await runTick(
      [
        {
          name: "zone",
          run: () => {
            throw new Error("at once");
          },
        },
      ],
      { ok: async () => {}, failed: async (n) => void failed.push(n) },
      20,
    );
    expect(result).toBe(false);
    expect(failed).toEqual(["zone"]);
  });
});
