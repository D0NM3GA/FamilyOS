import { prisma } from "@/lib/prisma";
import { upcomingImportantDates, staleContacts } from "@/lib/people";
import { atMidnight } from "@/lib/tasks/schedule";
import { getVehiclesWithStatus } from "@/lib/vehicles/queries";
import { formatMonthDay } from "@/lib/format";
import { addDays } from "@/lib/tasks/schedule";
import { personalChoreFact, type ChoreProgress } from "@/lib/bunson-moments";
import { captureError } from "@/lib/observability";
import { overdueSince } from "@/lib/tasks/skip";
import { isAppOn } from "@/lib/apps";

// Tighter than Home's 30-day "Upcoming dates" card — a bubble line is only worth surfacing
// if the date is close, not a whole month out.
const UPCOMING_DATE_WINDOW_DAYS = 7;

function dateLabel(d: { label: string | null; type: "BIRTHDAY" | "ANNIVERSARY" | "OTHER" }) {
  if (d.label) return d.label.toLowerCase();
  if (d.type === "BIRTHDAY") return "birthday";
  if (d.type === "ANNIVERSARY") return "anniversary";
  return "important date";
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The person who's most overdue for a check-in, excluding the viewer — lib/people.ts's
 * staleContacts owns the actual "what counts as overdue" rule (household members excluded
 * by default, a never-contacted person only counts once they have an explicit cadence);
 * this used to reimplement a narrower version of that rule directly, which meant two
 * definitions of "stale" that could drift. Home's own "Haven't talked in a while" card
 * calls the same function.
 */
async function staleContactFact(householdId: string, excludeId: string): Promise<string | null> {
  const [contact] = await staleContacts(householdId, { excludeId, limit: 1 });
  return contact ? `Haven't heard from ${contact.firstName} in a while — maybe say hi?` : null;
}

/**
 * A plain count, not lib/tasks/queries.ts's getBoardInstances — that fetches full rows with
 * assignedTo/completedBy/definition relations for every instance up to its horizon, which is
 * the right shape for an actual board but wasteful to run a second time, on every single
 * page load, just to know a number.
 */
async function overdueTaskCount(householdId: string, domain: "CHORE" | "MED"): Promise<number> {
  return prisma.taskInstance.count({
    where: {
      definition: { householdId, domain },
      status: "PENDING",
      // The same window the boards show as overdue.
      dueDate: { gte: overdueSince(), lt: atMidnight(new Date()) },
    },
  });
}

/**
 * Phase 19.5: the viewer's own chores due today or earlier — one groupBy on status rather
 * than two counts (or a board query), since it runs whenever Bunson looks up his facts.
 * Overdue PENDING chores count as "waiting" too; DONE counts chores *due* today, the same
 * definition Home's greeting uses (lib/bunson-moments.ts choreProgressFor), so the greeting
 * and the bubble never disagree.
 */
export async function viewerChoreProgress(viewerId: string): Promise<ChoreProgress> {
  const today = atMidnight(new Date());
  const rows = await prisma.taskInstance.groupBy({
    by: ["status"],
    where: {
      assignedToId: viewerId,
      definition: { domain: "CHORE" },
      OR: [
        { status: "PENDING", dueDate: { gte: overdueSince(today), lt: addDays(today, 1) } },
        { status: "DONE", dueDate: { gte: today, lt: addDays(today, 1) } },
      ],
    },
    _count: { _all: true },
  });
  const count = (status: string) => rows.find((r) => r.status === status)?._count._all ?? 0;
  return { pending: count("PENDING"), done: count("DONE") };
}

/**
 * A handful of short, real-data lines for Bunson's speech bubble — mixed in with the static
 * jokes in components/bunson.tsx via lib/bunson-lines.ts. Since Phase 39 he fetches these
 * himself (app/api/bunson-facts) once he's on screen, at most every few minutes, instead of
 * the (app) layout computing them on every full load. Each source here is still either a
 * narrow targeted query (dates, stale contact, chore/med counts) or, for vehicles, an
 * accepted reuse of the domain's own query — "overdue" there needs the same mileage/interval
 * math lib/vehicles/due-status.ts already does, not worth reimplementing as a raw count.
 *
 * Deliberately never throws: a mascot's speech bubble is the definition of non-critical, so a
 * transient failure here should silently fall back to the static jokes (his facts just stay
 * empty) rather than failing the request.
 */
export async function getBunsonFacts(
  householdId: string,
  viewer: { id: string; firstName: string },
  /** Phase 36: the family's turned-off apps. He doesn't bring them up (or look them up). */
  disabledApps: readonly string[],
): Promise<string[]> {
  const viewerId = viewer.id;
  const on = (app: string) => isAppOn(disabledApps, app);
  try {
    const [upcoming, staleFact, choreOverdue, medOverdue, vehicleBoards, schoolFormsDue, mine] = await Promise.all([
      upcomingImportantDates(householdId, UPCOMING_DATE_WINDOW_DAYS),
      staleContactFact(householdId, viewerId),
      on("chores") ? overdueTaskCount(householdId, "CHORE") : 0,
      on("meds") ? overdueTaskCount(householdId, "MED") : 0,
      on("cars") ? getVehiclesWithStatus(householdId) : [],
      on("school")
        ? prisma.schoolTask.count({
            where: { householdId, status: "OPEN", dueDate: { lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } },
          })
        : 0,
      on("chores") ? viewerChoreProgress(viewerId) : null,
    ]);

    const facts: string[] = [];

    // The viewer's own chores first: the comedic nag lands better than household counts.
    const mineFact = mine && personalChoreFact(viewer.firstName, mine);
    if (mineFact) facts.push(mineFact);

    const nextDate = upcoming[0];
    if (nextDate) {
      facts.push(
        `${nextDate.person.firstName}'s ${dateLabel(nextDate)} is ${formatMonthDay(nextDate.month, nextDate.day)}!`,
      );
    }

    if (staleFact) facts.push(staleFact);

    if (choreOverdue > 0) {
      facts.push(`${plural(choreOverdue, "chore")} overdue. The board won't clear itself.`);
    }

    if (medOverdue > 0) {
      facts.push(`${plural(medOverdue, "dose")} not marked done yet.`);
    }

    const overdueVehicleCount = vehicleBoards.reduce(
      (sum, { items }) => sum + items.filter(({ due }) => due.status === "OVERDUE").length,
      0,
    );
    if (overdueVehicleCount > 0) {
      facts.push(`${plural(overdueVehicleCount, "vehicle maintenance item")} overdue.`);
    }

    if (schoolFormsDue > 0) {
      facts.push(`${plural(schoolFormsDue, "school form")} to sort out this week. Permission slips don't sign themselves!`);
    }

    return facts;
  } catch (err) {
    console.error("[bunson-facts] failed to compute facts — falling back to jokes only", err);
    captureError(err);
    return [];
  }
}
