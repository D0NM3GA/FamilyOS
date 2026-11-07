import { describe, expect, it } from "vitest";
import { BACKUP_LATE_MS, JOB_LATE_MS, heartbeatState } from "./heartbeat";

const NOW = new Date("2026-11-07T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const row = (lastOkAt: Date | null, lastErrorAt: Date | null = null) => ({ name: "money", lastOkAt, lastErrorAt, lastError: null, detail: null });

describe("heartbeatState", () => {
  it("never, ok, late and failing", () => {
    expect(heartbeatState(undefined, JOB_LATE_MS, NOW)).toBe("never");
    expect(heartbeatState(row(ago(60_000)), JOB_LATE_MS, NOW)).toBe("ok");
    expect(heartbeatState(row(ago(JOB_LATE_MS + 1)), JOB_LATE_MS, NOW)).toBe("late");
    expect(heartbeatState(row(ago(120_000), ago(60_000)), JOB_LATE_MS, NOW)).toBe("failing");
    // A good run after the failure clears it.
    expect(heartbeatState(row(ago(60_000), ago(120_000)), JOB_LATE_MS, NOW)).toBe("ok");
    expect(heartbeatState(row(ago(30 * 60 * 60_000)), BACKUP_LATE_MS, NOW)).toBe("ok");
    expect(heartbeatState(row(ago(37 * 60 * 60_000)), BACKUP_LATE_MS, NOW)).toBe("late");
  });
});
