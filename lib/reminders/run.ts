import { prisma } from "@/lib/prisma";
import { Prisma, type NotificationKind } from "@/app/generated/prisma/client";
import { appOn } from "@/lib/app-switches";
import { deliverNotifications } from "@/lib/alerts/dispatch";
import type { TeamsCard } from "@/lib/alerts/teams";
import { captureError } from "@/lib/observability";
import { formatTimeOfDay } from "@/lib/format";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { DOSE_AHEAD_MS, DOSE_GRACE_MS, DOSE_LOOKBACK_MS, planDosesDue, planCars, planDates, planDoses, planMedLow, planRecalls, planSchool, planSystem, type NewRecall, type Reminder, type ReminderKind } from "./plan";
import { JOBS } from "@/lib/heartbeat-state";
import { computeDueStatus } from "@/lib/vehicles/due-status";
import { daysUntilMiles, milesPerDay, MILEAGE_WINDOW_DAYS, type Reading } from "@/lib/vehicles/mileage";
import { checkRecalls } from "@/lib/vehicles/nhtsa";
import { inQuietHours } from "./quiet";
import { grownUpsOf } from "./people";
import { kindOff } from "./prefs";
import { sendDigests } from "./digest";

/**
 * Phase 62: the reminders job on the background tick (lib/background.ts). For each household:
 * load what each kind needs (only apps that are on), plan (./plan.ts), drop what each person
 * switched off or is in their quiet hours for (urgent ones go through), claim once per person
 * and key with the bell row, then send outside the app on the person's channels. Each kind runs
 * on its own, so one failing doesn't stop the rest.
 */

/** How the card in Teams (and an email's link) names where a reminder leads. */
export const REMINDER_CARDS: Record<ReminderKind, TeamsCard> = {
  REMINDER_DOSE: { heading: "💊 Meds", linkText: "Open Meds" },
  REMINDER_DOSE_DUE: { heading: "💊 Meds", linkText: "Open Meds" },
  REMINDER_MED_LOW: { heading: "💊 Meds", linkText: "Open Meds" },
  REMINDER_SCHOOL: { heading: "🎒 School", linkText: "Open School" },
  REMINDER_DATE: { heading: "📅 People", linkText: "Open their page" },
  REMINDER_CAR: { heading: "🚐 Cars", linkText: "Open Cars" },
  REMINDER_RECALL: { heading: "🚐 Cars", linkText: "Open Cars" },
  REMINDER_SYSTEM: { heading: "⚙️ The app", linkText: "Open Data & backups" },
};

/** Send history older than this is forgotten. */
export const REMINDER_MEMORY_DAYS = 400;

type Person = { id: string; adult: boolean; admin: boolean; off: string[]; optIn: string[]; quietStart: number | null; quietEnd: number | null };

export async function runReminders(now: Date = new Date()): Promise<string> {
  await prisma.reminderSent.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - REMINDER_MEMORY_DAYS * 86_400_000) } } });
  const households = await prisma.household.findMany({ select: { id: true } });
  let sent = 0;
  for (const h of households) {
    try {
      sent += await remindHousehold(h.id, now);
    } catch (err) {
      captureError(err, "reminders.household_failed");
    }
  }
  return `${sent} sent`;
}

