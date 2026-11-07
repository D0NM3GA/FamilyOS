import { ChevronRight } from "lucide-react";
import { personColor } from "@/lib/person-color";
import { LookKicker } from "@/components/look-voice";
import type { VoiceKicker } from "@/lib/looks";
import Link from "next/link";
import { Suspense } from "react";
import { requireActiveProfile, isSessionOwner } from "@/lib/active-profile";
import { upcomingImportantDates, staleContacts, fullName, dateWhen, turnsAge, getHouseholdMembers } from "@/lib/people";
import { getAgendaWeek } from "@/lib/calendar/queries";
import { itemPerson, outlookItems, timeLabel, todayStrip, type AgendaItem } from "@/lib/calendar/agenda";
import { formatRelative, formatMonthDay, formatTimeOfDay } from "@/lib/format";
import { atMidnight } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { getBoardInstances } from "@/lib/tasks/queries";
import { getVehiclesWithStatus } from "@/lib/vehicles/queries";
import { getThisWeekEvents, type CalendarEvent, type ThisWeekResult } from "@/lib/graph/calendar";
import { getHouseholdActivity } from "@/lib/activity";
import { scheduleAutoSync } from "@/lib/calendar-sync/auto";
import { getSchoolDueSoon, getUpcomingSchoolEvents } from "@/lib/school/queries";
import { scheduleFeedRefresh } from "@/lib/school/feeds/schedule";
import { getHouseholdSettings, getRewardWords } from "@/lib/household-settings";
import { formatDateTime, formatEventWhen } from "@/lib/format";
import { BunsonMoment } from "@/components/bunson-moment";
import { MilestoneToastBoard } from "@/components/tasks/milestone-toast";
import { TaskInstanceCard } from "@/components/tasks/task-instance-card";
import { iconBtn } from "@/components/styles";
import { logQuickContact } from "./people/[id]/actions";
import { isAdult } from "@/lib/authz";
import { resolveViewMode } from "@/lib/view-prefs";
import { LookScene } from "@/components/look-scene";
import { choreProgressFor, currentHour, greetingLine } from "@/lib/bunson-moments";
import { toCardInstance } from "@/lib/tasks/card";
import { completeInstance as completeChore, uncompleteInstance as undoChore } from "./chores/actions";
import { completeInstance as completeMed, uncompleteInstance as undoMed } from "./meds/actions";
import { BigHome } from "./big-home";
import { getMyWallet, getOpenOrders } from "@/lib/store/queries";
import { getDisabledApps } from "@/lib/app-switches";
import { appsOffFor, isAppOn } from "@/lib/apps";
import { SubmitButton } from "@/components/submit";
import { AwayNote, AwayTime } from "@/components/away-time";
import { signInKind } from "@/lib/sign-in-kind";
import { microsoftEnabled } from "@/lib/auth";

type AppOn = (app: string) => boolean;
type Board = Awaited<ReturnType<typeof getBoardInstances>>;

/** Phase 36: a turned-off app's board, without asking the database: nothing due. */
function emptyBoard(today: Date): Board {
  return { overdue: [], dueToday: [], upcoming: [], olderMissed: 0, today, horizon: today };
}

/**
 * Phase 19.5 "Big buttons" Home. Fetches only what BigHome shows — none of the full
 * dashboard's Graph calendar, sync, vehicles or activity work.
 */
