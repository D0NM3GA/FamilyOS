import { describe, expect, it } from "vitest";
import { assignmentItem, type AssignmentLike } from "./assignment";
import { choreItem, type ChoreLike } from "./chore";
import { schoolTaskItem } from "./school-task";
import { canRemoveAssignment, canSetAssignmentStatus } from "@/lib/school/permissions";
import { canDoChore, canSkipChore, canUndoChore } from "@/lib/tasks/permissions";
import { bucketInstances } from "@/lib/tasks/queries";
import { atMidnight, addDays } from "@/lib/tasks/schedule";

const now = new Date(2026, 10, 7, 15); // Saturday afternoon
const day = (d: number) => new Date(2026, 10, d);
const dad = { id: "dad", role: "ADULT" as const };
const ivy = { id: "ivy", role: "KID" as const };
const max = { id: "max", role: "KID" as const };
const values = (opts?: { value: string }[]) => (opts ?? []).map((o) => o.value);

describe("chore permissions", () => {
  it("a kid does their own, or an Anyone one only where the board allows grabbing", () => {
    const kid = { id: "ivy", adult: false };
    expect(canDoChore(kid, { assignedToId: "ivy" }, false)).toBe(true);
    expect(canDoChore(kid, { assignedToId: "max" }, true)).toBe(false);
    expect(canDoChore(kid, { assignedToId: null }, true)).toBe(true);
    expect(canDoChore(kid, { assignedToId: null }, false)).toBe(false);
    expect(canUndoChore(kid, { completedById: "max" })).toBe(false);
    expect(canUndoChore({ id: "dad", adult: true }, { completedById: "max" })).toBe(true);
    expect(canSkipChore(kid)).toBe(false);
    expect(canSkipChore({ id: "dad", adult: true })).toBe(true);
  });
});

describe("choreItem", () => {
  const chore = (over: Partial<ChoreLike> = {}): ChoreLike => ({
    id: "c1",
    dueDate: day(7),
    status: "PENDING",
    completedAt: null,
    definition: { title: "Feed the fish" },
    assignedTo: { id: "ivy", firstName: "Ivy" },
    completedBy: null,
    ...over,
  });

  it("reads overdue, due today and to do from the due day", () => {
    expect(choreItem(chore({ dueDate: day(6) }), dad, { skippable: true, now }).looks.PENDING).toMatchObject({ status: "OVERDUE", tone: "late" });
    expect(choreItem(chore(), dad, { skippable: true, now }).looks.PENDING).toMatchObject({ status: "DUE_TODAY", label: "Due today" });
    expect(choreItem(chore({ dueDate: day(9) }), dad, { skippable: true, now }).looks.PENDING).toMatchObject({ status: "DUE", label: "To do" });
  });

  it("offers a grown-up Done and Skip, and Missed once it's past", () => {
    expect(choreItem(chore(), dad, { skippable: true, now }).options.PENDING).toEqual([
      { value: "DONE", label: "Done" },
      { value: "SKIPPED", label: "Skip" },
    ]);
    const late = choreItem(chore({ dueDate: day(5) }), dad, { skippable: true, now });
    expect(late.options.PENDING?.[1]).toEqual({ value: "SKIPPED", label: "Missed" });
    expect(late.looks.SKIPPED?.label).toBe("Missed");
  });

  it("gives a kid no skipping, and nothing on a sibling's chore", () => {
    expect(values(choreItem(chore(), ivy, { skippable: true, now }).options.PENDING)).toEqual(["DONE"]);
    expect(choreItem(chore(), max, { skippable: true, now }).options.PENDING).toEqual([]);
    expect(values(choreItem(chore({ assignedTo: null }), max, { skippable: true, now }).options.PENDING)).toEqual(["DONE"]);
  });

  it("lets a kid undo only their own, including one they just did", () => {
    const doneByMax = chore({ status: "DONE", completedBy: { id: "max", firstName: "Max" }, completedAt: now });
    expect(choreItem(doneByMax, ivy, { skippable: true, now }).options.DONE).toEqual([]);
    expect(values(choreItem(chore(), ivy, { skippable: true, now }).options.DONE)).toEqual(["PENDING"]);
  });

  it("tells a stored skip from a stored miss by when it happened", () => {
    const skippedAhead = chore({ status: "SKIPPED", dueDate: day(6), completedAt: new Date(2026, 10, 5, 20) });
    const missed = chore({ status: "SKIPPED", dueDate: day(5), completedAt: new Date(2026, 10, 6, 9) });
    expect(choreItem(skippedAhead, dad, { skippable: true, now }).looks.SKIPPED?.status).toBe("SKIPPED");
    expect(choreItem(missed, dad, { skippable: true, now }).looks.SKIPPED?.status).toBe("MISSED");
  });

  it("reads a skip with no time on it by whether it's overdue now", () => {
    expect(choreItem(chore({ status: "SKIPPED", dueDate: day(5) }), dad, { skippable: true, now }).looks.SKIPPED?.status).toBe("MISSED");
    expect(choreItem(chore({ status: "SKIPPED", dueDate: day(9) }), dad, { skippable: true, now }).looks.SKIPPED?.status).toBe("SKIPPED");
  });

  it("matches the board's own sections for the same today", () => {
    const today = atMidnight(now);
    const rows = [day(4), day(6), day(7), day(8), day(12)].map((d, n) => chore({ id: `c${n}`, dueDate: d }));
    const { overdue, dueToday, upcoming } = bucketInstances(rows, today, addDays(today, 15));
    const status = (r: ChoreLike) => choreItem(r, dad, { skippable: true, now: today }).looks.PENDING?.status;
    expect(overdue.map(status)).toEqual(["OVERDUE", "OVERDUE"]);
    expect(dueToday.map(status)).toEqual(["DUE_TODAY"]);
    expect(upcoming.map(status)).toEqual(["DUE", "DUE"]);
  });

  it("offers no skip where the board doesn't", () => {
    expect(values(choreItem(chore({ dueDate: day(9) }), dad, { skippable: false, now }).options.PENDING)).toEqual(["DONE"]);
  });

  it("hands the browser first names only", () => {
    const item = choreItem(chore({ assignedTo: { id: "ivy", firstName: "Ivy", lastName: "Parker" } as ChoreLike["assignedTo"] }), dad, { skippable: true, now });
    expect(item.who).toEqual({ id: "ivy", firstName: "Ivy" });
  });
});