/** One household's reminders (exported for tests, which run one household, not the whole database). */
export async function remindHousehold(householdId: string, now: Date): Promise<number> {
  const people = await loadPeople(householdId);
  const grownUps = people.filter((p) => p.adult);
  const byId = new Map(people.map((p) => [p.id, p]));
  const plans: Reminder[] = [];

  const kinds: [string, () => Promise<Reminder[]>][] = [];
  if (await appOn(householdId, "meds")) {
    kinds.push(["doses", () => doseReminders(householdId, people, now)]);
    kinds.push(["med_low", () => medLowReminders(householdId, grownUps)]);
  }
  if (await appOn(householdId, "school")) kinds.push(["school", () => schoolReminders(householdId, grownUps, now)]);
  if (await appOn(householdId, "cars")) {
    kinds.push(["cars", () => carReminders(householdId, grownUps, now)]);
    kinds.push(["recalls", () => recallReminders(householdId, grownUps, now)]);
  }
  kinds.push(["dates", () => dateReminders(householdId, grownUps, now)]);
  // Phase 67b: a job or the nightly backup that stopped, to the admins.
  kinds.push(["system", async () => planSystem(await prisma.systemHeartbeat.findMany(), JOBS, people.filter((p) => p.admin), now)]);

  for (const [name, plan] of kinds) {
    try {
      plans.push(...(await plan()));
    } catch (err) {
      captureError(err, "reminders.kind_failed", { kind: name });
    }
  }

  // What already went, read once: claiming only what's new keeps a steady tick from opening (and
  // rolling back) a transaction per reminder still in its window. The claim's unique key stays
  // the guard against a race.
  const already = new Set(
    (
      await prisma.reminderSent.findMany({
        where: { personId: { in: people.map((p) => p.id) }, key: { in: [...new Set(plans.map((r) => r.key))] } },
        select: { personId: true, key: true },
      })
    ).map((s) => `${s.personId}|${s.key}`),
  );

  // Phase 62c: the morning summaries, from the same plans (its own errors stay its own).
  try {
    await sendDigests(householdId, grownUps.map((g) => g.id), plans, now);
  } catch (err) {
    captureError(err, "reminders.digest_failed");
  }

  let sent = 0;
  const outbound = new Map<ReminderKind, string[]>();
  for (const r of plans) {
    for (const personId of r.recipients) {
      const person = byId.get(personId);
      if (!person || already.has(`${personId}|${r.key}`)) continue;
      // Phase 68a: an opt-in kind only to who switched it on; any other unless switched off.
      if (person.adult && kindOff(r.kind, person)) continue;
      // Quiet hours defer: not claimed now, so the next tick after they end sends it.
      if (person.adult && !r.urgent && inQuietHours(person, now)) continue;
      const id = await claim(householdId, personId, r);
      if (!id) continue;
      sent++;
      // Kids get the bell only, as for store orders.
      if (person.adult) outbound.set(r.kind, [...(outbound.get(r.kind) ?? []), id]);
    }
  }
  for (const [kind, ids] of outbound) {
    await deliverNotifications({ id: { in: ids } }, { channels: "reminders", card: REMINDER_CARDS[kind] });
  }
  return sent;
}

/** Household members, with whether they're a grown-up and their reminder settings. */
async function loadPeople(householdId: string): Promise<Person[]> {
  const rows = await prisma.person.findMany({
    where: { householdId, isHouseholdMember: true },
    select: { id: true, role: true, entraAccessEndedAt: true, reminderPrefs: { select: { off: true, optIn: true, quietStart: true, quietEnd: true } } },
  });
  const adults = new Set(grownUpsOf(rows).map((g) => g.id));
  return rows.map((p) => ({
    id: p.id,
    adult: adults.has(p.id),
    admin: adults.has(p.id) && p.role === "ADMIN",
    off: p.reminderPrefs?.off ?? [],
    optIn: p.reminderPrefs?.optIn ?? [],
    quietStart: p.reminderPrefs?.quietStart ?? null,
    quietEnd: p.reminderPrefs?.quietEnd ?? null,
  }));
}

/** Once per person and key: the send record and the bell row in one transaction. Null if already sent. */
async function claim(householdId: string, personId: string, r: Reminder): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.reminderSent.create({ data: { personId, key: r.key } });
      const n = await tx.notification.create({
        data: { householdId, recipientId: personId, kind: r.kind as NotificationKind, title: r.title, href: r.href },
        select: { id: true },
      });
      return n.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

async function doseReminders(householdId: string, people: Person[], now: Date): Promise<Reminder[]> {
  // Doses are otherwise made only when a page opens: make today's (and tomorrow's) first, so a
  // day nobody looked still reminds.
  await ensureInstancesGenerated(householdId, addDays(atMidnight(now), 2), "MED");
  const grownUps = people.filter((p) => p.adult);
  const adults = new Set(grownUps.map((g) => g.id));
  const rows = await prisma.taskInstance.findMany({
    where: {
      status: "PENDING",
      // Phase 68a: a little ahead too, for "a dose is due".
      dueDate: { gte: new Date(now.getTime() - DOSE_LOOKBACK_MS), lte: new Date(now.getTime() + DOSE_AHEAD_MS) },
      // Phase 65a: as-needed medicines have no doses to miss.
      definition: { householdId, domain: "MED", active: true, frequencyType: { not: "AS_NEEDED" } },
    },
    select: {
      definitionId: true,
      dueDate: true,
      status: true,
      assignedTo: { select: { id: true, firstName: true } },
      definition: { select: { title: true, timesOfDay: true, active: true } },
    },
  });
  const doses = rows.map((r) => ({
    definitionId: r.definitionId,
    dueDate: r.dueDate,
    title: r.definition.title,
    timeLabel: formatTimeOfDay(r.dueDate),
    timed: r.definition.timesOfDay.length > 0,
    active: r.definition.active,
    status: r.status,
    assignedTo: r.assignedTo ? { ...r.assignedTo, adult: adults.has(r.assignedTo.id) } : null,
  }));
  const optedIn = grownUps.filter((g) => g.optIn.includes("REMINDER_DOSE_DUE"));
  const plans = [...planDoses(doses, grownUps, now), ...planDosesDue(doses, optedIn, now)];
  await endFinishedCourses(householdId, now);
  return plans;
}

