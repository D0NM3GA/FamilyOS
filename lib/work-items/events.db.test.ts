import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { addDays, atMidnight } from "@/lib/tasks/schedule";

/**
 * Phase 59.1c against a real database (`npm run test:db`): Chores' and School's actions write
 * history in the same transaction as the change, and take it away with the item.
 */
const RUN = import.meta.env.MODE === "db";

const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile };
});

describe.skipIf(!RUN)("work item history (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", mom: "", kid: "", max: "", def: "", profile: "" };
  const t = Date.now();
  const today = atMidnight(new Date());

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-history-${t}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADULT", isHouseholdMember: true } });
    const kid = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    const max = await prisma.person.create({ data: { householdId: h.id, firstName: "Max", role: "KID", isHouseholdMember: true } });
    const def = await prisma.taskDefinition.create({
      data: { householdId: h.id, title: "Feed the fish", frequencyType: "WEEKLY", interval: 1, startDate: today, points: 1, assignmentStrategy: "FIXED" },
    });
    const profile = await prisma.schoolProfile.create({ data: { personId: kid.id, schoolName: "Example Elementary" } });
    Object.assign(ids, { h: h.id, mom: mom.id, kid: kid.id, max: max.id, def: def.id, profile: profile.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const as = async (personId: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: personId }, omit: { photo: true } });
  };
  const history = (itemId: string) =>
    prisma.workItemEvent.findMany({ where: { itemId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { action: true, fromValue: true, toValue: true, field: true, actorId: true } });
  const chore = (dueDate: Date, assignedToId: string | null = ids.kid) =>
    prisma.taskInstance.create({ data: { definitionId: ids.def, dueDate, assignedToId } });

  test("a chore's done, undo, skip, give-to and missed each leave one event", async () => {
    const { completeInstance, uncompleteInstance, skipInstance, unskipInstance, reassignInstance, markOlderMissed } = await import("@/app/(app)/chores/actions");
    const i = await chore(today);
    await as(ids.kid);
    await completeInstance(i.id);
    await completeInstance(i.id); // already done: nothing new
    await uncompleteInstance(i.id);
    await as(ids.mom);
    await reassignInstance(i.id, ids.max);
    await skipInstance(i.id);
    await unskipInstance(i.id);
    expect(await history(i.id)).toEqual([
      { action: "STATUS", fromValue: "PENDING", toValue: "DONE", field: null, actorId: ids.kid },
      { action: "STATUS", fromValue: "DONE", toValue: "PENDING", field: null, actorId: ids.kid },
      { action: "ASSIGN", fromValue: "Ivy", toValue: "Max", field: null, actorId: ids.mom },
      { action: "STATUS", fromValue: "PENDING", toValue: "SKIPPED", field: null, actorId: ids.mom },
      { action: "STATUS", fromValue: "SKIPPED", toValue: "PENDING", field: null, actorId: ids.mom },
    ]);

    const old = await chore(addDays(today, -30));
    await markOlderMissed(null);
    expect(await history(old.id)).toEqual([{ action: "STATUS", fromValue: "PENDING", toValue: "SKIPPED", field: null, actorId: ids.mom }]);
  });

  test("turning a chore off takes its waiting days' history with them", async () => {
    const { setDefinitionActive, skipInstance, unskipInstance } = await import("@/app/(app)/chores/actions");
    const later = await chore(addDays(today, 7));
    await as(ids.mom);
    await skipInstance(later.id);
    await unskipInstance(later.id);
    expect(await history(later.id)).toHaveLength(2);
    await setDefinitionActive(ids.def, false);
    expect(await prisma.taskInstance.count({ where: { id: later.id } })).toBe(0);
    expect(await history(later.id)).toEqual([]);
    await setDefinitionActive(ids.def, true);
  });

  test("homework's status, edits and grade are recorded, and removing it removes them", async () => {
    const { setAssignmentStatus, updateAssignment, deleteAssignment } = await import("@/app/(app)/school/actions");
    const a = await prisma.schoolAssignment.create({ data: { profileId: ids.profile, className: "Math", title: "Ch 3", notes: "secret words" } });
    await as(ids.kid);
    await setAssignmentStatus(a.id, "DONE");
    await setAssignmentStatus(a.id, "DONE"); // no change, no event
    await as(ids.mom);
    const f = new FormData();
    for (const [k, v] of Object.entries({ className: "Math", title: "Chapter 3", kind: "TEST", status: "DONE", score: "18", maxScore: "20", notes: "other words" })) f.set(k, v);
    expect(await updateAssignment(a.id, {}, f)).toEqual({ notice: "Saved." });
    const events = await history(a.id);
    expect(events).toEqual([
      { action: "STATUS", fromValue: "TODO", toValue: "DONE", field: null, actorId: ids.kid },
      { action: "EDIT", field: "title", fromValue: "Ch 3", toValue: "Chapter 3", actorId: ids.mom },
      { action: "EDIT", field: "kind", fromValue: "HOMEWORK", toValue: "TEST", actorId: ids.mom },
      { action: "EDIT", field: "notes", fromValue: null, toValue: null, actorId: ids.mom },
      { action: "GRADE", field: null, fromValue: null, toValue: "18/20", actorId: ids.mom },
    ]);
    expect(JSON.stringify(events)).not.toContain("words");
    await deleteAssignment(a.id);
    expect(await history(a.id)).toEqual([]);
  });

  test("done work ticked off again changes nothing, and an unchanged edit records nothing", async () => {
    const { setAssignmentStatus, updateAssignment } = await import("@/app/(app)/school/actions");
    const a = await prisma.schoolAssignment.create({ data: { profileId: ids.profile, className: "Science", title: "Leaf log" } });
    await as(ids.kid);
    await setAssignmentStatus(a.id, "DONE");
    const { doneAt } = await prisma.schoolAssignment.findUniqueOrThrow({ where: { id: a.id } });
    await setAssignmentStatus(a.id, "DONE");
    expect((await prisma.schoolAssignment.findUniqueOrThrow({ where: { id: a.id } })).doneAt).toEqual(doneAt);
    expect(await history(a.id)).toHaveLength(1);

    await as(ids.mom);
    const f = new FormData();
    for (const [k, v] of Object.entries({ className: "Science", title: "Leaf log", kind: "HOMEWORK", status: "DONE" })) f.set(k, v);
    expect(await updateAssignment(a.id, {}, f)).toEqual({ notice: "Saved." });
    expect(await history(a.id)).toHaveLength(1);
  });

  test("an event written in a transaction that fails is never kept", async () => {
    const { recordEvent } = await import("./events");
    const itemId = `rollback-${t}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await recordEvent(tx, { householdId: ids.h, itemType: "CHORE", itemId, actorId: ids.mom, action: "STATUS", fromValue: "PENDING", toValue: "DONE" });
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect(await history(itemId)).toEqual([]);
  });

  test("a kid grabbing an Anyone chore is the one the history names", async () => {
    const { completeInstance } = await import("@/app/(app)/chores/actions");
    const i = await chore(addDays(today, 1), null);
    await as(ids.max);
    await completeInstance(i.id);
    expect(await history(i.id)).toEqual([{ action: "STATUS", fromValue: "PENDING", toValue: "DONE", field: null, actorId: ids.max }]);
  });

  test("a form's done and reopen are recorded once each, and removing it removes them", async () => {
    const { setTaskDone, deleteTask } = await import("@/app/(app)/school/actions");
    const task = await prisma.schoolTask.create({ data: { householdId: ids.h, title: "Field trip slip" } });
    await as(ids.mom);
    await setTaskDone(task.id, true);
    await setTaskDone(task.id, true);
    await setTaskDone(task.id, false);
    expect((await history(task.id)).map((e) => `${e.fromValue}>${e.toValue}`)).toEqual(["OPEN>DONE", "DONE>OPEN"]);
    await deleteTask(task.id);
    expect(await history(task.id)).toEqual([]);
  });

  test("Phase 59.2a: a kid's own change shows for a grown-up, who can approve it or put it back", async () => {
    const { setAssignmentDetails, approveKidChange, putBackKidChange } = await import("@/app/(app)/school/actions");
    const a = await prisma.schoolAssignment.create({ data: { profileId: ids.profile, className: "Math", title: "Ch 4", dueDate: addDays(today, 2) } });
    const details = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ className: "Math", title: "Ch 4", kind: "HOMEWORK", dueDate: "", ...o })) f.set(k, v);
      return f;
    };
    const due = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const row = () => prisma.schoolAssignment.findUniqueOrThrow({ where: { id: a.id } });

    await as(ids.max); // not his
    expect(await setAssignmentDetails(a.id, {}, details({ title: "Mine now" }))).toEqual({ error: "Ask a grown-up to change that one." });

    await as(ids.kid);
    expect(await setAssignmentDetails(a.id, {}, details({ dueDate: due(addDays(today, 9)) }))).toEqual({ notice: "Saved." });
    expect(await setAssignmentDetails(a.id, {}, details({ dueDate: due(addDays(today, 12)), title: "Chapter 4" }))).toEqual({ notice: "Saved." });
    expect((await row()).kidChangedAt).not.toBeNull();

    await as(ids.mom);
    const seen = (await row()).kidChangedAt!.toISOString();
    await putBackKidChange(a.id, seen);
    const back = await row();
    expect([back.title, due(back.dueDate!), back.kidChangedAt]).toEqual(["Ch 4", due(addDays(today, 2)), null]);

    await as(ids.kid);
    await setAssignmentDetails(a.id, {}, details({ kind: "TEST", dueDate: due(addDays(today, 2)) }));
    const firstLook = (await row()).kidChangedAt!.toISOString();
    // The kid changes it again before the grown-up taps Approve: the stale approve is refused.
    await new Promise((r) => setTimeout(r, 5));
    await setAssignmentDetails(a.id, {}, details({ kind: "QUIZ", dueDate: due(addDays(today, 2)) }));
    await as(ids.mom);
    await expect(approveKidChange(a.id, firstLook)).rejects.toThrow("refresh");
    await expect(putBackKidChange(a.id, firstLook)).rejects.toThrow("refresh");
    expect((await row()).kidChangedAt).not.toBeNull();
    await approveKidChange(a.id, (await row()).kidChangedAt!.toISOString());
    const kept = await row();
    expect([kept.kind, kept.kidChangedAt]).toEqual(["QUIZ", null]);
    expect((await history(a.id)).map((e) => e.action)).toEqual(["EDIT", "EDIT", "EDIT", "PUT_BACK", "PUT_BACK", "EDIT", "EDIT", "APPROVE"]);

    // Graded work is a grown-up's to change.
    const { gradeAssignment } = await import("@/app/(app)/school/actions");
    const g = new FormData();
    g.set("score", "9");
    g.set("maxScore", "10");
    expect(await gradeAssignment(a.id, {}, g)).toEqual({ notice: "Saved." });
    // Graded To do work has been turned in.
    expect((await row()).status).toBe("DONE");
    await as(ids.kid);
    expect(await setAssignmentDetails(a.id, {}, details({ title: "Easy" }))).toEqual({ error: "Ask a grown-up to change that one." });
    await expect(gradeAssignment(a.id, {}, g)).rejects.toThrow("Only adults");
  });

  test("Phase 59.2a: a grown-up's own save checks a kid's change, and Put back with nothing to undo still clears it", async () => {
    const { setAssignmentDetails, putBackKidChange } = await import("@/app/(app)/school/actions");
    const details = (title: string) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ className: "Art", title, kind: "PROJECT", dueDate: "" })) f.set(k, v);
      return f;
    };
    const a = await prisma.schoolAssignment.create({ data: { profileId: ids.profile, className: "Art", title: "Collage", kind: "PROJECT" } });
    const row = () => prisma.schoolAssignment.findUniqueOrThrow({ where: { id: a.id } });
    await as(ids.kid);
    await setAssignmentDetails(a.id, {}, details("Big collage"));
    await as(ids.mom);
    expect(await setAssignmentDetails(a.id, {}, details("Big collage"))).toEqual({ notice: "Saved." });
    expect((await row()).kidChangedAt).toBeNull();

    // The kid changes it and changes it back: nothing to restore, but it's still checked.
    await as(ids.kid);
    await setAssignmentDetails(a.id, {}, details("Huge collage"));
    await setAssignmentDetails(a.id, {}, details("Big collage"));
    await as(ids.mom);
    await putBackKidChange(a.id, (await row()).kidChangedAt!.toISOString());
    expect([(await row()).title, (await row()).kidChangedAt]).toEqual(["Big collage", null]);
    expect((await history(a.id)).map((e) => e.action).slice(-1)).toEqual(["PUT_BACK"]);
  });

  test("Phase 59.2a: a form is edited in place, and I've got it hands it over in one tap", async () => {
    const { updateTask, claimTask } = await import("@/app/(app)/school/actions");
    const task = await prisma.schoolTask.create({ data: { householdId: ids.h, title: "Book fair money" } });
    await as(ids.mom);
    const f = new FormData();
    for (const [k, v] of Object.entries({ title: "Book fair money", kind: "FEE", amount: "10", dueDate: "", kidPersonId: ids.kid, ownerPersonId: "", notes: "" })) f.set(k, v);
    expect(await updateTask(task.id, {}, f)).toEqual({ notice: "Saved." });
    await claimTask(task.id);
    await claimTask(task.id); // already hers
    const saved = await prisma.schoolTask.findUniqueOrThrow({ where: { id: task.id } });
    expect([saved.kind, saved.amountCents, saved.kidPersonId, saved.ownerPersonId]).toEqual(["FEE", 1000, ids.kid, ids.mom]);
    expect((await history(task.id)).map((e) => `${e.action}:${e.field ?? ""}:${e.toValue ?? ""}`)).toEqual(["EDIT:kind:FEE", "EDIT:kid:Ivy", "EDIT:amount:$10.00", "ASSIGN::Mom"]);

    // A kid can't take one on, and another household's is never found.
    await as(ids.kid);
    await expect(claimTask(task.id)).rejects.toThrow("Only adults");
    const elsewhere = await prisma.household.create({ data: { name: `e2e-history-other-${t}` } });
    try {
      const theirs = await prisma.schoolTask.create({ data: { householdId: elsewhere.id, title: "Not ours" } });
      await as(ids.mom);
      expect(await updateTask(theirs.id, {}, f)).toEqual({ error: "That one wasn't found." });
      await claimTask(theirs.id);
      expect((await prisma.schoolTask.findUniqueOrThrow({ where: { id: theirs.id } })).ownerPersonId).toBeNull();
    } finally {
      await prisma.household.delete({ where: { id: elsewhere.id } });
    }
  });
});
