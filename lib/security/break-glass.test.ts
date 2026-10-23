import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { breakGlassAllows, parseBreakGlass, readBreakGlass, resetBreakGlassCache } from "./break-glass";

/** Phase 42.7: the break-glass entrance only lets a request through with a live, matching secret. */
const dir = mkdtempSync(join(tmpdir(), "breakglass-"));
const file = join(dir, "state.json");
process.env.BREAK_GLASS_STATE = file;
const NOW = Date.UTC(2026, 9, 22, 12);
const SECRET = "s".repeat(48);
const state = (o: object = {}) =>
  JSON.stringify({ id: "bg-1", secret: SECRET, startedAt: new Date(NOW - 60_000).toISOString(), endsAt: new Date(NOW + 3_600_000).toISOString(), ...o });

beforeEach(() => {
  resetBreakGlassCache();
  rmSync(file, { force: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("break-glass", () => {
  test("off: no file, nothing gets through", async () => {
    expect(await readBreakGlass(NOW)).toBeNull();
    expect(await breakGlassAllows(SECRET, NOW)).toBe(false);
  });

  test("on: only the matching secret gets through", async () => {
    writeFileSync(file, state());
    expect(await breakGlassAllows(SECRET, NOW)).toBe(true);
    expect(await breakGlassAllows("s".repeat(47) + "t", NOW)).toBe(false);
    expect(await breakGlassAllows("", NOW)).toBe(false);
    expect(await breakGlassAllows(null, NOW)).toBe(false);
  });

  test("never past its end, and never more than 24 hours", () => {
    expect(parseBreakGlass(state(), NOW)?.id).toBe("bg-1");
    expect(parseBreakGlass(state({ endsAt: new Date(NOW - 1).toISOString() }), NOW)).toBeNull();
    expect(parseBreakGlass(state({ endsAt: new Date(NOW - 60_000 + 25 * 3_600_000).toISOString() }), NOW)).toBeNull();
    expect(parseBreakGlass(state({ secret: "short" }), NOW)).toBeNull();
    expect(parseBreakGlass("not json", NOW)).toBeNull();
  });

  test("an expired file stops working even while cached", async () => {
    writeFileSync(file, state({ endsAt: new Date(NOW + 1000).toISOString() }));
    expect(await breakGlassAllows(SECRET, NOW)).toBe(true);
    expect(await breakGlassAllows(SECRET, NOW + 2000)).toBe(false);
  });
});