/**
 * Phase 68a: a course of medicine past its last day switches itself off (kept, not deleted).
 * Nothing after the last day was planned, so there's nothing to clear. Only once the last day's
 * latest dose is past its missed-dose window, so that reminder still comes (it needs the medicine
 * active); after the dose planners, in the same tick.
 */
export async function endFinishedCourses(householdId: string, now: Date): Promise<number> {
  const cutoff = addDays(atMidnight(new Date(now.getTime() - DOSE_GRACE_MS)), -1);
  const { count } = await prisma.taskDefinition.updateMany({
    where: { householdId, domain: "MED", active: true, endDate: { not: null, lte: cutoff } },
    data: { active: false },
  });
  return count;
}

async function medLowReminders(householdId: string, grownUps: { id: string }[]): Promise<Reminder[]> {
  const meds = await prisma.medication.findMany({
    where: { taskDefinition: { householdId, domain: "MED" } },
    select: {
      id: true,
      quantityOnHand: true,
      doseAmount: true,
      refillThresholdQuantity: true,
      taskDefinition: { select: { title: true, active: true, frequencyType: true, interval: true, daysOfWeek: true, timesOfDay: true } },
    },
  });
  const { reminders, notLow } = planMedLow(
    meds.map((m) => ({
      medicationId: m.id,
      title: m.taskDefinition.title,
      active: m.taskDefinition.active,
      quantityOnHand: m.quantityOnHand,
      doseAmount: m.doseAmount,
      refillThresholdQuantity: m.refillThresholdQuantity,
      frequencyType: m.taskDefinition.frequencyType,
      interval: m.taskDefinition.interval ?? 1,
      daysOfWeek: m.taskDefinition.daysOfWeek,
      timesOfDay: m.taskDefinition.timesOfDay,
    })),
    grownUps,
  );
  // Restocked (or stopped): forget it, so the next time it runs low reminds again.
  if (notLow.length) await prisma.reminderSent.deleteMany({ where: { key: { in: notLow.map((id) => `med:${id}`) }, person: { householdId } } });
  return reminders;
}

async function schoolReminders(householdId: string, grownUps: { id: string }[], now: Date): Promise<Reminder[]> {
  const today = atMidnight(now);
  const tasks = await prisma.schoolTask.findMany({
    where: { householdId, status: "OPEN", dueDate: { gte: today, lt: addDays(today, 2) } },
    select: { id: true, title: true, dueDate: true, status: true, ownerPersonId: true, kid: { select: { firstName: true } } },
  });
  const adults = new Set(grownUps.map((g) => g.id));
  return planSchool(
    tasks.map((t) => ({ ...t, owner: t.ownerPersonId ? { id: t.ownerPersonId, adult: adults.has(t.ownerPersonId) } : null })),
    grownUps,
    now,
  );
}

async function dateReminders(householdId: string, grownUps: { id: string }[], now: Date): Promise<Reminder[]> {
  const dates = await prisma.importantDate.findMany({
    where: { person: { householdId }, type: { in: ["BIRTHDAY", "ANNIVERSARY"] } },
    select: { id: true, type: true, month: true, day: true, year: true, person: { select: { id: true, firstName: true } } },
  });
  return planDates(dates, grownUps, now);
}

/** The odometer readings a car has from the last 90 days: fill-ups, services and its own current mileage. */
function readingsOf(v: {
  currentMileage: number;
  mileageUpdatedAt: Date | null;
  fuelLogs: { filledAt: Date; mileage: number }[];
  maintenanceItems: { serviceLogs: { doneAt: Date; mileage: number }[] }[];
}): Reading[] {
  return [
    ...v.fuelLogs.map((f) => ({ at: f.filledAt, mileage: f.mileage })),
    ...v.maintenanceItems.flatMap((i) => i.serviceLogs.map((s) => ({ at: s.doneAt, mileage: s.mileage }))),
    ...(v.mileageUpdatedAt ? [{ at: v.mileageUpdatedAt, mileage: v.currentMileage }] : []),
  ];
}

