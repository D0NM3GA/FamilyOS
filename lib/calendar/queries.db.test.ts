import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { addDays, addMonths, atMidnight } from "@/lib/tasks/schedule";
import { getAgendaWeek } from "./queries";
import { dayKey, weekStartOf } from "./agenda";

/**
 * The agenda's per-viewer scoping against a real database: `npm run test:db` (skipped by
 * plain `npm test`). A throwaway household, deleted afterwards. This week is used, since
 * chores are only generated from today on.
 */
const RUN = import.meta.env.MODE === "db";
const ZONE = "America/New_York";

describe.skipIf(!RUN)("agenda week (database)", () => {
  const start = weekStartOf(new Date());
  const ids = {} as { h: string; mom: string; kid: string; sib: string };
  type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };
  const viewer = (id: string, role: Viewer["role"]): Viewer => ({ id, householdId: ids.h, role });

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e agenda ${Date.now()}`, timezone: ZONE } });
    const [mom, kid, sib] = await Promise.all([
      prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Kid", role: "KID", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Sib", role: "KID", isHouseholdMember: true } }),
    ]);
    Object.assign(ids, { h: h.id, mom: mom.id, kid: kid.id, sib: sib.id });

    const wed = addDays(start, 3);
    for (const [person, title] of [[kid, "Kid's worksheet"], [sib, "Sib's essay"]] as const) {
      await prisma.schoolProfile.create({
        data: { personId: person.id, schoolName: "Lincoln", assignments: { create: { className: "Math", title, dueDate: wed } } },
      });
    }
    await prisma.schoolTask.create({ data: { householdId: h.id, kidPersonId: kid.id, title: "Field trip form", kind: "FEE", amountCents: 1500, dueDate: addDays(start, 2) } });

    const monday = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate() + 1));
    for (const [name, kidPersonId, title] of [["Family", null, "Family night"], ["Sib's", sib.id, "Sib's game"]] as const) {
      await prisma.schoolFeed.create({
        data: {
          householdId: h.id,
          name,
          kidPersonId,
          encryptedValue: new Uint8Array([1]),
          iv: new Uint8Array([1]),
          authTag: new Uint8Array([1]),
          urlHash: `hash-${name}-${Date.now()}`,
          host: "school.example",
          events: { create: { occurrenceKey: "1", uid: "1", title, startsAt: monday, endsAt: new Date(monday.getTime() + 86_400_000), allDay: true } },
        },
      });
    }

    const vehicle = await prisma.vehicle.create({ data: { householdId: h.id, name: "Van" } });
    await prisma.vehicleMaintenanceItem.create({
      data: { vehicleId: vehicle.id, title: "Oil change", intervalMonths: 6, lastDoneAt: addMonths(addDays(start, 3), -6) },
    });
    const sat = addDays(start, 6);
    await prisma.importantDate.create({ data: { personId: kid.id, type: "BIRTHDAY", month: sat.getMonth() + 1, day: sat.getDate(), year: null } });
    await prisma.taskDefinition.create({
      data: { householdId: h.id, title: "Feed the cat", domain: "CHORE", frequencyType: "DAILY", startDate: atMidnight(new Date()), assignees: { connect: { id: kid.id } } },
    });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const titles = (items: { kind: string; title: string }[], kind: string) => items.filter((i) => i.kind === kind).map((i) => i.title).sort();

  test("a grown-up sees the whole family's week", async () => {
    const { items } = await getAgendaWeek(viewer(ids.mom, "ADMIN"), { start, timeZone: ZONE });
    expect(titles(items, "homework")).toEqual(["Math: Kid's worksheet", "Math: Sib's essay"]);
    expect(titles(items, "school")).toEqual(["Field trip form"]);
    expect(titles(items, "schoolEvent")).toEqual(["Family night", "Sib's game"]);
    expect(titles(items, "vehicle")).toEqual(["Oil change due"]);
    expect(titles(items, "date")).toEqual(["Kid's birthday"]);
    expect(items.some((i) => i.kind === "chore" && i.day === dayKey(new Date()) && i.who === "Kid")).toBe(true);
    // Fees show as a to-do, never an amount.
    expect(JSON.stringify(items)).not.toMatch(/\$|15\.00/);
  });

  test("a kid sees only their own school things, and no cars", async () => {
    const { items } = await getAgendaWeek(viewer(ids.kid, "KID"), { start, timeZone: ZONE });
    expect(titles(items, "homework")).toEqual(["Math: Kid's worksheet"]);
    expect(titles(items, "school")).toEqual([]);
    expect(titles(items, "schoolEvent")).toEqual(["Family night"]);
    expect(titles(items, "vehicle")).toEqual([]);
    expect(titles(items, "date")).toEqual(["Kid's birthday"]);
  });

  test("a done chore stays on its day, marked done", async () => {
    const first = await prisma.taskInstance.findFirstOrThrow({ where: { definition: { householdId: ids.h } }, orderBy: { dueDate: "asc" } });
    await prisma.taskInstance.update({ where: { id: first.id }, data: { status: "DONE", completedAt: new Date(), completedById: ids.kid } });
    const { items } = await getAgendaWeek(viewer(ids.mom, "ADMIN"), { start, timeZone: ZONE });
    expect(items.find((i) => i.key === `chore:${first.id}`)?.status).toBe("done");
  });

  test("a week past the two-week plan shows no chores and says so", async () => {
    const later = addDays(start, 21);
    const week = await getAgendaWeek(viewer(ids.mom, "ADMIN"), { start: later, timeZone: ZONE });
    expect(week.items.some((i) => i.kind === "chore")).toBe(false);
    expect(week.tasksPlannedThrough).toEqual(addDays(atMidnight(new Date()), 14));
    // Nothing was generated past the boards' horizon either.
    const beyond = await prisma.taskInstance.count({ where: { definition: { householdId: ids.h }, dueDate: { gt: addDays(atMidnight(new Date()), 15) } } });
    expect(beyond).toBe(0);
  });
});