async function BigHomePage({ profile, on }: { profile: Awaited<ReturnType<typeof requireActiveProfile>>; on: AppOn }) {
  const today = atMidnight(new Date());
  await Promise.all([
    on("chores") ? ensureInstancesGenerated(profile.householdId, today, "CHORE") : null,
    on("meds") ? ensureInstancesGenerated(profile.householdId, today, "MED") : null,
  ]);
  // "My stuff": their own chores plus "Anyone" ones they can grab (and earn) themselves.
  const [chores, meds, wallet, school, household, words, ownsCalendar] = await Promise.all([
    on("chores")
      ? getBoardInstances(profile.householdId, { horizonDays: 0, personId: profile.id, includeUnassigned: true, domain: "CHORE" })
      : emptyBoard(today),
    on("meds") ? getBoardInstances(profile.householdId, { horizonDays: 0, personId: profile.id, domain: "MED" }) : emptyBoard(today),
    on("store") ? getMyWallet(profile.id) : null,
    on("school") ? getSchoolDueSoon(profile, 7) : [],
    getHouseholdSettings(profile.householdId),
    getRewardWords(profile.householdId),
    Promise.all([isSessionOwner(profile), signInKind(profile)]).then(([owner, kind]) => owner && kind === "microsoft"),
  ]);
  const zone = household.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const myMeds = [...meds.overdue, ...meds.dueToday];
  // Phase 64a: what's on at school today (their own feeds and the family's), and the family's
  // birthdays this week; and the Outlook sync, for its owner on their own Microsoft sign-in, as
  // the full Home does.
  const [schoolToday, dates] = await Promise.all([
    on("school") ? getUpcomingSchoolEvents(profile, { days: 0, timeZone: zone }) : [],
    upcomingImportantDates(profile.householdId, 7),
    ownsCalendar ? scheduleAutoSync(profile).catch(() => {}) : null,
  ]);
  const birthdays = dates
    .filter((d) => d.type === "BIRTHDAY" && d.person.isHouseholdMember)
    .map((d) => ({ key: d.id, text: `${d.person.firstName}'s birthday is ${dateWhen(d.next)}` }));

  return (
    <BigHome
      viewerId={profile.id}
      viewerIsAdult={isAdult(profile)}
      greeting={greetingLine(profile.firstName, currentHour(zone), on("chores") ? choreProgressFor(profile.id, chores) : null, words)}
      choresOn={on("chores")}
      stickers={wallet?.balance ?? null}
      goal={wallet?.goal}
      chores={[...chores.overdue, ...chores.dueToday].map(toCardInstance)}
      meds={myMeds.map(toCardInstance)}
      medTimes={Object.fromEntries(myMeds.map((i) => [i.id, formatTimeOfDay(i.dueDate)]))}
      overdueMedIds={meds.overdue.map((i) => i.id)}
      school={school}
      schoolToday={schoolToday.map((e) => ({ key: `${e.feedId}:${e.occurrenceKey}`, title: e.title }))}
      birthdays={birthdays}
      onCompleteChore={completeChore}
      onUndoChore={undoChore}
      onCompleteMed={completeMed}
      onUndoMed={undoMed}
    />
  );
}