async function carReminders(householdId: string, grownUps: { id: string }[], now: Date): Promise<Reminder[]> {
  const since = new Date(now.getTime() - MILEAGE_WINDOW_DAYS * 86_400_000);
  const vehicles = await prisma.vehicle.findMany({
    where: { householdId, active: true },
    select: {
      id: true,
      name: true,
      currentMileage: true,
      mileageUpdatedAt: true,
      maintenanceItems: {
        // Phase 65b: the Repairs item holds one-off repairs; it's never due.
        where: { active: true, kind: { not: "REPAIRS" } },
        select: {
          id: true,
          title: true,
          kind: true,
          nextDueAt: true,
          intervalMiles: true,
          intervalMonths: true,
          lastDoneMileage: true,
          lastDoneAt: true,
          serviceLogs: { where: { doneAt: { gte: since } }, select: { doneAt: true, mileage: true } },
        },
      },
      fuelLogs: { where: { filledAt: { gte: since } }, select: { filledAt: true, mileage: true } },
    },
  });
  return planCars(
    vehicles.flatMap((v) => {
      const perDay = milesPerDay(readingsOf(v), now);
      return v.maintenanceItems.map((item) => {
        const due = computeDueStatus(item, v.currentMileage, now);
        return {
          itemId: item.id,
          title: item.title,
          vehicle: { id: v.id, name: v.name },
          status: due.status,
          daysRemaining: due.daysRemaining,
          milesRemaining: due.milesRemaining,
          daysByMiles: due.milesRemaining != null ? daysUntilMiles(due.milesRemaining, perDay) : null,
          paperwork: item.kind === "PAPERWORK",
          // The last service and the interval: a new service, or a changed interval, starts a new cycle.
          // Paperwork's cycle is its due day (renewing moves it).
          cycle: item.kind === "PAPERWORK" && item.nextDueAt ? `paper:${item.nextDueAt.toISOString()}` : `${item.lastDoneAt ? item.lastDoneAt.toISOString() : String(item.lastDoneMileage ?? "never")}:${item.intervalMiles ?? ""}:${item.intervalMonths ?? ""}`,
        };
      });
    }),
    grownUps,
  );
}

/** NHTSA at most once a day per car (its fetch cache only works inside a request). */
export const RECALL_CHECK_EVERY_MS = 24 * 60 * 60_000;

/** A recall found this many days ago or less still reminds whoever hasn't had it (quiet hours, a restart). */
export const RECALL_REMIND_DAYS = 30;

/**
 * Recalls newly listed for a car. Two steps: check NHTSA for cars due a check and record what's
 * new (a car's first good check records everything as the baseline, never reminded, so a model
 * fixed later doesn't flood); then plan from what's recorded, not from this tick's check, so a
 * grown-up in quiet hours gets it after, like any other reminder. One already marked handled never
 * reminds.
 */
async function recallReminders(householdId: string, grownUps: { id: string }[], now: Date): Promise<Reminder[]> {
  const due = await prisma.vehicle.findMany({
    where: {
      householdId,
      active: true,
      year: { not: null },
      make: { not: null },
      model: { not: null },
      OR: [{ recallsCheckedAt: null }, { recallsCheckedAt: { lt: new Date(now.getTime() - RECALL_CHECK_EVERY_MS) } }],
    },
    select: { id: true, year: true, make: true, model: true, recallsBaselinedAt: true },
  });
  for (const v of due) {
    const check = await checkRecalls(v);
    // Unavailable: try again on a later tick.
    if (check.status === "unavailable") continue;
    // Anything else counts as checked today; only a good answer can set or add to the baseline.
    await prisma.vehicle.update({ where: { id: v.id }, data: { recallsCheckedAt: now } });
    if (check.status !== "ok") continue;
    const baseline = v.recallsBaselinedAt == null;
    if (check.recalls.length) {
      await prisma.vehicleRecallSeen.createMany({
        data: check.recalls.map((r) => ({ vehicleId: v.id, campaignNumber: r.campaignNumber, component: r.component, parkIt: r.parkIt, baseline })),
        skipDuplicates: true,
      });
    }
    if (baseline) await prisma.vehicle.update({ where: { id: v.id }, data: { recallsBaselinedAt: now } });
  }

  const seen = await prisma.vehicleRecallSeen.findMany({
    where: { baseline: false, firstSeenAt: { gte: new Date(now.getTime() - RECALL_REMIND_DAYS * 86_400_000) }, vehicle: { householdId, active: true } },
    select: { campaignNumber: true, component: true, parkIt: true, vehicle: { select: { id: true, name: true, recallAcks: { select: { campaignNumber: true } } } } },
  });
  const found: NewRecall[] = seen
    .filter((r) => !r.vehicle.recallAcks.some((a) => a.campaignNumber === r.campaignNumber))
    .map((r) => ({ vehicle: { id: r.vehicle.id, name: r.vehicle.name }, campaignNumber: r.campaignNumber, component: r.component, parkIt: r.parkIt }));
  return planRecalls(found, grownUps);
}
