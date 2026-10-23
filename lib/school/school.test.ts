import { describe, expect, it } from "vitest";
import { parseAssignmentForm, parseProfileForm, parseTaskForm } from "./form";
import { byDueDate, classAverages, isOverdue } from "./rules";

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe("parseProfileForm", () => {
  it("requires a school name; blanks become null", () => {
    expect(parseProfileForm(fd({ schoolName: " " })).ok).toBe(false);
    expect(parseProfileForm(fd({ schoolName: " Lincoln Elementary ", grade: "3rd", lunchNotes: "" }))).toEqual({
      ok: true,
      fields: { schoolName: "Lincoln Elementary", grade: "3rd", schoolYear: null, transportNotes: null, lunchNotes: null, scheduleNotes: null, notes: null },
    });
  });
});

describe("parseTaskForm", () => {
  it("parses a fee with a dollar amount and a date", () => {
    const r = parseTaskForm(fd({ title: "Field trip", kind: "FEE", amount: "$12.50", dueDate: "2026-10-02", kidPersonId: "k1", ownerPersonId: "" }));
    expect(r).toMatchObject({ ok: true, fields: { title: "Field trip", kind: "FEE", amountCents: 1250, kidPersonId: "k1", ownerPersonId: null } });
    expect(r.ok && r.fields.dueDate?.getDate()).toBe(2);
  });
  it("rejects a bad kind, date or amount", () => {
    expect(parseTaskForm(fd({ title: "x", kind: "NOPE" })).ok).toBe(false);
    expect(parseTaskForm(fd({ title: "x", kind: "FORM", dueDate: "2026-02-30" })).ok).toBe(false);
    expect(parseTaskForm(fd({ title: "x", kind: "FORM", amount: "lots" })).ok).toBe(false);
  });
});

describe("parseAssignmentForm", () => {
  it("needs class and title; a score needs its out-of", () => {
    expect(parseAssignmentForm(fd({ className: "", title: "x" })).ok).toBe(false);
    expect(parseAssignmentForm(fd({ className: "Math", title: "Quiz", score: "8" })).ok).toBe(false);
    expect(parseAssignmentForm(fd({ className: "Math", title: "Quiz", score: "8", maxScore: "0" })).ok).toBe(false);
    expect(parseAssignmentForm(fd({ className: "Math", title: "Quiz", score: "8", maxScore: "10" }))).toMatchObject({
      ok: true,
      fields: { status: "TODO", score: 8, maxScore: 10, dueDate: null },
    });
  });
});

describe("rules", () => {
  const today = new Date(2026, 8, 25, 15);
  it("overdue is TODO before today, never MISSING or DONE or undated", () => {
    expect(isOverdue({ status: "TODO", dueDate: new Date(2026, 8, 24) }, today)).toBe(true);
    expect(isOverdue({ status: "TODO", dueDate: new Date(2026, 8, 25) }, today)).toBe(false);
    expect(isOverdue({ status: "DONE", dueDate: new Date(2026, 8, 1) }, today)).toBe(false);
    expect(isOverdue({ status: "TODO", dueDate: null }, today)).toBe(false);
  });

  it("class average weighs by points, groups case-insensitively, ignores unscored", () => {
    expect(
      classAverages([
        { className: "Math", score: 9, maxScore: 10 },
        { className: "math ", score: 30, maxScore: 50 },
        { className: "Math", score: null, maxScore: null },
        { className: "Art", score: 5, maxScore: 5 },
      ]),
    ).toEqual([
      { className: "Art", percent: 100, graded: 1 },
      { className: "Math", percent: 65, graded: 2 },
    ]);
  });

  it("sorts soonest first, undated last", () => {
    const items = [
      { title: "b", dueDate: null },
      { title: "c", dueDate: new Date(2026, 9, 2) },
      { title: "a", dueDate: new Date(2026, 9, 1) },
    ];
    expect(items.sort(byDueDate).map((i) => i.title)).toEqual(["a", "c", "b"]);
  });
});
