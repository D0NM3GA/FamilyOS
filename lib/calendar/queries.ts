import { isAdult } from "@/lib/authz";
import { isAppOn } from "@/lib/apps";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { importantDateItems, schoolDueItems, schoolEventItems, taskItems, vehicleItems, type AgendaItem } from "./agenda";
import { loadImportantDates, loadSchoolDue, loadSchoolEvents, loadTaskInstances, loadVehicleDueDates } from "./sources";

/**
 * How far ahead the agenda lists chores and doses: as far as the boards generate them
 * (two weeks). Chores keep their pending instances when edited or paused, so generating
 * further out would keep a changed chore's old days around for longer than the boards do.
 */
export const AGENDA_TASK_HORIZON_DAYS = 14;

type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };

export type AgendaWeek = {
  /** Every app's items for the week except Outlook, which the page streams in separately. */
  items: AgendaItem[];
  /** Set when the week reaches past the last day chores and doses are planned for. */
  tasksPlannedThrough: Date | null;
};

/**
 * One week of the family's agenda for `viewer`, scoped to what they may see in each app:
 * chores and doses (everyone sees the boards), birthdays and dates, school (a kid only
 * their own, see lib/calendar/sources.ts) and, for grown-ups, car maintenance. Nothing
 * about money: school fees show as to-dos, never amounts. Phase 36: nothing from the
 * family's turned-off apps (`disabledApps`), which aren't even read.
 */
export async function getAgendaWeek(
  viewer: Viewer,
  opts: { start: Date; timeZone: string; now?: Date; disabledApps?: readonly string[] },
): Promise<AgendaWeek> {
  const { start, timeZone } = opts;
  const end = addDays(start, 7);
  const today = atMidnight(opts.now ?? new Date());
  const lastPlanned = addDays(today, AGENDA_TASK_HORIZON_DAYS);
  const tasksUntil = end < addDays(lastPlanned, 1) ? end : addDays(lastPlanned, 1);
  const adult = isAdult(viewer);
  const on = (app: string) => isAppOn(opts.disabledApps ?? [], app);
  const domains = [...(on("chores") ? (["CHORE"] as const) : []), ...(on("meds") ? (["MED"] as const) : [])];

  // Like the boards, roll instances forward on read (there's no cron), only as far as shown.
  if (tasksUntil > today && tasksUntil > start) {
    const through = addDays(tasksUntil, -1);
    await Promise.all(domains.map((domain) => ensureInstancesGenerated(viewer.householdId, through, domain)));
  }

  const [tasks, dates, school, events, vehicles] = await Promise.all([
    loadTaskInstances(viewer.householdId, { domains, from: start, until: tasksUntil }),
    loadImportantDates(viewer.householdId),
    on("school") ? loadSchoolDue(viewer, start, end) : [],
    on("school") ? loadSchoolEvents(viewer, start, end, timeZone) : [],
    // Cars is a grown-ups' app (lib/apps.ts), so a kid's agenda leaves it out.
    adult && on("cars") ? loadVehicleDueDates(viewer.householdId) : [],
  ]);

  return {
    items: [
      ...importantDateItems(dates, start),
      ...taskItems(tasks),
      ...schoolDueItems(school),
      ...schoolEventItems(events, start, timeZone),
      ...vehicleItems(vehicles),
    ],
    tasksPlannedThrough: domains.length > 0 && end > addDays(lastPlanned, 1) ? lastPlanned : null,
  };
}
