import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { formatMonthDay } from "@/lib/format";
import { getHouseholdSettings } from "@/lib/household-settings";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { scheduleFeedRefresh } from "@/lib/school/feeds/schedule";
import { getCalendarEvents, type CalendarEventsResult } from "@/lib/graph/calendar";
import {
  MONTH_GRID_DAYS,
  dayKey,
  groupIntoDays,
  itemPerson,
  itemsForPerson,
  monthKey,
  monthLabel,
  outlookItems,
  parseMonthParam,
  parseWeekParam,
  relativeWeekLabel,
  shiftMonth,
  weekLabel,
  weekStartOf,
  type AgendaItem,
} from "@/lib/calendar/agenda";
import { getAgendaWeek } from "@/lib/calendar/queries";
import { getDisabledApps } from "@/lib/app-switches";
import { PageHeader } from "@/components/page-header";
import { btn, chip, chipRow, iconBtn, sectionTitle } from "@/components/styles";
import { AgendaWeek } from "./agenda-week";
import { AgendaMonth } from "./agenda-month";
import { getHouseholdMembers } from "@/lib/people";
import { personColor } from "@/lib/person-color";
import { requireAppOn } from "@/lib/app-guard";
import { signInKind } from "@/lib/sign-in-kind";
import { microsoftEnabled } from "@/lib/auth";

/**
 * The family calendar: one week of everything the app knows is coming up (chores, doses,
 * birthdays, school, car maintenance) in one place, read-only, each linking to where it
 * lives. The signed-in Microsoft account's own Outlook events join in, streamed after the
 * rest. Outside the domain zones like /data and /search: it reads every app through
 * lib/calendar. Kids have it too (lib/apps.ts): everything here is scoped to whoever is
 * looking (their own school things, no cars, no Outlook).
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string | string[]; month?: string | string[]; view?: string | string[]; who?: string | string[] }> }) {
  await requireAppOn("calendar");
  const profile = await requireActiveProfile();
  const { week, month: monthParam, view, who: whoParam } = await searchParams;
  const now = new Date();
  const today = atMidnight(now);
  const isMonth = view === "month";
  const month = parseMonthParam(monthParam, today);
  const start = isMonth ? weekStartOf(month) : parseWeekParam(week, today);
  const days = isMonth ? MONTH_GRID_DAYS : 7;

  const [settings, sessionOwner, disabledApps, members] = await Promise.all([
    getHouseholdSettings(profile.householdId),
    isSessionOwner(profile),
    getDisabledApps(profile.householdId),
    getHouseholdMembers(profile.householdId),
    // School feeds older than 6 hours refresh after this page is sent (Phase 18.5); not while
    // School is turned off (the feeds check that themselves).
    scheduleFeedRefresh(profile.householdId).catch(() => {}),
  ]);
  const zone = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Outlook comes from the signed-in adult's own Graph token: only ever on that adult's own
  // profile, never a kid's or a PIN-switched adult's (they'd see someone else's calendar).
  // Started now, awaited inside the Suspense boundary below.
  // Phase 40.1b: a passkey sign-in has no Outlook behind it.
  const onMicrosoft = sessionOwner && profile.authUserId !== null && (await signInKind(profile)) === "microsoft";
  const outlook = onMicrosoft && profile.authUserId ? getCalendarEvents(profile.authUserId, { start, end: addDays(start, days) }, { calendarId: profile.homeCalendarId }) : null;
  const agenda = await getAgendaWeek(profile, { start, days, eventsOnly: isMonth, timeZone: zone, now, disabledApps });

  const notes: React.ReactNode[] = [];
  if (agenda.tasksPlannedThrough) {
    const t = agenda.tasksPlannedThrough;
    notes.push(`Chores and doses are planned two weeks ahead, so this week shows them through ${formatMonthDay(t.getMonth() + 1, t.getDate())}.`);
  }
  if (!outlook && isAdult(profile) && microsoftEnabled()) notes.push("Outlook events show here on the profile of whoever signed in with Microsoft.");

  const firstNames = new Set(members.map((m) => m.firstName));
  const who = typeof whoParam === "string" && firstNames.has(whoParam) ? whoParam : null;
  const colors = new Map(members.map((m) => [m.firstName, personColor(m).bg]));
  const whoQuery = who ? `&who=${encodeURIComponent(who)}` : "";
  const weekHref = (at: Date, keepWho = true) => `/calendar?week=${dayKey(at)}${keepWho ? whoQuery : ""}`;
  const monthHref = (at: Date) => `/calendar?view=month&month=${monthKey(at)}${whoQuery}`;
  const here = (person: string | null) => {
    const asked = person ? `&who=${encodeURIComponent(person)}` : "";
    return isMonth ? `/calendar?view=month&month=${monthKey(month)}${asked}` : `/calendar?week=${dayKey(start)}${asked}`;
  };
  const view_ = { start, today, zone, notes, who, firstNames, colors, days, isMonth, month, whoQuery };

  return (
    <div className="max-w-[90rem] p-4 sm:p-6">
      <PageHeader title="📅 Calendar">
        <Link href={isMonth ? monthHref(today) : `${weekHref(weekStartOf(today))}#day-${dayKey(today)}`} className={btn}>
          Today
        </Link>
        <Link href={isMonth ? weekHref(weekStartOf(month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear() ? today : month)) : monthHref(new Date(addDays(start, 3).getFullYear(), addDays(start, 3).getMonth(), 1))} className={btn}>
          {isMonth ? "Week" : "Month"}
        </Link>
        {isAdult(profile) && microsoftEnabled() && (
          <Link href="/calendar/outlook" className={btn}>
            Outlook sync ⚙️
          </Link>
        )}
      </PageHeader>

      {/* A kid's calendar is already their own. */}
      {isAdult(profile) && members.length > 1 && (
        <nav aria-label="Whose calendar" className={`mt-3 ${chipRow}`}>
          <Link href={here(null)} aria-current={!who ? "page" : undefined} className={chip}>
            Everyone
          </Link>
          {[...firstNames].map((name) => (
            <Link key={name} href={here(name)} aria-current={who === name ? "page" : undefined} className={`${chip} inline-flex items-center gap-1.5`}>
              <span aria-hidden className="size-3 rounded-full ring-1 ring-ink/30" style={{ backgroundColor: colors.get(name) }} />
              {name}
            </Link>
          ))}
        </nav>
      )}

      <nav aria-label={isMonth ? "Months" : "Weeks"} className="mt-4 flex items-center gap-2">
        <Link href={isMonth ? monthHref(shiftMonth(month, -1)) : weekHref(addDays(start, -7))} aria-label={isMonth ? "Previous month" : "Previous week"} className={`${iconBtn} ring-1 ring-border`}>
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          {!isMonth && <p className={sectionTitle}>{relativeWeekLabel(start, today)}</p>}
          <h2 className="font-heading text-xl font-extrabold leading-tight text-foreground sm:text-2xl">{isMonth ? monthLabel(month) : weekLabel(start)}</h2>
        </div>
        <Link href={isMonth ? monthHref(shiftMonth(month, 1)) : weekHref(addDays(start, 7))} aria-label={isMonth ? "Next month" : "Next week"} className={`${iconBtn} ring-1 ring-border`}>
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </nav>

      {outlook ? (
        <Suspense fallback={<Shown items={agenda.items} {...view_} notes={[...notes, "Checking Outlook…"]} />}>
          <WithOutlook load={outlook} items={agenda.items} {...view_} />
        </Suspense>
      ) : (
        <Shown items={agenda.items} {...view_} />
      )}
    </div>
  );
}

