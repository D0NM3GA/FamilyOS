import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { isMedLow } from "./supply";
import { BACKUP_HEARTBEAT, BACKUP_LATE_MS, heartbeatState, JOB_LATE_MS, type HeartbeatRow } from "@/lib/heartbeat-state";

/**
 * Phase 62: what to remind whom about, worked out from rows. Pure (no Prisma, no clock but `now`),
 * so each rule is unit-tested; lib/reminders/run.ts loads the rows and sends. The server keeps
 * the household's time (lib/household-zone.ts), so local Date getters are the family's.
 *
 * A reminder names the item and when, nothing more, and links to where it's handled. Its key
 * names the thing and its occurrence: the same key never goes to the same person twice
 * (ReminderSent), and the next occurrence reminds again.
 */

export type ReminderKind =
  | "REMINDER_DOSE"
  | "REMINDER_MED_LOW"
  | "REMINDER_SCHOOL"
  | "REMINDER_DATE"
  | "REMINDER_CAR"
  | "REMINDER_RECALL"
  | "REMINDER_SYSTEM"
  | "REMINDER_DOSE_DUE"
  | "REMINDER_HOMEWORK"
  | "REMINDER_CHORES";

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
/** Phase 68a: a dose is due from this long before its time (until it's missed). */
export const DOSE_AHEAD_MS = 15 * 60_000;
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
  /** Phase 68a: `adult` says whose dose is a grown-up's own. */
  assignedTo: { id: string; firstName: string; adult?: boolean } | null;
};

const doseKey = (r: DoseRow) => `${dayKey(r.dueDate)}:${String(r.dueDate.getHours()).padStart(2, "0")}${String(r.dueDate.getMinutes()).padStart(2, "0")}`;

/**
 * Phase 68a (opt-in, the owner's call): a PENDING timed dose of an active medicine, from 15 minutes
 * before its time until the missed-dose reminder takes over. A grown-up's own dose goes to them; a
 * kid's or nobody's to the grown-ups who switched it on (`optedIn`), and a kid always gets the bell
 * for their own. Who opted in is checked again where it's sent (run.ts), like `off`.
 */
export function planDosesDue(rows: DoseRow[], optedIn: GrownUp[], now: Date): Reminder[] {
  const grownUps = optedIn.map((g) => g.id);
  return rows
    .filter((r) => r.status === "PENDING" && r.timed && r.active)
    .filter((r) => {
      const late = now.getTime() - r.dueDate.getTime();
      return late >= -DOSE_AHEAD_MS && late < DOSE_GRACE_MS;
    })
    .map((r) => ({
      kind: "REMINDER_DOSE_DUE" as const,
      key: `dose-due:${r.definitionId}:${doseKey(r)}`,
      recipients: r.assignedTo?.adult ? [r.assignedTo.id] : unique([...(r.assignedTo ? [r.assignedTo.id] : []), ...grownUps]),
      title: r.assignedTo ? `Time for ${r.assignedTo.firstName}'s ${r.timeLabel} dose of ${r.title}` : `Time for the ${r.timeLabel} dose of ${r.title}`,
      href: "/meds",
      urgent: false,
    }))
    .filter((r) => r.recipients.length > 0);
}

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
      key: `dose:${r.definitionId}:${doseKey(r)}`,
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

/**
 * A birthday or anniversary within a week: to every grown-up but the person it's about. Phase 70d: a
 * birthday says how many gift ideas are saved for them (`giftIdeas`, by person), never the ideas
 * themselves: the title also goes out by Teams and email, and the ideas are a tap away on their page.
 */
export function planDates(dates: DateRow[], grownUps: GrownUp[], now: Date, giftIdeas: ReadonlyMap<string, number> = new Map()): Reminder[] {
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
      title: `${d.person.firstName}'s ${what} ${when}${giftLine(d.type === "BIRTHDAY" ? (giftIdeas.get(d.person.id) ?? 0) : 0)}`,
      href: `/people/${encodeURIComponent(d.person.id)}`,
      urgent: false,
    });
  }
  return out;
}

const giftLine = (n: number) => (n === 0 ? "" : n === 1 ? " · 1 gift idea saved" : ` · ${n} gift ideas saved`);

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

// ---- the app itself (Phase 67b) ------------------------------------------------------------

/** Phase 67b: how a system reminder's title starts; the morning summary drops it. */
export const SYSTEM_PREFIX = "⚠️ ";

