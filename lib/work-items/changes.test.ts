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
