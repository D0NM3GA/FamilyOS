import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { isMedLow } from "./supply";

/**
 * Phase 62: what to remind whom about, worked out from rows. Pure (no Prisma, no clock but `now`),
 * so each rule is unit-tested; lib/reminders/run.ts loads the rows and sends. The server keeps
 * the household's time (lib/household-zone.ts), so local Date getters are the family's.
 *
 * A reminder names the item and when, nothing more, and links to where it's handled. Its key
 * names the thing and its occurrence: the same key never goes to the same person twice
 * (ReminderSent), and the next occurrence reminds again.
 */

export type ReminderKind = "REMINDER_DOSE" | "REMINDER_MED_LOW" | "REMINDER_SCHOOL" | "REMINDER_DATE" | "REMINDER_CAR" | "REMINDER_RECALL";

export type Reminder = {
  kind: ReminderKind;
  key: string;
  /** Person ids. Kids among them get the bell only (run.ts). */
  recipients: string[];
  title: string;
  href: string;
  /** Through quiet hours (a missed dose). */
  urgent: boolean;
};

export type GrownUp = { id: string };

// Phase 66a: isMedLow and LOW_DAYS live in ./supply, so taking a dose (Meds) asks for a refill on
// the same rule this reminder uses.
export { isMedLow, LOW_DAYS } from "./supply";

/** A dose this long past its time, and not marked, is missed. */
export const DOSE_GRACE_MS = 90 * 60_000;
/** Doses missed longer ago than this don't remind (a day's worth, at most). */
export const DOSE_LOOKBACK_MS = 24 * 60 * 60_000;
/** Birthdays and anniversaries this many days ahead. */
export const DATE_AHEAD_DAYS = 7;

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const unique = (ids: string[]) => [...new Set(ids)];

// ---- missed doses --------------------------------------------------------------------------

export type DoseRow = {
  definitionId: string;
  dueDate: Date;
  title: string;
  /** The dose's time ("8:00 AM"), formatted on the server. */
  timeLabel: string;
  /** The definition has times of day: only timed doses have a time to have passed. */
  timed: boolean;
  active: boolean;
  status: string;
  assignedTo: { id: string; firstName: string } | null;
};

/** A PENDING timed dose of an active medication, 90 minutes to a day past its time. */
export function planDoses(rows: DoseRow[], grownUps: GrownUp[], now: Date): Reminder[] {
  return rows
    .filter((r) => r.status === "PENDING" && r.timed && r.active)
    .filter((r) => {
      const late = now.getTime() - r.dueDate.getTime();
      return late >= DOSE_GRACE_MS && late <= DOSE_LOOKBACK_MS;
    })
    .map((r) => ({
      kind: "REMINDER_DOSE",
      // The definition, the day and the clock time, not the instance's id (an edit or a restore
      // makes this morning's instance again) nor the stored instant (a zone move shifts it).
      key: `dose:${r.definitionId}:${dayKey(r.dueDate)}:${String(r.dueDate.getHours()).padStart(2, "0")}${String(r.dueDate.getMinutes()).padStart(2, "0")}`,
      recipients: unique([...(r.assignedTo ? [r.assignedTo.id] : []), ...grownUps.map((g) => g.id)]),
      title: r.assignedTo ? `${r.assignedTo.firstName}'s ${r.timeLabel} dose of ${r.title} wasn't marked` : `The ${r.timeLabel} dose of ${r.title} wasn't marked`,
      href: "/meds",
      urgent: true,
    }));
}

// ---- running low ---------------------------------------------------------------------------

export type MedRow = {
  medicationId: string;
  title: string;
  active: boolean;
  quantityOnHand: number | null;
  doseAmount: number | null;
  refillThresholdQuantity: number | null;
  frequencyType: string;
  interval: number;
  daysOfWeek: number[];
  timesOfDay: string[];
};

