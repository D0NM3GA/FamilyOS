import { describe, expect, it } from "vitest";
import { planDosesDue, type DoseRow } from "./plan";
import { kindOff, listedKinds, nextOptIn } from "./prefs";
import { courseEnd } from "@/lib/meds/form";
import { planInstances } from "@/lib/tasks/instances";

/** Phase 68a: a dose is due (opt-in), and courses that end. */
const NOW = new Date(2026, 10, 8, 8, 0);
const at = (h: number, m = 0) => new Date(2026, 10, 8, h, m);
const dose = (o: Partial<DoseRow>): DoseRow => ({
  definitionId: "amox",
  dueDate: at(8, 10),
  title: "Amoxicillin",
  timeLabel: "8:10 AM",
  timed: true,
  active: true,
  status: "PENDING",
  assignedTo: { id: "ivy", firstName: "Ivy", adult: false },
  ...o,
});

describe("planDosesDue", () => {
  it("from 15 minutes before until the missed reminder takes over", () => {
    expect(planDosesDue([dose({ dueDate: at(8, 10) })], [{ id: "mom" }], NOW)).toHaveLength(1);
    expect(planDosesDue([dose({ dueDate: at(8, 20) })], [{ id: "mom" }], NOW)).toHaveLength(0);
    expect(planDosesDue([dose({ dueDate: at(6, 40) })], [{ id: "mom" }], NOW)).toHaveLength(1);
    expect(planDosesDue([dose({ dueDate: at(6, 30) })], [{ id: "mom" }], NOW)).toHaveLength(0);
    expect(planDosesDue([dose({ status: "DONE" }), dose({ timed: false }), dose({ active: false })], [{ id: "mom" }], NOW)).toHaveLength(0);
  });

  it("a kid's dose to who opted in and the kid; a grown-up's own to them only", () => {
    const [kid] = planDosesDue([dose({})], [{ id: "mom" }, { id: "dad" }], NOW);
    expect(kid.recipients.sort()).toEqual(["dad", "ivy", "mom"]);
    expect(kid).toMatchObject({ kind: "REMINDER_DOSE_DUE", title: "Time for Ivy's 8:10 AM dose of Amoxicillin", urgent: false });
    expect(kid.key).toBe("dose-due:amox:2026-11-08:0810");
    const [own] = planDosesDue([dose({ assignedTo: { id: "dad", firstName: "Dad", adult: true } })], [{ id: "mom" }], NOW);
    expect(own.recipients).toEqual(["dad"]);
    // A kid's bell doesn't wait on anyone opting in.
    expect(planDosesDue([dose({})], [], NOW)[0].recipients).toEqual(["ivy"]);
    expect(planDosesDue([dose({ assignedTo: null })], [], NOW)).toEqual([]);
  });
});

describe("opt-in kinds", () => {
  it("are off until switched on; others on until switched off", () => {
    expect(kindOff("REMINDER_DOSE_DUE", { off: [], optIn: [] })).toBe(true);
    expect(kindOff("REMINDER_DOSE_DUE", { off: [], optIn: ["REMINDER_DOSE_DUE"] })).toBe(false);
    expect(kindOff("REMINDER_DOSE", { off: [], optIn: [] })).toBe(false);
    expect(kindOff("REMINDER_DOSE", { off: ["REMINDER_DOSE"], optIn: [] })).toBe(true);
  });

  it("saving keeps hidden ones as they were", () => {
    expect(nextOptIn(["REMINDER_DOSE_DUE"], [], new Set())).toEqual(["REMINDER_DOSE_DUE"]);
    expect(nextOptIn([], ["REMINDER_DOSE_DUE"], new Set(["REMINDER_DOSE_DUE"]))).toEqual(["REMINDER_DOSE_DUE"]);
    expect(nextOptIn(["REMINDER_DOSE_DUE"], ["REMINDER_DOSE_DUE"], new Set())).toEqual([]);
  });

  it("is listed with Meds", () => {
    expect(listedKinds((app) => app !== "meds").map((k) => k.kind)).not.toContain("REMINDER_DOSE_DUE");
    expect(listedKinds(() => true).find((k) => k.kind === "REMINDER_DOSE_DUE")?.optIn).toBe(true);
  });
});

describe("a course of medicine", () => {
  const start = new Date(2026, 10, 8);
  it("after N days ends on start + N - 1; on a date, that day", () => {
    expect(courseEnd({ frequencyType: "DAILY", startDate: start, endMode: "days", endDays: 10 })).toEqual({ endDate: new Date(2026, 10, 17) });
    expect(courseEnd({ frequencyType: "DAILY", startDate: start, endMode: "date", endDate: new Date(2026, 10, 20) })).toEqual({ endDate: new Date(2026, 10, 20) });
    expect(courseEnd({ frequencyType: "DAILY", startDate: start, endMode: "never" })).toEqual({ endDate: null });
    expect(courseEnd({ frequencyType: "AS_NEEDED", startDate: start, endMode: "days", endDays: 3 })).toEqual({ endDate: null });
    expect(courseEnd({ frequencyType: "DAILY", startDate: start, endMode: "date", endDate: new Date(2026, 10, 1) })).toEqual({ error: "The last day can't be before it starts" });
    expect(courseEnd({ frequencyType: "DAILY", startDate: start, endMode: "days" })).toEqual({ error: "Say for how many days" });
  });

  it("plans nothing after its last day", () => {
    const def = { frequencyType: "DAILY" as const, startDate: start, interval: 1, daysOfWeek: [], timesOfDay: ["08:00"], assignmentStrategy: "FIXED" as const, endDate: new Date(2026, 10, 10) };
    const planned = planInstances(def, [], ["ivy"], start, new Date(2026, 10, 22));
    expect(planned.map((p) => p.dueDate.getDate())).toEqual([8, 9, 10]);
    expect(planInstances({ ...def, endDate: new Date(2026, 10, 7) }, [], ["ivy"], start, new Date(2026, 10, 22))).toEqual([]);
  });
});
