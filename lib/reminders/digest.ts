import { prisma } from "@/lib/prisma";
import { appOn } from "@/lib/app-switches";
import { alertMailbox, sendEmail } from "@/lib/alerts/email";
import { MICROSOFT_ACCOUNTS, recipientEmail, storeLink, teamsRecipient } from "@/lib/alerts/dispatch";
import { teamsActivity, type TeamsCard } from "@/lib/alerts/teams";
import { familyTeamsAppId, sendToPerson as sendTeamsToPerson } from "@/lib/teams/family-app";
import { getAppName } from "@/lib/household-settings";
import { captureError } from "@/lib/observability";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { inQuietHours } from "./quiet";
import { SYSTEM_PREFIX, type Reminder } from "./plan";
import { loadSchoolEvents } from "@/lib/calendar/sources";
import { getTodaysDinner } from "@/lib/groceries/meals";

/**
 * Phase 62c: the morning summary, opt-in per grown-up by email and/or Teams (the owner's call),
 * at 7:00 household time or the first tick after, once a day, outside their quiet hours. What's
 * on today and this week; never money. Nothing to say: nothing sent.
 */

export const DIGEST_HOUR = 7;
export const DIGEST_CARD: TeamsCard = { heading: "☀️ Today", linkText: "Open the app" };