export function planMedLow(meds: MedRow[], grownUps: GrownUp[]): { reminders: Reminder[]; notLow: string[] } {
  const reminders: Reminder[] = [];
  const notLow: string[] = [];
  for (const m of meds) {
    const { low, days, doses } = isMedLow(m);
    // A stopped medicine isn't reminded about, and is forgotten, so starting it again while low reminds.
    if (!m.active || !low) {
      notLow.push(m.medicationId);
      continue;
    }
    reminders.push({
      kind: "REMINDER_MED_LOW",
      // One per med while it stays low; run.ts clears it once it isn't, so the next time reminds.
      key: `med:${m.medicationId}`,
      recipients: grownUps.map((g) => g.id),
      title:
        doses != null
          ? `${m.title} is running low (about ${doses} ${doses === 1 ? "dose" : "doses"} left)`
          : days != null
            ? `${m.title} is running low (about ${Math.max(0, Math.floor(days))} ${Math.floor(days) === 1 ? "day" : "days"} left)` : `${m.title} is running low`,
      href: "/meds/manage",
      urgent: false,
    });
  }
  return { reminders, notLow };
}

// ---- school --------------------------------------------------------------------------------

export type SchoolTaskRow = {
  id: string;
  title: string;
  dueDate: Date | null;
  status: string;
  owner: { id: string; adult: boolean } | null;
  kid: { firstName: string } | null;
};

/** An open form, fee or to-do due today or tomorrow: to its owner if a grown-up, else every grown-up. */
export function planSchool(tasks: SchoolTaskRow[], grownUps: GrownUp[], now: Date): Reminder[] {
  const today = atMidnight(now);
  const tomorrow = addDays(today, 1);
  return tasks
    .filter((t) => t.status === "OPEN" && t.dueDate != null && t.dueDate >= today && t.dueDate < addDays(today, 2))
    .map((t) => {
      const when = t.dueDate! < tomorrow ? "today" : "tomorrow";
      const what = t.kid ? `${t.kid.firstName}'s ${t.title}` : t.title;
      return {
        kind: "REMINDER_SCHOOL" as const,
        key: `school:${t.id}:${dayKey(t.dueDate!)}`,
        recipients: t.owner?.adult ? [t.owner.id] : grownUps.map((g) => g.id),
        title: `${what} is due ${when}`,
        href: "/school",
        urgent: false,
      };
    });
}

// ---- birthdays and anniversaries -----------------------------------------------------------

export type DateRow = {
  id: string;
  type: string;
  month: number;
  day: number;
  year: number | null;
  person: { id: string; firstName: string };
};

/** A month's day, kept inside the month: Feb 29 is Feb 28 in a year without one (as the calendar shows it). */
const onDay = (year: number, month: number, day: number) => new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate()));

/** The next time a yearly date comes round, from today (local midnight). */
export function nextOn(d: { month: number; day: number }, now: Date): Date {
  const today = atMidnight(now);
  const at = onDay(today.getFullYear(), d.month, d.day);
  return at < today ? onDay(today.getFullYear() + 1, d.month, d.day) : at;
}

/** A birthday or anniversary within a week: to every grown-up but the person it's about. */
export function planDates(dates: DateRow[], grownUps: GrownUp[], now: Date): Reminder[] {
  const today = atMidnight(now);
  const out: Reminder[] = [];
  for (const d of dates) {
    if (d.type !== "BIRTHDAY" && d.type !== "ANNIVERSARY") continue;
    const at = nextOn(d, now);
    // A date entered for a year still to come (a wedding planned) waits for that year, as Home does.
    if (d.year != null && at.getFullYear() < d.year) continue;
    const inDays = Math.round((at.getTime() - today.getTime()) / 86_400_000);
    if (inDays > DATE_AHEAD_DAYS) continue;
    const recipients = grownUps.map((g) => g.id).filter((id) => id !== d.person.id);
    if (recipients.length === 0) continue;
    const what = d.type === "BIRTHDAY" ? "birthday" : "anniversary";
    const when = inDays === 0 ? "is today" : inDays === 1 ? "is tomorrow" : `is in ${inDays} days`;
    out.push({
      kind: "REMINDER_DATE",
      key: `date:${d.id}:${dayKey(at)}`,
      recipients,
      title: `${d.person.firstName}'s ${what} ${when}`,
      href: `/people/${encodeURIComponent(d.person.id)}`,
      urgent: false,
    });
  }
  return out;
}