export default async function HomePage() {
  const profile = await requireActiveProfile();
  // Phase 36: a turned-off app has no card here, and its work isn't started from here. Nor
  // has a grown-up app on a kid's Home: its page would turn them away.
  const disabled = appsOffFor(isAdult(profile), await getDisabledApps(profile.householdId));
  const on: AppOn = (app) => isAppOn(disabled, app);
  if (resolveViewMode(profile.viewMode, isAdult(profile)) === "BIG") return <BigHomePage profile={profile} on={on} />;

  // Calendar comes from the signed-in adult's own Graph token — only fetch/show it when
  // the active profile IS that adult, not a kid or a different PIN-switched adult who'd
  // otherwise see the signed-in adult's real calendar.
  // Home only shows overdue + today, so only that much needs to exist yet.
  const today = atMidnight(new Date());
  // Phase 40.1b: and only a Microsoft sign-in has an Outlook calendar (not a passkey).
  const [showCalendar, settings] = await Promise.all([
    Promise.all([isSessionOwner(profile), signInKind(profile)]).then(([owner, kind]) => owner && kind === "microsoft"),
    getHouseholdSettings(profile.householdId),
    on("school") ? scheduleFeedRefresh(profile.householdId).catch(() => {}) : null,
    on("chores") ? ensureInstancesGenerated(profile.householdId, today, "CHORE") : null,
    on("meds") ? ensureInstancesGenerated(profile.householdId, today, "MED") : null,
  ]);

  const homeZone = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [upcomingDates, stale, choreBoard, medBoard, vehicleBoards, activity, schoolDue, schoolFeed, openOrders, , todayAgenda, members] = await Promise.all([
    upcomingImportantDates(profile.householdId, 30),
    staleContacts(profile.householdId, { excludeId: profile.id, limit: 5 }),
    on("chores") ? getBoardInstances(profile.householdId, { horizonDays: 0, domain: "CHORE" }) : emptyBoard(today),
    on("meds") ? getBoardInstances(profile.householdId, { horizonDays: 0, domain: "MED" }) : emptyBoard(today),
    on("cars") ? getVehiclesWithStatus(profile.householdId) : [],
    getHouseholdActivity(profile.householdId, 8, { viewerIsAdult: isAdult(profile), disabledApps: disabled }),
    on("school") ? getSchoolDueSoon(profile, 7) : [],
    getHouseholdSettings(profile.householdId).then((s) => {
      const zone = s.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      return on("school")
        ? getUpcomingSchoolEvents(profile, { days: 7, timeZone: zone }).then((events) => ({ events, zone }))
        : { events: [], zone };
    }),
    // Phase 20: grown-ups see the Sticker Store's open orders at the top of Home.
    isAdult(profile) && on("store") ? getOpenOrders(profile.householdId) : Promise.resolve([]),
    // Phase 17: keeps the family's Outlook calendar current, after the page is sent. Only for
    // the calendar's owner on their own profile (it writes with their token).
    showCalendar && on("calendar") ? scheduleAutoSync(profile).catch(() => {}) : null,
    // Phase 64a: today at a glance, above the cards: dates, school, schoolwork and car work (the
    // agenda's events; chores and doses stay in Today, where they're done).
    getAgendaWeek(profile, { start: today, days: 1, eventsOnly: true, timeZone: homeZone, disabledApps: disabled }),
    getHouseholdMembers(profile.householdId),
  ]);
  const { events: schoolEvents, zone } = schoolFeed;
  // Outlook joins the Today strip from the Calendar card's own fetch, shared, inside its own Suspense.
  const memberIds = new Set(members.map((m) => m.id));
  const colors = Object.fromEntries(members.map((m) => [m.id, personColor(m).bg]));
  const outlookLoad: Promise<ThisWeekResult> | null =
    on("calendar") && microsoftEnabled()
      ? showCalendar && profile.authUserId
        ? getThisWeekEvents(profile.authUserId, profile.homeCalendarId)
        : Promise.resolve<ThisWeekResult>({ ok: false, error: "Outlook shows here for whoever signed in with Microsoft, on their own profile." })
      : null;
  // Cards stagger in by position, so a turned-off app's card leaves no gap in the rhythm.
  // The app cards are named by their app's id; the rest aren't switchable, so always on.
  // Phase 40.1b: the calendar card is Outlook's, so an install without Microsoft has none.
  const outlookCard = outlookLoad !== null;
  const showToday = on("chores") || on("meds");
  const cards = ["today", "calendar", "school", "dates", "stale", "cars", "activity"].filter((c) =>
    c === "today" ? showToday : c === "calendar" ? outlookCard : on(c),
  );
  const index = (card: string) => cards.indexOf(card);

  // Vehicle maintenance has no notification/cron surface of its own (see
  // docs/BUILD.md) — Home is the only place an overdue item becomes visible without
  // someone happening to open /vehicles on their own.
  const overdueMaintenance = vehicleBoards.flatMap(({ vehicle, items }) =>
    items
      .filter(({ due }) => due.status === "OVERDUE")
      .map(({ item }) => ({ id: item.id, title: item.title, vehicleId: vehicle.id, vehicleName: vehicle.name })),
  );

  const words = await getRewardWords(profile.householdId);

  return (
    <div className="ui-home max-w-[90rem] p-4 sm:p-6">
      <h1 className="sr-only">Home</h1>
      <LookScene firstName={profile.firstName} date={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone }).format(new Date())} />
      <div className="mb-4 empty:hidden">
        <AwayNote />
      </div>
      <BunsonMoment
        kind="chatty"
        text={greetingLine(profile.firstName, currentHour(zone), on("chores") ? choreProgressFor(profile.id, choreBoard) : null, words)}
      />

      {outlookLoad ? (
        <Suspense fallback={<TodayStrip items={todayAgenda.items} memberIds={memberIds} colors={colors} />}>
          <TodayStripWithOutlook items={todayAgenda.items} load={outlookLoad} today={today} zone={zone} memberIds={memberIds} colors={colors} />
        </Suspense>
      ) : (
        <TodayStrip items={todayAgenda.items} memberIds={memberIds} colors={colors} />
      )}

      {showToday && (
        <MilestoneToastBoard>
          <Card title="Today" kicker="chores" index={index("today")} className="ui-today mt-6">
            <div className={`grid gap-6 ${on("chores") && on("meds") ? "lg:grid-cols-2" : ""}`}>
              {on("chores") && (
                <section>
                  <h3 className="mb-2 font-bold text-foreground">Chores</h3>
                  <HomeTasks
                    board={choreBoard}
                    href="/chores"
                    noun="chores"
                    viewerId={profile.id}
                    viewerIsAdult={isAdult(profile)}
                    onComplete={completeChore}
                    onUndo={undoChore}
                    claimable
                  />
                </section>
              )}
              {on("meds") && (
                <section>
                  <h3 className="mb-2 font-bold text-foreground">Meds</h3>
                  <HomeTasks
                    board={medBoard}
                    href="/meds"
                    noun="doses"
                    viewerId={profile.id}
                    viewerIsAdult={isAdult(profile)}
                    onComplete={completeMed}
                    onUndo={undoMed}
                    timed
                  />
                </section>
              )}
            </div>
          </Card>
        </MilestoneToastBoard>
      )}

      {openOrders.length > 0 && (
        <Link
          href="/points#orders"
          className="mt-6 block rounded-3xl border-2 border-ink bg-sun p-4 text-ink shadow-[4px_4px_0_var(--ink)] transition hover:-translate-y-0.5"
        >
          <p className="font-heading text-xl font-extrabold">
            🛍️ {openOrders.length} {openOrders.length === 1 ? "reward" : "rewards"} to make happen
          </p>
          <ul className="mt-1 text-sm font-semibold">
            {openOrders.slice(0, 3).map((o) => (
              <li key={o.id}>
                {o.who} {o.status === "WAITING_OK" ? "wants" : "bought"} {o.emoji ?? "🎁"} {o.title}
                {o.status === "WAITING_OK" && " · needs your OK"}
              </li>
            ))}
          </ul>
        </Link>
      )}

      <div className="mt-6 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Outlook is the slowest thing on Home (a network hop per call), so the rest of the
            page shows first and the calendar fills in. */}
        {outlookCard && (
          <Suspense
            fallback={
              <Card title="This week's calendar" kicker="calendar" index={index("calendar")}>
                <EmptyNote>Checking the calendar…</EmptyNote>
              </Card>
            }
          >
            <CalendarCard load={outlookLoad!} index={index("calendar")} />
          </Suspense>
        )}

        {on("school") && (
          <Card title="School this week" kicker="school" index={index("school")}>
            {schoolEvents.length > 0 && (
              <ul className="mb-2 space-y-1">
                {schoolEvents.slice(0, 3).map((e) => (
                  <li key={`${e.feedId}-${e.occurrenceKey}`} className="flex justify-between gap-2 px-1 text-sm text-muted-foreground">
                    <span className="truncate">📅 {e.title}</span>
                    <span className="shrink-0 text-xs">
                      {formatEventWhen(e, zone)}
                      {!e.allDay && <AwayTime at={e.startsAt} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {schoolDue.length === 0 ? (
              <EmptyNote>No homework or forms due. 🎒</EmptyNote>
            ) : (
              <ul className="space-y-1 sm:space-y-2">
                {schoolDue.slice(0, 6).map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <Link
                      href={item.href}
                      className="flex min-h-11 items-center justify-between gap-2 rounded-md px-1 py-1 text-sm sm:min-h-0 text-muted-foreground transition hover:translate-x-1 hover:text-foreground"
                    >
                      <span className="truncate">
                        {item.title}
                        {item.who && <span className="text-xs"> · {item.who}</span>}
                      </span>
                      <span className={`shrink-0 text-xs ${item.overdue ? "text-destructive" : ""}`}>
                        {item.dueDate ? formatMonthDay(item.dueDate.getMonth() + 1, item.dueDate.getDate()) : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card title="Upcoming dates" kicker="dates" index={index("dates")}>
          {upcomingDates.length === 0 ? (
            <EmptyNote>Nothing in the next 30 days. Add birthdays from a person&apos;s page.</EmptyNote>
          ) : (
            <ul className="space-y-1 sm:space-y-2">
              {upcomingDates.slice(0, DATES_SHOWN).map((row) => ({ ...row, age: turnsAge(row, row.next) })).map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/people/${d.person.id}`}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-md px-1 py-1 text-sm sm:min-h-0 text-muted-foreground transition hover:translate-x-1 hover:text-foreground"
                  >
                    <span>
                      {fullName(d.person)}
                      {d.label ? ` · ${d.label}` : ""}
                      {d.age && <span className="text-muted-foreground"> · {d.age}</span>}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatMonthDay(d.next.getMonth() + 1, d.next.getDate())} · {dateWhen(d.next)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {upcomingDates.length > DATES_SHOWN && (
            <Link href="/calendar?view=month" className="mt-1 inline-flex min-h-11 items-center text-xs font-bold text-muted-foreground underline hover:text-foreground sm:min-h-0">
              See all on the calendar →
            </Link>
          )}
        </Card>

        <Card title="Haven't talked in a while" kicker="stale" index={index("stale")}>
          {stale.length === 0 ? (
            <EmptyNote>No one&apos;s overdue for a check-in right now.</EmptyNote>
          ) : (
            <ul className="space-y-1 sm:space-y-2">
              {stale.map((p) => (
                <li key={p.id} className="flex items-center gap-1">
                  <Link
                    href={`/people/${p.id}`}
                    className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md px-1 py-1 text-sm text-muted-foreground transition hover:translate-x-1 hover:text-foreground sm:min-h-0"
                  >
                    <span className="truncate text-foreground">{fullName(p)}</span>
                    <span className="truncate text-xs">
                      {p.lastContactedAt ? formatRelative(p.lastContactedAt) : `Added ${p.daysSinceContact}d ago, never logged`}
                    </span>
                  </Link>
                  {/* Caught up just now? One tap logs it and they drop off the list. */}
                  <form action={logQuickContact.bind(null, p.id, "CALL")}>
                    <SubmitButton aria-label={`Log a call with ${p.firstName}`} title="Just called" className={iconBtn}>
                      📞
                    </SubmitButton>
                  </form>
                  <form action={logQuickContact.bind(null, p.id, "TEXT")}>
                    <SubmitButton aria-label={`Log a text with ${p.firstName}`} title="Just texted" className={iconBtn}>
                      💬
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {on("cars") && (
          <Card title="Vehicle maintenance" kicker="cars" index={index("cars")}>
            {overdueMaintenance.length === 0 ? (
              <EmptyNote>Nothing overdue.</EmptyNote>
            ) : (
              <ul className="space-y-1 sm:space-y-2">
                {overdueMaintenance.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      href={`/vehicles/${entry.vehicleId}`}
                      className="flex min-h-11 items-center justify-between gap-2 rounded-md px-1 py-1 text-sm sm:min-h-0 text-muted-foreground transition hover:translate-x-1 hover:text-foreground"
                    >
                      <span className="truncate">{entry.title}</span>
                      <span className="shrink-0 text-destructive">{entry.vehicleName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card title="Recent activity" kicker="activity" index={index("activity")}>
          {activity.length === 0 ? (
            <EmptyNote>Nothing logged yet.</EmptyNote>
          ) : (
            <ul className="space-y-1 sm:space-y-2">
              {activity.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={entry.href}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-md px-1 py-1 text-sm sm:min-h-0 text-muted-foreground transition hover:translate-x-1 hover:text-foreground"
                  >
                    <span className="truncate">{entry.text}</span>
                    <span className="shrink-0 text-muted-foreground">{formatDateTime(entry.timestamp)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

async function CalendarCard({ load, index }: { load: Promise<ThisWeekResult>; index: number }) {
  const result = await load;
  if (!result.ok) {
    return (
      <Card title="This week's calendar" kicker="calendar" index={index}>
        <EmptyNote>{result.error}</EmptyNote>
      </Card>
    );
  }

  return (
    <Card title="This week's calendar" kicker="calendar" index={index}>
      {result.events.length === 0 ? (
        <EmptyNote>Nothing on the calendar this week.</EmptyNote>
      ) : (
        <ul className="space-y-2">
          {result.events.map((e) => (
            <li key={e.id} className="flex justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-foreground">{e.subject}</span>
              <span className="shrink-0 text-muted-foreground">
                {formatEventTime(e)}
                {!e.isAllDay && <AwayTime at={e.start} />}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/calendar" className="mt-1 inline-flex min-h-11 items-center text-xs font-bold text-muted-foreground underline hover:text-foreground sm:min-h-0">
        The whole family week →
      </Link>
    </Card>
  );
}

function formatEventTime(e: CalendarEvent): string {
  // An all-day event comes back as UTC midnight of its day; read in the server's zone (west of
  // UTC here) that's the evening before, so it showed a day early.
  const dayLabel = e.start.toLocaleDateString(undefined, { weekday: "short", ...(e.isAllDay ? { timeZone: "UTC" } : {}) });
  if (e.isAllDay) return `${dayLabel} · All day`;
  const time = e.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dayLabel} · ${time}`;
}

/** How many of today's chores or doses Home lists before "see all". */
const HOME_TASKS = 6;

/**
 * Overdue first, then today's, as the same cards the boards use, so a chore or dose can be
 * ticked off right here instead of only linking away.
 */
function HomeTasks({
  board,
  href,
  noun,
  viewerId,
  viewerIsAdult,
  onComplete,
  onUndo,
  timed = false,
  claimable = false,
}: {
  board: Awaited<ReturnType<typeof getBoardInstances>>;
  href: string;
  noun: string;
  viewerId: string;
  viewerIsAdult: boolean;
  onComplete: (id: string) => Promise<void | { milestone?: number | null }>;
  onUndo: (id: string) => Promise<void>;
  timed?: boolean;
  claimable?: boolean;
}) {
  const overdueIds = new Set(board.overdue.map((i) => i.id));
  const all = [...board.overdue, ...board.dueToday.filter((i) => i.status === "PENDING")];
  const finished = board.dueToday.filter((i) => i.status === "DONE");
  if (all.length === 0 && finished.length === 0) return <EmptyNote>Nothing due today.</EmptyNote>;
  const shown = all.slice(0, HOME_TASKS);
  const card = (i: (typeof all)[number], idx: number) => (
    <TaskInstanceCard
      key={i.id}
      instance={toCardInstance(i)}
      viewerId={viewerId}
      viewerIsAdult={viewerIsAdult}
      onComplete={onComplete}
      onUndo={onUndo}
      showDate={overdueIds.has(i.id)}
      timeLabel={timed ? formatTimeOfDay(i.dueDate) : null}
      completeLabel={timed ? "Taken" : "Done"}
      claimable={claimable}
      index={idx}
    />
  );
  return (
    <>
      {shown.length > 0 ? <ul className="space-y-2">{shown.map(card)}</ul> : <EmptyNote>All done for today.</EmptyNote>}
      {finished.length > 0 && (
        <details className="group mt-1">
          <summary className="flex min-h-11 cursor-pointer items-center gap-1 text-xs font-bold text-muted-foreground">
            <ChevronRight size={14} aria-hidden className="transition-transform group-open:rotate-90" />✓ {finished.length} done
          </summary>
          <ul className="space-y-2">{finished.map(card)}</ul>
        </details>
      )}
      <Link href={href} className="mt-1 inline-flex min-h-11 items-center text-xs font-bold text-muted-foreground underline hover:text-foreground sm:min-h-0">
        {all.length > shown.length ? `${all.length - shown.length} more ${noun} — see all` : `All ${noun} →`}
        {board.overdue.length > 0 && <span className="ml-1 text-destructive">({board.overdue.length} overdue)</span>}
      </Link>
    </>
  );
}

// Phase 19: cards sit straight (the old corkboard tilt was hard on the eyes); only stickers
// tilt now. The staggered pop-in stays so the page still visibly arrives.
function Card({
  title,
  kicker,
  index,
  className = "",
  children,
}: {
  title: string;
  kicker: VoiceKicker;
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ animationDelay: `${index * 90}ms` }}
      className={`ui-card ${className} animate-in fade-in zoom-in-90 slide-in-from-bottom-4 fill-mode-backwards duration-500 rounded-2xl bg-card p-4 shadow-[3px_3px_0_rgb(31_41_51/0.12)] ring-1 ring-border transition hover:-translate-y-0.5`}
    >
      <h2 className="text-lg font-bold leading-tight text-foreground">{title}</h2>
      <LookKicker id={kicker} />
      <div className="mt-2">{children}</div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** Phase 64a: the Upcoming dates card shows this many. */
const DATES_SHOWN = 6;

/** Today's events above the cards: all-day first, then by time, at most 8. Nothing today: nothing. */
function TodayStrip({ items, memberIds, colors }: { items: AgendaItem[]; memberIds: ReadonlySet<string>; colors: Record<string, string> }) {
  const { shown, more } = todayStrip(items);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="happening-today" className="ui-card mt-6 rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
      <h2 id="happening-today" className="font-heading text-lg font-extrabold">
        Happening today
      </h2>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {shown.map((item) => {
          const text = (
            <>
              <span aria-hidden>{item.emoji} </span>
              {item.minutes != null && <span className="font-bold">{timeLabel(item.minutes)} </span>}
              {item.title}
              {item.who && <span className="text-muted-foreground"> · {item.who}</span>}
            </>
          );
          // Each person's colour, as on the calendar (itemPerson: theirs, not a car's or a contact's).
          const person = itemPerson(item, memberIds);
          return (
            <li
              key={item.key}
              className={`border-l-4 pl-2 ${item.status === "open" ? "" : "text-muted-foreground line-through"} ${person ? "" : "border-transparent"}`}
              style={person ? { borderLeftColor: colors[person] } : undefined}
            >
              {item.href && !item.external ? (
                <Link href={item.href} className="inline-flex min-h-11 items-center hover:underline sm:min-h-0">
                  {text}
                </Link>
              ) : item.href ? (
                <a href={item.href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center hover:underline sm:min-h-0">
                  {text}
                </a>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <Link href="/calendar" className="mt-1 inline-flex min-h-11 items-center text-xs font-bold text-muted-foreground underline hover:text-foreground sm:min-h-0">
          and {more} more on the calendar →
        </Link>
      )}
    </section>
  );
}

async function TodayStripWithOutlook({
  items,
  load,
  today,
  zone,
  memberIds,
  colors,
}: {
  items: AgendaItem[];
  load: Promise<ThisWeekResult>;
  today: Date;
  zone: string;
  memberIds: ReadonlySet<string>;
  colors: Record<string, string>;
}) {
  const result = await load;
  return <TodayStrip items={result.ok ? [...items, ...outlookItems(result.events, today, zone, 1)] : items} memberIds={memberIds} colors={colors} />;
}