export type DigestInput = {
  choresMine: number;
  choresAll: number;
  dosesMine: number;
  dosesAll: number;
  /** Titles from the reminder planners: school due today or tomorrow, car work this week, dates this week. */
  school: string[];
  cars: string[];
  dates: string[];
  /** Phase 67b: jobs or the backup that stopped, for an admin. */
  system?: string[];
  /** Phase 68b: today's school calendar events, schoolwork due today, tonight's dinner. */
  schoolEvents?: string[];
  homework?: string[];
  dinner?: string | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The summary's lines, or null when there's nothing to say. Pure. */
export function digestLines(d: DigestInput): string[] | null {
  const lines: string[] = [];
  if (d.choresAll > 0) lines.push(`Chores today: ${d.choresMine > 0 ? `${d.choresMine} for you, ` : ""}${plural(d.choresAll, "chore")} in all`);
  if (d.dosesAll > 0) lines.push(`Doses today: ${d.dosesMine > 0 ? `${d.dosesMine} for you, ` : ""}${plural(d.dosesAll, "dose")} in all`);
  if (d.schoolEvents?.length) lines.push(`At school today: ${d.schoolEvents.join("; ")}`);
  if (d.homework?.length) lines.push(`Due today: ${d.homework.join("; ")}`);
  lines.push(...d.school, ...d.cars, ...d.dates);
  if (d.dinner) lines.push(`Dinner tonight: ${d.dinner}`);
  // Phase 67b: admins only (the planned reminders say who): something in the app stopped.
  if (d.system?.length) lines.push(`Something stopped: ${d.system.join("; ")}`);
  return lines.length ? lines : null;
}

/** Whether it's time for someone's summary: 7:00 or later, not yet today, not in their quiet hours. Pure. */
export function digestDue(prefs: { digestLastOn: string | null; quietStart: number | null; quietEnd: number | null }, today: string, now: Date): boolean {
  return now.getHours() >= DIGEST_HOUR && prefs.digestLastOn !== today && !inQuietHours(prefs, now);
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Sends today's summaries for one household. `planned` are this tick's reminders, before anyone's
 * switches or quiet hours: the summary lists the school, car and date ones whoever they're for.
 */
export async function sendDigests(householdId: string, grownUpIds: string[], planned: Reminder[], now: Date): Promise<number> {
  const today = dayKey(now);
  const wanting = await prisma.reminderPrefs.findMany({
    where: { personId: { in: grownUpIds }, OR: [{ digestEmail: true }, { digestTeams: true }] },
    select: {
      personId: true,
      digestEmail: true,
      digestTeams: true,
      digestLastOn: true,
      quietStart: true,
      quietEnd: true,
      off: true,
      person: { select: { id: true, firstName: true, email: true, authUser: { select: { email: true, accounts: MICROSOFT_ACCOUNTS } } } },
    },
  });
  const due = wanting.filter((p) => digestDue(p, today, now));
  if (due.length === 0) return 0;

  const start = atMidnight(now);
  const end = addDays(start, 1);
  const [choresOn, medsOn] = await Promise.all([appOn(householdId, "chores"), appOn(householdId, "meds")]);
  // Chores, like doses, are otherwise made only when a page opens: make today's before counting.
  if (choresOn) await ensureInstancesGenerated(householdId, end, "CHORE");
  const todays = (domain: "CHORE" | "MED") =>
    prisma.taskInstance.findMany({
      where: { status: "PENDING", dueDate: { gte: start, lt: end }, definition: { householdId, domain, active: true } },
      select: { assignedToId: true },
    });
  const [chores, doses] = await Promise.all([choresOn ? todays("CHORE") : [], medsOn ? todays("MED") : []]);
  const extra = await morningExtras(householdId, now);
  const titles = (kind: Reminder["kind"]) => [...new Set(planned.filter((r) => r.kind === kind).map((r) => r.title))];

  const [mailbox, teamsAppId, appName] = await Promise.all([alertMailbox(householdId), familyTeamsAppId(householdId), getAppName(householdId)]);
  const link = storeLink("/");
  let sent = 0;
  for (const p of due) {
    // Claimed first (once a day, whichever app instance gets there), then sent.
    const { count } = await prisma.reminderPrefs.updateMany({
      where: { personId: p.personId, OR: [{ digestLastOn: null }, { digestLastOn: { not: today } }] },
      data: { digestLastOn: today },
    });
    if (count === 0) continue;
    const lines = digestLines({
      choresMine: chores.filter((c) => c.assignedToId === p.personId).length,
      choresAll: chores.length,
      dosesMine: doses.filter((d) => d.assignedToId === p.personId).length,
      dosesAll: doses.length,
      school: titles("REMINDER_SCHOOL"),
      cars: titles("REMINDER_CAR"),
      // Not their own birthday: the reminder for it isn't theirs either.
      dates: [...new Set(planned.filter((r) => r.kind === "REMINDER_DATE" && r.recipients.includes(p.personId)).map((r) => r.title))],
      // Unless they switched the reminder off.
      ...extra,
      system: p.off.includes("REMINDER_SYSTEM") ? [] : [...new Set(planned.filter((r) => r.kind === "REMINDER_SYSTEM" && r.recipients.includes(p.personId)).map((r) => r.title.replace(SYSTEM_PREFIX, "")))],
    });
    if (!lines) continue;
    const title = `Good morning, ${p.person.firstName}: today at a glance`;
    let went = false;
    if (p.digestEmail && mailbox) {
      const to = recipientEmail(p.person);
      if (to) went = (await sendEmail(mailbox, to, title, link, appName, {}, DIGEST_CARD.linkText, lines).then(() => true, (err) => (captureError(err, "digest.email_failed"), false))) || went;
    }
    if (p.digestTeams && teamsAppId) {
      const aad = teamsRecipient(p.person);
      if (aad) went = (await sendTeamsToPerson(p.personId, aad, teamsAppId, teamsActivity(title, link, DIGEST_CARD, lines)).then(() => true, (err) => (captureError(err, "digest.teams_failed"), false))) || went;
    }
    if (went) sent++;
  }
  return sent;
}

const SCHOOLWORK_WORDS: Record<string, string> = { HOMEWORK: "homework", TEST: "a test", QUIZ: "a quiz", PROJECT: "a project" };

/**
 * Phase 68b: what the summary adds for everyone: today's school calendar events (every active
 * feed, the kids' and the family's, read as the calendar reads them), kids' schoolwork due today,
 * and tonight's dinner, each only with its app on. Outlook stays out: the tick has no one's
 * Microsoft token.
 */
async function morningExtras(householdId: string, now: Date): Promise<Pick<DigestInput, "schoolEvents" | "homework" | "dinner">> {
  const [schoolOn, groceriesOn] = await Promise.all([appOn(householdId, "school"), appOn(householdId, "groceries")]);
  const today = atMidnight(now);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [events, work, dinner] = await Promise.all([
    schoolOn ? loadSchoolEvents({ id: "", householdId, role: "ADULT" }, today, addDays(today, 1), zone) : [],
    schoolOn
      ? prisma.schoolAssignment.findMany({
          where: { status: "TODO", dueDate: { gte: today, lt: addDays(today, 1) }, profile: { person: { householdId, isHouseholdMember: true, role: "KID" } } },
          select: { title: true, kind: true, profile: { select: { person: { select: { firstName: true } } } } },
          orderBy: { title: "asc" },
          take: 10,
        })
      : [],
    groceriesOn ? getTodaysDinner(householdId, now) : null,
  ]);
  return {
    schoolEvents: [...new Set(events.map((e) => (e.who ? `${e.title} (${e.who})` : e.title)))].slice(0, 6),
    homework: work.map((w) => `${w.profile.person.firstName}, ${SCHOOLWORK_WORDS[w.kind] ?? "schoolwork"}: ${w.title}`),
    dinner,
  };
}