const sinceWords = (d: Date) => d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * A background job that's failing or late, or the nightly backup failing or over 36 hours late
 * (Data's System card's own rules), to the admins. Keyed on the last good run, which holds still
 * while it stays broken (the last failure moves every tick), so it reminds once per problem and
 * again if it comes back after working; for a failing job, on the day of that run, so one that
 * keeps failing and recovering (a flaky bank feed) reminds once a day, not every hour. Late and
 * then failing are two facts and two reminders. Never-run ones don't remind (a server without its
 * backup cron yet). The reminders job is left out: this runs inside it (so it's running, and
 * hasn't recorded this run yet), and the jobs after it haven't run this tick; only the outside
 * check-in can say the reminders job stopped.
 */
/** The reminders job itself, and the jobs that run after it in a tick. */
const SELF_OR_AFTER = new Set(["reminders"]);

export function planSystem(rows: HeartbeatRow[], jobs: readonly { name: string; label: string }[], admins: GrownUp[], now: Date): Reminder[] {
  if (admins.length === 0) return [];
  const byName = new Map(rows.map((r) => [r.name, r]));
  const watched = [...jobs.filter((j) => !SELF_OR_AFTER.has(j.name)).map((j) => ({ ...j, late: JOB_LATE_MS })), { name: BACKUP_HEARTBEAT, label: "The nightly backup", late: BACKUP_LATE_MS }];
  const out: Reminder[] = [];
  for (const job of watched) {
    const row = byName.get(job.name);
    const state = heartbeatState(row, job.late, now);
    if (state !== "failing" && state !== "late") continue;
    const lastOk = row?.lastOkAt ?? null;
    out.push({
      kind: "REMINDER_SYSTEM",
      key: `system:${job.name}:${state}:${lastOk ? (state === "failing" ? dayKey(lastOk) : lastOk.toISOString()) : "never"}`,
      recipients: admins.map((a) => a.id),
      // Late always has a last good run (no run at all is "never").
      title:
        state === "failing" || !lastOk
          ? `${SYSTEM_PREFIX}${job.label} stopped working${lastOk ? `; it last worked ${sinceWords(lastOk)}` : ""}`
          : `${SYSTEM_PREFIX}${job.label} hasn't run since ${sinceWords(lastOk)}`,
      href: "/data#system",
      urgent: false,
    });
  }
  return out;
}

// ---- homework and chores (Phase 68b) --------------------------------------------------------

/** Homework due tomorrow reminds from this hour today. */
export const HOMEWORK_FROM_HOUR = 15;
/** Chores still open remind from this hour (the owner's call: 6 pm). */
export const CHORES_FROM_HOUR = 18;

export type HomeworkRow = { id: string; title: string; kind: string; className: string; dueDate: Date; status: string; kid: { id: string; firstName: string } };

const WORK_WORDS: Record<string, string> = { HOMEWORK: "homework", TEST: "a test", QUIZ: "a quiz", PROJECT: "a project" };

/**
 * A kid's homework, quiz, test or project still to do and due tomorrow, from 3 pm: the kid's bell
 * in their own words ("You have a quiz due tomorrow"), and the grown-ups' with the kid's name.
 */
export function planHomework(rows: HomeworkRow[], grownUps: GrownUp[], now: Date): Reminder[] {
  if (now.getHours() < HOMEWORK_FROM_HOUR) return [];
  const tomorrow = addDays(atMidnight(now), 1);
  return rows
    .filter((r) => r.status === "TODO" && atMidnight(r.dueDate).getTime() === tomorrow.getTime())
    .flatMap((r) => {
      const what = `${WORK_WORDS[r.kind] ?? "schoolwork"} due tomorrow: ${r.title}`;
      const base = { kind: "REMINDER_HOMEWORK" as const, href: `/school?kid=${encodeURIComponent(r.kid.id)}`, urgent: false };
      const kid: Reminder = { ...base, key: `homework:${r.id}:${dayKey(r.dueDate)}`, recipients: [r.kid.id], title: `You have ${what}` };
      const adults = grownUps.filter((g) => g.id !== r.kid.id).map((g) => g.id);
      return adults.length ? [kid, { ...base, key: `homework-for:${r.id}:${dayKey(r.dueDate)}`, recipients: adults, title: `${r.kid.firstName} has ${what}` }] : [kid];
    });
}

export type OpenChoreRow = { kid: { id: string; firstName: string } };

/**
 * From 6 pm (the owner's call): each kid with their own chores still open today gets a bell, and
 * the grown-ups one line naming them. "Anyone" chores and grown-ups' own aren't counted.
 */
export function planChores(rows: OpenChoreRow[], grownUps: GrownUp[], now: Date): Reminder[] {
  if (now.getHours() < CHORES_FROM_HOUR) return [];
  const day = dayKey(now);
  const byKid = new Map<string, { firstName: string; count: number }>();
  for (const r of rows) {
    const k = byKid.get(r.kid.id) ?? { firstName: r.kid.firstName, count: 0 };
    k.count++;
    byKid.set(r.kid.id, k);
  }
  if (byKid.size === 0) return [];
  const words = (n: number) => `${n} ${n === 1 ? "chore" : "chores"}`;
  const kids = [...byKid].sort((a, b) => a[1].firstName.localeCompare(b[1].firstName));
  const out: Reminder[] = kids.map(([id, k]) => ({
    kind: "REMINDER_CHORES" as const,
    key: `chores:${id}:${day}`,
    recipients: [id],
    title: `${words(k.count)} still to do today`,
    href: "/chores",
    urgent: false,
  }));
  if (grownUps.length) {
    out.push({
      kind: "REMINDER_CHORES",
      key: `chores:all:${day}`,
      recipients: grownUps.map((g) => g.id),
      title: `Still to do today: ${kids.map(([, k]) => `${k.firstName} ${k.count}`).join(", ")}`,
      href: "/chores",
      urgent: false,
    });
  }
  return out;
}
