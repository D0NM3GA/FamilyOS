import { describe, expect, it } from "vitest";
import { planChores, planHomework, type HomeworkRow } from "./plan";
import { digestLines } from "./digest";
import { listedKinds } from "./prefs";

/** Phase 68b: homework due tomorrow, chores still open at 6 pm, and a fuller morning summary. */
const day = (h: number) => new Date(2026, 10, 8, h, 0);
const max = { id: "max", firstName: "Max" };
const ivy = { id: "ivy", firstName: "Ivy" };
const work = (o: Partial<HomeworkRow>): HomeworkRow => ({ id: "a1", title: "Fractions", kind: "QUIZ", className: "Math", dueDate: new Date(2026, 10, 9), status: "TODO", kid: max, ...o });

describe("planHomework", () => {
  it("from 3 pm the day before, to the kid and the grown-ups", () => {
    expect(planHomework([work({})], [{ id: "mom" }], day(14))).toEqual([]);
    const [r] = planHomework([work({})], [{ id: "mom" }], day(15));
    expect(r).toMatchObject({ kind: "REMINDER_HOMEWORK", key: "homework:a1:2026-11-09", title: "Max has a quiz due tomorrow: Fractions", href: "/school?kid=max" });
    expect(r.recipients.sort()).toEqual(["max", "mom"]);
  });

  it("not when it's done, or due another day", () => {
    expect(planHomework([work({ status: "DONE" }), work({ dueDate: new Date(2026, 10, 10) }), work({ dueDate: new Date(2026, 10, 8) })], [], day(16))).toEqual([]);
  });
});

describe("planChores", () => {
  it("from 6 pm, a bell per kid and one line for the grown-ups", () => {
    const rows = [{ kid: ivy }, { kid: ivy }, { kid: max }];
    expect(planChores(rows, [{ id: "mom" }], day(17))).toEqual([]);
    const plans = planChores(rows, [{ id: "mom" }, { id: "dad" }], day(18));
    expect(plans.map((p) => [p.key, p.recipients, p.title])).toEqual([
      ["chores:ivy:2026-11-08", ["ivy"], "2 chores still to do today"],
      ["chores:max:2026-11-08", ["max"], "1 chore still to do today"],
      ["chores:all:2026-11-08", ["mom", "dad"], "Still to do today: Ivy 2, Max 1"],
    ]);
  });

  it("nothing open, nothing sent", () => {
    expect(planChores([], [{ id: "mom" }], day(19))).toEqual([]);
  });
});

describe("the morning summary's new lines", () => {
  it("school events, schoolwork due today and dinner", () => {
    const lines = digestLines({ choresMine: 0, choresAll: 0, dosesMine: 0, dosesAll: 0, school: [], cars: [], dates: [], schoolEvents: ["Early dismissal"], homework: ["Max, a quiz: Fractions"], dinner: "Tacos" });
    expect(lines).toEqual(["At school today: Early dismissal", "Due today: Max, a quiz: Fractions", "Dinner tonight: Tacos"]);
  });
});

describe("the new kinds are listed with their apps", () => {
  it("homework with School, chores with Chores", () => {
    expect(listedKinds((app) => app === "school").map((k) => k.kind)).toContain("REMINDER_HOMEWORK");
    expect(listedKinds((app) => app === "chores").map((k) => k.kind)).toContain("REMINDER_CHORES");
    expect(listedKinds((app) => app === "meds").map((k) => k.kind)).not.toContain("REMINDER_CHORES");
  });
});
