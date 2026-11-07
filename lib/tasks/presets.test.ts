import { describe, expect, test } from "vitest";
import { presetIds } from "./presets";

const day = (d: number) => new Date(2026, 10, d);
const today = day(7);
const row = (id: string, d: number, o: Partial<{ status: string; assignedToId: string | null }> = {}) => ({ id, dueDate: day(d), status: "PENDING", assignedToId: "ivy", ...o });

describe("presetIds (Phase 59.3)", () => {
  const board = {
    dueToday: [row("t1", 7), row("t2", 7, { status: "DONE" }), row("t3", 7, { assignedToId: null }), row("t4", 7, { assignedToId: "max" })],
    upcoming: [row("u1", 8), row("u2", 9), row("u3", 8, { status: "SKIPPED" })],
  };
  test("a sick day is what they still have today", () => {
    expect(presetIds(board, "ivy", today).sickDayIds).toEqual(["t1"]);
  });
  test("a hand-off is what they still have today and tomorrow, not later", () => {
    expect(presetIds(board, "ivy", today).handOffIds).toEqual(["t1", "u1"]);
  });
  test("nothing for someone with nothing", () => {
    expect(presetIds(board, "dad", today)).toEqual({ sickDayIds: [], handOffIds: [] });
  });
});
