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
    prisma.workItemEvent.findMany({ where: { itemId }, orderBy: { createdAt: "asc" }, select: { action: true, fromValue: true, toValue: true, field: true, actorId: true } });
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
});