type ViewProps = {
  items: AgendaItem[];
  start: Date;
  today: Date;
  zone: string;
  notes: React.ReactNode[];
  who: string | null;
  firstNames: Set<string>;
  colors: Map<string, string>;
  days: number;
  isMonth: boolean;
  month: Date;
  whoQuery: string;
};

/** The week or the month, for everyone or one person, with each row in its person's color. */
function Shown({ items, start, today, notes, who, firstNames, colors, days, isMonth, month, whoQuery }: ViewProps) {
  const shown = who ? itemsForPerson(items, who, firstNames) : items;
  const grouped = groupIntoDays(shown, start, today, days);
  if (isMonth) {
    return <AgendaMonth days={grouped} month={month} whoQuery={whoQuery} notes={[...notes, "A month shows what's happening. Chores and doses are on each week."]} />;
  }
  const colorOf = (item: AgendaItem) => {
    const person = itemPerson(item, firstNames);
    return person ? (colors.get(person) ?? null) : null;
  };
  return <AgendaWeek days={grouped} notes={notes} colorOf={colorOf} />;
}

/**
 * Outlook is the slowest source (a network hop to Microsoft), so the page first renders
 * without it (the Suspense fallback) and this swaps in the same view with Outlook's
 * events slotted into their days.
 */
async function WithOutlook({ load, ...view }: ViewProps & { load: Promise<CalendarEventsResult> }) {
  const result = await load;
  if (!result.ok) return <Shown {...view} notes={[...view.notes, `Outlook: ${result.error}`]} />;
  const more = result.truncated ? [`Outlook has more this ${view.isMonth ? "month" : "week"} than fits here; open Outlook for the rest.`] : [];
  return <Shown {...view} items={[...view.items, ...outlookItems(result.events, view.start, view.zone, view.days)]} notes={[...view.notes, ...more]} />;
}
