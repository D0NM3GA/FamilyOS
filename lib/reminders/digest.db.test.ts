import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { addDays, atMidnight } from "@/lib/tasks/schedule";

/** Phase 62c against a real database (`npm run test:db`): a summary goes once a day, from 7:00, by email when chosen. */
const RUN = import.meta.env.MODE === "db";
const mail: { to: string; title: string; lines: string[] }[] = [];
vi.mock("@/lib/alerts/email", async (orig) => {
  const real = await orig<typeof import("@/lib/alerts/email")>();
  return {
    ...real,
    alertMailbox: async () => "alerts@example.com",
    sendEmail: async (_from: string, to: string, title: string, _link: string, _app: string, _deps: object, _linkText?: string, lines: string[] = []) => {
      mail.push({ to, title, lines });
    },
  };
});

describe.skipIf(!RUN)("morning summary (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "" };
  const day = (h: number) => {
    const d = atMidnight(new Date());
    d.setHours(h, 5);
    return d;
  };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-digest-${t}` } });
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true, email: "dad@example.com" } });
    await prisma.reminderPrefs.create({ data: { personId: dad.id, digestEmail: true } });
    await prisma.schoolTask.create({ data: { householdId: h.id, title: "field trip form", kind: "FORM", dueDate: addDays(atMidnight(new Date()), 1) } });
    Object.assign(ids, { h: h.id, dad: dad.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  test("not before 7, then once with today's lines", async () => {
    const { remindHousehold } = await import("./run");
    await remindHousehold(ids.h, day(6));
    expect(mail).toHaveLength(0);
    await remindHousehold(ids.h, day(7));
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: "dad@example.com", title: "Good morning, Dad: today at a glance", lines: ["field trip form is due tomorrow"] });
    await remindHousehold(ids.h, day(9));
    expect(mail).toHaveLength(1);
  });
});
