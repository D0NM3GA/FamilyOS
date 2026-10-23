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
import { dayKey, groupIntoDays, outlookItems, parseWeekParam, relativeWeekLabel, weekLabel, type AgendaItem } from "@/lib/calendar/agenda";
import { getAgendaWeek } from "@/lib/calendar/queries";
import { getDisabledApps } from "@/lib/app-switches";
import { PageHeader } from "@/components/page-header";
import { btn, iconBtn, sectionTitle } from "@/components/styles";
import { AgendaWeek } from "./agenda-week";
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
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  await requireAppOn("calendar");
  const profile = await requireActiveProfile();
  const { week } = await searchParams;
  const now = new Date();
  const today = atMidnight(now);
  const start = parseWeekParam(week, today);

  const [settings, sessionOwner, disabledApps] = await Promise.all([
    getHouseholdSettings(profile.householdId),
    isSessionOwner(profile),
    getDisabledApps(profile.householdId),
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
  const outlook = onMicrosoft && profile.authUserId ? getCalendarEvents(profile.authUserId, { start, end: addDays(start, 7) }, { calendarId: profile.homeCalendarId }) : null;
  const agenda = await getAgendaWeek(profile, { start, timeZone: zone, now, disabledApps });

  const notes: React.ReactNode[] = [];
  if (agenda.tasksPlannedThrough) {
    const t = agenda.tasksPlannedThrough;
    notes.push(`Chores and doses are planned two weeks ahead, so this week shows them through ${formatMonthDay(t.getMonth() + 1, t.getDate())}.`);
  }
  if (!outlook && isAdult(profile) && microsoftEnabled()) notes.push("Outlook events show here on the profile of whoever signed in with Microsoft.");

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="📅 Calendar">
        <Link href="/calendar#today" className={btn}>
          Today
        </Link>
        {isAdult(profile) && microsoftEnabled() && (
          <Link href="/calendar/outlook" className={btn}>
            Outlook sync ⚙️
          </Link>
        )}
      </PageHeader>

      <nav aria-label="Weeks" className="mt-4 flex items-center gap-2">
        <Link href={`/calendar?week=${dayKey(addDays(start, -7))}`} aria-label="Previous week" className={`${iconBtn} ring-1 ring-input`}>
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className={sectionTitle}>{relativeWeekLabel(start, today)}</p>
          <h2 className="font-heading text-xl font-extrabold leading-tight text-foreground sm:text-2xl">{weekLabel(start)}</h2>
        </div>
        <Link href={`/calendar?week=${dayKey(addDays(start, 7))}`} aria-label="Next week" className={`${iconBtn} ring-1 ring-input`}>
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </nav>

      {outlook ? (
        <Suspense fallback={<AgendaWeek days={groupIntoDays(agenda.items, start, today)} notes={[...notes, "Checking Outlook… 📆"]} />}>
          <WeekWithOutlook load={outlook} items={agenda.items} start={start} today={today} zone={zone} notes={notes} />
        </Suspense>
      ) : (
        <AgendaWeek days={groupIntoDays(agenda.items, start, today)} notes={notes} />
      )}
    </div>
  );
}

/**
 * Outlook is the slowest source (a network hop to Microsoft), so the week first renders
 * without it (the Suspense fallback) and this swaps in the same week with Outlook's
 * events slotted into their days.
 */
async function WeekWithOutlook({
  load,
  items,
  start,
  today,
  zone,
  notes,
}: {
  load: Promise<CalendarEventsResult>;
  items: AgendaItem[];
  start: Date;
  today: Date;
  zone: string;
  notes: React.ReactNode[];
}) {
  const result = await load;
  if (!result.ok) {
    return <AgendaWeek days={groupIntoDays(items, start, today)} notes={[...notes, `Outlook: ${result.error}`]} />;
  }
  const more = result.truncated ? ["Outlook has more this week than fits here; open Outlook for the rest."] : [];
  return <AgendaWeek days={groupIntoDays([...items, ...outlookItems(result.events, start, zone)], start, today)} notes={[...notes, ...more]} />;
}
