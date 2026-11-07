import { describe, expect, it } from "vitest";
import { assignmentChanges } from "./changes";
import { EVENT_VALUE_MAX, eventDate, eventValue } from "./events";

const base = { className: "Math", title: "Ch 3", kind: "HOMEWORK", dueDate: new Date(2026, 10, 9), notes: null, status: "TODO", score: null, maxScore: null };

describe("assignmentChanges", () => {
  it("records nothing when nothing changed", () => {
    expect(assignmentChanges(base, { ...base })).toEqual([]);
  });

  it("records each changed field with its old and new value", () => {
    const changes = assignmentChanges(base, { ...base, title: "Chapter 3", kind: "TEST", dueDate: new Date(2026, 10, 12) });
    expect(changes).toEqual([
      { itemType: "ASSIGNMENT", action: "EDIT", field: "title", fromValue: "Ch 3", toValue: "Chapter 3" },
      { itemType: "ASSIGNMENT", action: "EDIT", field: "kind", fromValue: "HOMEWORK", toValue: "TEST" },
      { itemType: "ASSIGNMENT", action: "EDIT", field: "dueDate", fromValue: "2026-11-09", toValue: "2026-11-12" },
    ]);
  });

  it("says a note changed without keeping its words", () => {
    expect(assignmentChanges(base, { ...base, notes: "Bring the calculator" })).toEqual([{ itemType: "ASSIGNMENT", action: "EDIT", field: "notes" }]);
    expect(assignmentChanges({ ...base, notes: "" }, { ...base, notes: null })).toEqual([]);
  });

  it("records a status change and a grade as their own kinds of event", () => {
    expect(assignmentChanges(base, { ...base, status: "DONE", score: 18, maxScore: 20 })).toEqual([
      { itemType: "ASSIGNMENT", action: "STATUS", fromValue: "TODO", toValue: "DONE" },
      { itemType: "ASSIGNMENT", action: "GRADE", fromValue: null, toValue: "18/20" },
    ]);
  });

  it("notices a due date being cleared", () => {
    expect(assignmentChanges(base, { ...base, dueDate: null })).toEqual([
      { itemType: "ASSIGNMENT", action: "EDIT", field: "dueDate", fromValue: "2026-11-09", toValue: null },
    ]);
  });
});

describe("event values", () => {
  it("caps long text and drops empty text", () => {
    expect(eventValue("x".repeat(500))).toHaveLength(EVENT_VALUE_MAX);
    expect(eventValue("")).toBeNull();
    expect(eventValue("Ch 3")).toBe("Ch 3");
    const cut = eventValue(`${"x".repeat(198)}🎒🎒🎒`)!;
    expect(Array.from(cut)).toHaveLength(EVENT_VALUE_MAX);
    expect(cut.endsWith("🎒…")).toBe(true);
  });
  it("writes a due date as the family's own day", () => {
    expect(eventDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(eventDate(null)).toBeNull();
  });
});

import { putBackValues, taskChanges } from "./changes";
import { canEditAssignmentDetails } from "@/lib/school/permissions";
import { parseAssignmentDetails, parseGrade } from "@/lib/school/form";

describe("Phase 59.2a: kids' own changes", () => {
  const kid = { id: "ivy", role: "KID" as const };
  it("lets a kid change their own work's details until it's missing or graded", () => {
    expect(canEditAssignmentDetails(kid, { studentId: "ivy", status: "TODO", score: null })).toBe(true);
    expect(canEditAssignmentDetails(kid, { studentId: "ivy", status: "DONE", score: null })).toBe(true);
    expect(canEditAssignmentDetails(kid, { studentId: "ivy", status: "MISSING", score: null })).toBe(false);
    expect(canEditAssignmentDetails(kid, { studentId: "ivy", status: "DONE", score: 9 })).toBe(false);
    expect(canEditAssignmentDetails(kid, { studentId: "max", status: "TODO", score: null })).toBe(false);
    expect(canEditAssignmentDetails({ id: "dad", role: "ADULT" }, { studentId: "ivy", status: "MISSING", score: 9 })).toBe(true);
  });

  it("puts back each field to what it was before the kid's first change since the last review", () => {
    const e = (action: string, field: string | null, fromValue: string | null, actorId: string) => ({ action, field, fromValue, actorId });
    const events = [
      e("EDIT", "dueDate", "2026-11-01", "ivy"),
      e("APPROVE", null, null, "dad"),
      e("EDIT", "dueDate", "2026-11-09", "ivy"),
      e("EDIT", "title", "Ch 3", "ivy"),
      e("EDIT", "dueDate", "2026-11-12", "ivy"),
      e("EDIT", "className", "Math", "dad"), // a grown-up's own edit isn't the kid's to put back
      e("EDIT", "notes", null, "ivy"), // not a field a kid's quick edit changes
    ];
    expect(putBackValues(events, "ivy")).toEqual({ dueDate: "2026-11-09", title: "Ch 3" });
    expect(putBackValues([...events, e("PUT_BACK", "title", "x", "dad")], "ivy")).toEqual({});
    // A due date that was blank before puts back to blank: the key is there, with null.
    expect(putBackValues([e("EDIT", "dueDate", null, "ivy")], "ivy")).toEqual({ dueDate: null });
  });
});

describe("Phase 59.2a: quick-edit parsing", () => {
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  it("reads the details a quick edit changes", () => {
    expect(parseAssignmentDetails(fd({ className: "Math", title: "Unit test", kind: "TEST", dueDate: "2026-11-12" }))).toMatchObject({ ok: true, fields: { kind: "TEST" } });
    expect(parseAssignmentDetails(fd({ className: "", title: "x" })).ok).toBe(false);
    expect(parseAssignmentDetails(fd({ className: "Math", title: "x", kind: "EXAM" })).ok).toBe(false);
  });
  it("needs a score with its out-of, or neither", () => {
    expect(parseGrade(fd({ score: "18", maxScore: "20" }))).toEqual({ ok: true, fields: { score: 18, maxScore: 20 } });
    expect(parseGrade(fd({}))).toEqual({ ok: true, fields: { score: null, maxScore: null } });
    expect(parseGrade(fd({ score: "18" })).ok).toBe(false);
    expect(parseGrade(fd({ score: "1", maxScore: "0" })).ok).toBe(false);
  });
});

describe("Phase 59.2a: taskChanges", () => {
  const t = { title: "Slip", kind: "FORM", kid: "Ivy", owner: null, dueDate: null, amount: null, notes: null };
  it("records a new owner as a hand-over, and other fields as edits", () => {
    expect(taskChanges(t, { ...t, owner: "Mom", amount: "$12.50" })).toEqual([
      { itemType: "SCHOOL_TASK", action: "ASSIGN", fromValue: null, toValue: "Mom" },
      { itemType: "SCHOOL_TASK", action: "EDIT", field: "amount", fromValue: null, toValue: "$12.50" },
    ]);
    expect(taskChanges(t, { ...t })).toEqual([]);
  });
});