describe("school permissions", () => {
  it("keeps missing a grown-up's, both ways", () => {
    expect(canSetAssignmentStatus(ivy, { studentId: "ivy", status: "TODO" }, "MISSING")).toBe(false);
    expect(canSetAssignmentStatus(ivy, { studentId: "ivy", status: "MISSING" }, "DONE")).toBe(false);
    expect(canSetAssignmentStatus(ivy, { studentId: "ivy", status: "DONE" }, "TODO")).toBe(true);
    expect(canSetAssignmentStatus(dad, { studentId: "ivy", status: "MISSING" }, "DONE")).toBe(true);
  });
  it("keeps a kid to their own work", () => {
    expect(canSetAssignmentStatus(max, { studentId: "ivy", status: "TODO" }, "DONE")).toBe(false);
    expect(canRemoveAssignment(max, { studentId: "ivy", status: "TODO", score: null })).toBe(false);
  });
  it("lets a kid remove their own, not a grade or a missing", () => {
    expect(canRemoveAssignment(ivy, { studentId: "ivy", status: "TODO", score: null })).toBe(true);
    expect(canRemoveAssignment(ivy, { studentId: "ivy", status: "DONE", score: 9 })).toBe(false);
    expect(canRemoveAssignment(ivy, { studentId: "ivy", status: "MISSING", score: null })).toBe(false);
    expect(canRemoveAssignment(dad, { studentId: "ivy", status: "MISSING", score: 9 })).toBe(true);
  });
});

describe("assignmentItem", () => {
  const work = (over: Partial<AssignmentLike> = {}): AssignmentLike => ({
    id: "a1",
    title: "Spelling list",
    dueDate: day(9),
    status: "TODO",
    score: null,
    maxScore: null,
    student: { id: "ivy", firstName: "Ivy" },
    ...over,
  });

  it("says turned in, graded with the score, or missing, whatever the score", () => {
    expect(assignmentItem(work(), dad, now).looks.DONE?.label).toBe("Turned in");
    expect(assignmentItem(work({ score: 18, maxScore: 20 }), dad, now).looks.DONE?.label).toBe("Graded 18/20");
    expect(assignmentItem(work({ status: "MISSING", score: 3, maxScore: 10 }), dad, now).looks.MISSING?.label).toBe("Missing");
    expect(assignmentItem(work({ score: 18, maxScore: null }), dad, now).looks.DONE?.label).toBe("Graded 18");
  });

  it("is overdue only while still to do, before today", () => {
    expect(assignmentItem(work({ dueDate: day(6) }), dad, now).looks.TODO?.status).toBe("OVERDUE");
    expect(assignmentItem(work({ dueDate: day(7) }), dad, now).looks.TODO?.status).toBe("DUE_TODAY");
    expect(assignmentItem(work({ dueDate: null }), dad, now).looks.TODO?.status).toBe("DUE");
  });

  it("offers what the server allows, per role and status", () => {
    const grownUp = assignmentItem(work(), dad, now);
    expect(values(grownUp.options.TODO)).toEqual(["DONE", "MISSING"]);
    expect(values(grownUp.options.MISSING)).toEqual(["TODO", "DONE"]);
    const kid = assignmentItem(work(), ivy, now);
    expect(values(kid.options.TODO)).toEqual(["DONE"]);
    expect(values(kid.options.DONE)).toEqual(["TODO"]);
    expect(kid.options.MISSING).toEqual([]);
    expect(assignmentItem(work(), max, now).options.TODO).toEqual([]);
  });
});

describe("schoolTaskItem", () => {
  const form = { id: "t1", title: "Field trip form", dueDate: day(6), status: "OPEN" as const, owner: null };
  it("is a grown-up's to tick off and reopen", () => {
    const item = schoolTaskItem(form, dad, now);
    expect(item.looks.OPEN?.status).toBe("OVERDUE");
    expect(values(item.options.OPEN)).toEqual(["DONE"]);
    expect(values(item.options.DONE)).toEqual(["OPEN"]);
    expect(schoolTaskItem(form, ivy, now).options).toEqual({});
    expect(schoolTaskItem({ ...form, dueDate: day(7) }, dad, now).looks.OPEN?.label).toBe("Due today");
    expect(schoolTaskItem({ ...form, dueDate: null }, dad, now).looks.OPEN?.label).toBe("To do");
    expect(schoolTaskItem({ ...form, owner: { id: "mom", firstName: "Mom" } }, dad, now).who).toEqual({ id: "mom", firstName: "Mom" });
  });
});