// ---- cars ----------------------------------------------------------------------------------

/** Car work due within this many days (by date, or by miles at the car's usual rate). */
export const CAR_AHEAD_DAYS = 7;
/** Phase 65b: paperwork (registration, inspection, insurance) needs longer: two weeks. */
export const PAPERWORK_AHEAD_DAYS = 14;

export type CarItemRow = {
  itemId: string;
  title: string;
  vehicle: { id: string; name: string };
  status: "OVERDUE" | "UPCOMING" | "OK" | "UNKNOWN";
  daysRemaining: number | null;
  milesRemaining: number | null;
  /** Days until the miles run out at the car's usual rate (lib/vehicles/mileage.ts), or null. */
  daysByMiles: number | null;
  /** What the last service was, so the next cycle reminds again: lastDoneAt's ISO or the mileage. */
  cycle: string;
  /** Phase 65b: paperwork reminds two weeks ahead. */
  paperwork?: boolean;
};

/** Overdue (once per cycle), or due within a week by date or by estimated miles. To every grown-up. */
export function planCars(items: CarItemRow[], grownUps: GrownUp[]): Reminder[] {
  const out: Reminder[] = [];
  for (const i of items) {
    // Never logged: there's nothing to count from (Phase 60's "Not logged yet").
    if (i.status === "UNKNOWN") continue;
    const ahead = i.paperwork ? PAPERWORK_AHEAD_DAYS : CAR_AHEAD_DAYS;
    const byDate = i.daysRemaining != null && i.daysRemaining <= ahead ? i.daysRemaining : null;
    const byMiles = i.daysByMiles != null && i.daysByMiles <= CAR_AHEAD_DAYS ? i.daysByMiles : null;
    const overdue = i.status === "OVERDUE";
    if (!overdue && byDate == null && byMiles == null) continue;
    const soonest = Math.min(byDate ?? Infinity, byMiles ?? Infinity);
    const when = overdue
      ? "is overdue"
      : soonest <= 0
        ? "is due now"
        : byDate != null && byDate === soonest
          ? `is due in ${soonest} ${soonest === 1 ? "day" : "days"}`
          : `is due in about ${soonest} ${soonest === 1 ? "day" : "days"}`;
    out.push({
      kind: "REMINDER_CAR",
      // Due soon and then overdue are two reminders in a cycle, at most.
      key: `car:${i.itemId}:${i.cycle}${overdue ? ":overdue" : ""}`,
      recipients: grownUps.map((g) => g.id),
      title: `${i.title} on the ${i.vehicle.name} ${when}`,
      href: `/vehicles/${encodeURIComponent(i.vehicle.id)}`,
      urgent: false,
    });
  }
  return out;
}

export type NewRecall = { vehicle: { id: string; name: string }; campaignNumber: string; component: string; parkIt: boolean };

/** A recall found since the car was last checked, and not marked handled. To every grown-up. */
export function planRecalls(recalls: NewRecall[], grownUps: GrownUp[]): Reminder[] {
  return recalls.map((r) => {
    // NHTSA's component is a path ("FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP"): its first part reads well.
    const part = r.component.split(":")[0].trim().toLowerCase() || "details on its page";
    return {
      kind: "REMINDER_RECALL" as const,
      key: `recall:${r.vehicle.id}:${r.campaignNumber}`,
      recipients: grownUps.map((g) => g.id),
      title: r.parkIt ? `A safety recall for the ${r.vehicle.name} says not to drive it (${part})` : `A safety recall for the ${r.vehicle.name}: ${part}`,
      href: `/vehicles/${encodeURIComponent(r.vehicle.id)}`,
      urgent: r.parkIt,
    };
  });
}
