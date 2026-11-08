import { describe, expect, test } from "vitest";
import { dosesLeft, nextAllowed, notYetWords } from "./as-needed";
import { firstOccurrenceOnOrAfter } from "@/lib/tasks/schedule";
import { describeRecurrence } from "@/lib/tasks/format";
import { medFormSchema } from "./form";

const at = (h: number, m = 0) => new Date(2026, 10, 7, h, m);
const now = at(12);

describe("as-needed medicines (Phase 65a)", () => {
  test("no limits, or no doses yet: take now", () => {
    expect(nextAllowed([at(11)], { minGapHours: null, maxPerDay: null }, now)).toEqual({ ok: true });
    expect(nextAllowed([], { minGapHours: 4, maxPerDay: 2 }, now)).toEqual({ ok: true });
  });

  test("the gap counts from the last dose", () => {
    expect(nextAllowed([at(6), at(10)], { minGapHours: 4, maxPerDay: null }, now)).toEqual({ ok: false, from: at(14), reason: "gap" });
    expect(nextAllowed([at(8)], { minGapHours: 4, maxPerDay: null }, now)).toEqual({ ok: true });
  });

  test("the maximum is over any 24 hours: the oldest that must age out decides", () => {
    const yesterday = (h: number) => new Date(2026, 10, 6, h);
    // Three in the last day, at most 3: the next fits when the 1 PM one yesterday ages out.
    expect(nextAllowed([yesterday(13), at(2), at(9)], { minGapHours: null, maxPerDay: 3 }, now)).toEqual({ ok: false, from: at(13), reason: "max" });
    // One from 25 hours ago doesn't count.
    expect(nextAllowed([yesterday(11), at(2), at(9)], { minGapHours: null, maxPerDay: 3 }, now)).toEqual({ ok: true });
  });

  test("with both, the later wins", () => {
    const r = nextAllowed([new Date(2026, 10, 6, 13), at(2), at(11)], { minGapHours: 4, maxPerDay: 3 }, now);
    expect(r).toEqual({ ok: false, from: at(15), reason: "gap" });
  });

  test("words", () => {
    const r = nextAllowed([at(10)], { minGapHours: 4, maxPerDay: null }, now);
    if (r.ok) throw new Error("expected not yet");
    expect(notYetWords(r, { minGapHours: 4, maxPerDay: null }, now)).toMatch(/^Too soon\. Next from 2:00\sPM\.$/);
    const tomorrow = nextAllowed([at(2), at(3)], { minGapHours: null, maxPerDay: 2 }, now);
    if (tomorrow.ok) throw new Error("expected not yet");
    expect(notYetWords(tomorrow, { minGapHours: null, maxPerDay: 2 }, now)).toMatch(/^That's 2 in 24 hours\. Next from Sun 2:00\sAM\.$/);
  });

  test("doses left, no schedule, the form", () => {
    expect(dosesLeft(9, 2)).toBe(4);
    expect(dosesLeft(0.3, 0.1)).toBe(3);
    expect(dosesLeft(null, 1)).toBeNull();
    const rule = { frequencyType: "AS_NEEDED" as const, interval: null, daysOfWeek: [], startDate: new Date(2026, 0, 1) };
    expect(firstOccurrenceOnOrAfter(rule, now)).toBeNull();
    expect(describeRecurrence(rule)).toBe("As needed");
    const form = { title: "Ibuprofen", frequencyType: "AS_NEEDED", daysOfWeek: [], startDate: "2026-01-01", points: 0, timesOfDay: [], assigneeIds: ["p1"] };
    expect(medFormSchema.safeParse({ ...form, minGapHours: "6", maxPerDay: "4" }).success).toBe(true);
    expect(medFormSchema.safeParse({ ...form, frequencyType: "DAILY" }).success).toBe(false);
    expect(medFormSchema.safeParse({ ...form, maxPerDay: "0" }).success).toBe(false);
    expect(medFormSchema.safeParse({ ...form, minGapHours: "0.25" }).success).toBe(false);
  });
});
