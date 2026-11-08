import { LookQuiet } from "@/components/look-voice";
import { RefreshOnReturn } from "@/components/refresh-on-return";
import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin, isAdult } from "@/lib/authz";
import { getHouseholdMembers } from "@/lib/people";
import { getHouseholdSettings } from "@/lib/household-settings";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { getBoardInstances, getPointsTally } from "@/lib/tasks/queries";
import { getDailyForecast, type ForecastPeriod } from "@/lib/weather";
import { weatherFlagFor } from "@/lib/chores/weather-flag";
import { TaskInstanceCard } from "@/components/tasks/task-instance-card";
import { toCardInstance } from "@/lib/tasks/card";
import { choreItem } from "@/lib/work-items/chore";
import { moveChoices, takenDays } from "@/lib/tasks/move";
import { MilestoneToastBoard } from "@/components/tasks/milestone-toast";
import { PersonFilterRow } from "@/components/tasks/person-filter-row";
import { PageHeader } from "@/components/page-header";
import { PageMore } from "@/components/more-menu";
import { UpcomingFold } from "@/components/tasks/upcoming-fold";
import { btn, btnPrimary, sectionTitle } from "@/components/styles";
import { completeInstance, uncompleteInstance, reassignInstance, skipInstance, unskipInstance, markOlderMissed, moveInstance, bulkChores } from "./actions";
import { SelectionProvider, SelectToggle } from "@/components/selection";
import { ChoresBulkBar, ChorePresets } from "./bulk";
import { presetIds } from "@/lib/tasks/presets";
import { parseItemRef, itemParam } from "@/lib/work-items/history";
import { ItemPanel } from "../item-panel";
import { BoardView, ItemListRow } from "../item-panel-parts";
import { formatRelative } from "@/lib/format";
import { chip, chipRow } from "@/components/styles";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { resolveViewMode } from "@/lib/view-prefs";
import { requireAppOn } from "@/lib/app-guard";
import { appOn } from "@/lib/app-switches";
import { SubmitButton } from "@/components/submit";
import { HomeLocation } from "@/components/home-location";
import { waitingForCheck } from "@/lib/chores/checks";
import { openSwaps, openSwapsForGrownUps, swappedFrom } from "@/lib/chores/swaps";
import { GrownUpSwaps, KidSwaps, WaitingForCheck } from "./checks-and-swaps";

export default async function ChoresPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; all?: string; show?: string; item?: string; swap?: string; check?: string }>;
}) {
  await requireAppOn("chores");
  const profile = await requireActiveProfile();
  // The Rewards button only while the Store is on (Settings → Apps).
  const storeOn = await appOn(profile.householdId, "store");
  const params = await searchParams;
  const viewerIsAdult = isAdult(profile);
  // Phase 19.5: in Big buttons, Chores opens on "my chores" (big cards); "Everyone"
  // (?all=1) shows the whole board for that visit without changing the setting.
  const big = resolveViewMode(profile.viewMode, viewerIsAdult) === "BIG";
  // Phase 59.4a: "anyone" is the list's Anyone's chip (only unassigned chores), not a person.
  const anyone = !big && params.person === "anyone";
  // A bookmarked ?person=anyone in Big buttons is simply no person.
  const rawPerson = params.person === "anyone" ? undefined : params.person;
  const personFilter = anyone ? undefined : (rawPerson ?? (big && params.all !== "1" ? profile.id : undefined));
  const show = !big && (params.show === "overdue" || params.show === "today") ? params.show : null;
  const itemRef = big ? null : parseItemRef(params.item);
  const bigCards = big && personFilter === profile.id;
  const horizonDays = bigCards ? 3 : 14;
  const cardLook = bigCards ? ({ size: "big", completeLabel: "Done!" } as const) : {};

  const horizon = addDays(new Date(), 14);
  await ensureInstancesGenerated(profile.householdId, horizon, "CHORE");

  const [{ overdue, dueToday, upcoming, olderMissed, today }, tally, members, household] = await Promise.all([
    // Big cards look a few days ahead, not two weeks — it's a "my stuff now" list.
    // Big "my chores" includes "Anyone" ones they can grab.
    getBoardInstances(profile.householdId, { personId: personFilter, includeUnassigned: bigCards, unassignedOnly: anyone, domain: "CHORE", horizonDays }),
    getPointsTally(profile.householdId, { domain: "CHORE" }),
    getHouseholdMembers(profile.householdId),
    getHouseholdSettings(profile.householdId),
  ]);

  const allInstances = [...overdue, ...dueToday, ...upcoming];
  // Phase 70c: grown-ups' checks waiting, a kid's swaps, and which chores a swap moved.
  const [waiting, swaps, fromSwap, askedSwaps] = await Promise.all([
    viewerIsAdult ? waitingForCheck(profile.householdId) : Promise.resolve([]),
    profile.role === "KID" ? openSwaps(profile, atMidnight(new Date())) : Promise.resolve(null),
    viewerIsAdult ? swappedFrom(profile.householdId, allInstances.map((i) => i.id)) : Promise.resolve(new Map<string, string>()),
    viewerIsAdult ? openSwapsForGrownUps(profile.householdId, atMidnight(new Date())) : Promise.resolve([]),
  ]);
  const swapNotice = params.swap === "asked" || params.swap === "lapsed" || params.swap === "gone" || params.swap === "taken" || params.swap === "declined" ? params.swap : null;
  const checkNotice = params.check === "ok" || params.check === "again" ? params.check : null;
  const swapNote = (id: string) => (fromSwap.has(id) ? `swapped from ${fromSwap.get(id)}` : null);
  const hasWeatherSensitiveChore = allInstances.some((i) => i.definition.weatherSensitive);
  const forecast: ForecastPeriod[] | null = hasWeatherSensitiveChore
    ? await getDailyForecast(household.latitude, household.longitude)
    : null;

  function weatherNoteFor(i: (typeof allInstances)[number]): string | null {
    if (!i.definition.weatherSensitive) return null;
    return weatherFlagFor(i.dueDate, forecast);
  }

  // Only a real "all done": an empty day gets the plain "Nothing due today." note instead.
  const nothingLeft =
    overdue.length === 0 && dueToday.length > 0 && dueToday.every((i) => i.status !== "PENDING");

  const reassignCandidates = members.map((m) => ({ id: m.id, firstName: m.firstName }));
  // Phase 59.1a: each card's status pill, worked out here so the browser never decides a day.
  // Big buttons keeps its cards as they were.
  // The board's own today, so a pill and its section can't disagree across midnight.
  const pillFor = (i: (typeof allInstances)[number], skippable: boolean) =>
    big ? undefined : choreItem(toCardInstance(i), profile, { skippable: skippable && viewerIsAdult, now: today });
  // Phase 59.2b: grown-ups move a chore to tomorrow (or an overdue one to today) where that day is free.
  const backDays = allInstances.flatMap((i) => (i.movedFrom ? [i.movedFrom] : []));
  const taken = viewerIsAdult && !big ? await takenDays([...new Set(allInstances.map((i) => i.definitionId))], today, backDays) : new Set<string>();
  const movesFor = (i: (typeof allInstances)[number]) =>
    viewerIsAdult && !big ? moveChoices({ ...i, frequencyType: i.definition.frequencyType }, taken, today) : undefined;
  const move = viewerIsAdult && !big ? moveInstance : undefined;
  // Phase 59.3: grown-ups pick several and act once, and get two presets for the filtered person.
  const selecting = viewerIsAdult && !big;
  const filtered = personFilter ? members.find((m) => m.id === personFilter) : undefined;
  const { sickDayIds, handOffIds } = personFilter ? presetIds({ dueToday, upcoming }, personFilter, today) : { sickDayIds: [], handOffIds: [] };

  // Phase 59.4a: links keep the board's own params (person, all, show) and add or drop one.
  const here = (change: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ person: params.person ?? null, all: params.all ?? null, show, item: null, ...change })) if (v) q.set(k, v);
    const qs = q.toString();
    return qs ? `/chores?${qs}` : "/chores";
  };
  const zone = household.timezone ?? undefined;
  const listRow = (i: (typeof allInstances)[number], skippable: boolean) => (
    <ItemListRow
      key={i.id}
      item={choreItem(toCardInstance(i), profile, { skippable: skippable && viewerIsAdult, now: today })}
      refParam={itemParam("CHORE", i.id)}
      href={here({ item: itemParam("CHORE", i.id) })}
      who={i.assignedTo?.firstName ?? null}
      when={formatRelative(i.dueDate, zone)}
      extra={i.definition.points ? `${i.definition.points} ⭐` : null}
      late={i.dueDate < today && i.status === "PENDING"}
      selectable={selecting}
    />
  );
  const showOverdue = show !== "today";
  const showToday = show !== "overdue";
  const showUpcoming = show === null;

  const boardCards = (
    <div className="mt-6 space-y-6">
      {nothingLeft && <BunsonMoment kind="cheer" text={MOMENT_LINES.choresDone} />}
      {show === "overdue" && overdue.length === 0 && <EmptyNote>Nothing overdue.</EmptyNote>}
      {showOverdue && overdue.length > 0 && (
        <Section title="Overdue" tone="text-destructive">
          {overdue.map((i, idx) => (
            <TaskInstanceCard
              key={i.id}
              instance={toCardInstance(i)}
              subtitle={swapNote(i.id)}
              viewerId={profile.id}
              viewerIsAdult={viewerIsAdult}
              claimable
              onComplete={completeInstance}
              onUndo={uncompleteInstance}
              onReassign={viewerIsAdult ? reassignInstance : undefined}
              onSkip={viewerIsAdult ? skipInstance : undefined}
              onUnskip={viewerIsAdult ? unskipInstance : undefined}
              skipLabel="Missed"
              reassignCandidates={viewerIsAdult ? reassignCandidates : undefined}
              weatherNote={weatherNoteFor(i)}
              pill={pillFor(i, true)}
              moves={movesFor(i)}
              onMove={move}
              selectable={selecting}
              disappearsOnComplete
              index={idx}
              {...cardLook}
            />
          ))}
        </Section>
      )}

      {viewerIsAdult && olderMissed > 0 && (
        <form action={markOlderMissed.bind(null, personFilter ?? null)} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          <span className="mr-auto">
            {olderMissed} older {olderMissed === 1 ? "chore" : "chores"} from before last week {olderMissed === 1 ? "was" : "were"} never marked.
          </span>
          <SubmitButton className={btn}>
            Mark {olderMissed === 1 ? "it" : "them"} missed
          </SubmitButton>
        </form>
      )}

      {showToday && (
        <Section title="Today">
          {dueToday.length === 0 ? (
            <li>
              <EmptyNote>Nothing due today.<LookQuiet /></EmptyNote>
            </li>
          ) : (
            dueToday.map((i, idx) => (
              <TaskInstanceCard
                key={i.id}
                instance={toCardInstance(i)}
                subtitle={swapNote(i.id)}
                viewerId={profile.id}
                viewerIsAdult={viewerIsAdult}
                claimable
                onComplete={completeInstance}
                onUndo={uncompleteInstance}
                onReassign={viewerIsAdult ? reassignInstance : undefined}
                onSkip={viewerIsAdult ? skipInstance : undefined}
                onUnskip={viewerIsAdult ? unskipInstance : undefined}
                reassignCandidates={viewerIsAdult ? reassignCandidates : undefined}
                weatherNote={weatherNoteFor(i)}
                pill={pillFor(i, true)}
                moves={movesFor(i)}
                onMove={move}
                selectable={selecting}
                showDate={false}
                index={idx}
                {...cardLook}
              />
            ))
          )}
        </Section>
      )}

      {showUpcoming && (upcoming.length === 0 ? (
        <Section title="Upcoming">
          <li>
            <EmptyNote>Nothing else in the next {horizonDays} days.</EmptyNote>
          </li>
        </Section>
      ) : (
        <UpcomingFold days={horizonDays} count={upcoming.length} open={bigCards}>
          {upcoming.map((i, idx) => (
            <TaskInstanceCard
              key={i.id}
              instance={toCardInstance(i)}
              subtitle={swapNote(i.id)}
              viewerId={profile.id}
              viewerIsAdult={viewerIsAdult}
              claimable
              onComplete={completeInstance}
              onUndo={uncompleteInstance}
              onReassign={viewerIsAdult ? reassignInstance : undefined}
              reassignCandidates={viewerIsAdult ? reassignCandidates : undefined}
              weatherNote={weatherNoteFor(i)}
              pill={pillFor(i, false)}
              moves={movesFor(i)}
              onMove={move}
              selectable={selecting}
              disappearsOnComplete
              quietDone
              index={idx}
              {...cardLook}
            />
          ))}
        </UpcomingFold>
      ))}
    </div>
  );
  // Phase 59.4a: the same chores, one line each, with the pill to change them and the title to open
  // the side panel.
  const boardList = (
    <div className="mt-6 space-y-6">
      {show === "overdue" && overdue.length === 0 && <EmptyNote>Nothing overdue.</EmptyNote>}
      {showOverdue && overdue.length > 0 && (
        <div>
          <h2 className={`${sectionTitle} text-destructive`}>Overdue</h2>
          <ul className="mt-2 divide-y divide-border">{overdue.map((i) => listRow(i, true))}</ul>
        </div>
      )}
      {showToday && (
        <div>
          <h2 className={sectionTitle}>Today</h2>
          {dueToday.length === 0 ? <EmptyNote>Nothing due today.</EmptyNote> : <ul className="mt-2 divide-y divide-border">{dueToday.map((i) => listRow(i, true))}</ul>}
        </div>
      )}
      {showUpcoming && (
        <div>
          <h2 className={sectionTitle}>Next {horizonDays} days</h2>
          {upcoming.length === 0 ? (
            <EmptyNote>Nothing else in the next {horizonDays} days.</EmptyNote>
          ) : (
            <ul className="mt-2 divide-y divide-border">{upcoming.map((i) => listRow(i, false))}</ul>
          )}
        </div>
      )}
    </div>
  );

  return (
    // A new person on the filter is a new selection (the key resets it).
    <SelectionProvider key={`${anyone ? "anyone" : (personFilter ?? "everyone")}:${show ?? "all"}`}>
      <div className="p-4 sm:p-6">
        <RefreshOnReturn />
        <PageHeader title="🧹 Chores">
          {selecting && <SelectToggle />}
          {viewerIsAdult && (
            <Link href="/chores/new" className={btnPrimary}>
              + New chore
            </Link>
          )}
          {storeOn && (
            <Link href="/points" className={btn}>
              ⭐ Rewards
            </Link>
          )}
          {viewerIsAdult && (
            <Link href="/chores/manage" className={btn}>
              Manage
            </Link>
          )}
          <PageMore
            items={[
              { label: "Print", href: "/print/chores" },
              ...(viewerIsAdult ? [{ label: "Export", href: "/data#chores" }] : []),
            ]}
          />
        </PageHeader>

        {/* Phase 45.1: an admin sets home right here, from this device or a ZIP code. */}
        {viewerIsAdult && hasWeatherSensitiveChore && household.latitude == null && (
          <div className="mt-4 space-y-2 rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
            {isAdmin(profile) ? (
              <>
                <p>Outdoor chores can warn about rain once the app knows roughly where home is.</p>
                <HomeLocation nearZip={null} />
              </>
            ) : (
              <p>Outdoor chores can warn about rain once an admin sets where home is, in Settings → Household.</p>
            )}
          </div>
        )}

        <PersonFilterRow
          members={members}
          tally={tally}
          path="/chores"
          everyoneHref={big ? "/chores?all=1" : "/chores"}
          selected={anyone ? "anyone" : personFilter}
        />

        {/* Phase 59.4a: quick filters, kept in the address so a view can be bookmarked. */}
        {!big && (
          <nav aria-label="Show" className={`mt-3 ${chipRow}`}>
            <Link href={here({ show: null, person: null })} aria-current={!show && !params.person ? "page" : undefined} className={chip}>
              All
            </Link>
            <Link href={here({ show: "overdue" })} aria-current={show === "overdue" ? "page" : undefined} className={chip}>
              Overdue
            </Link>
            <Link href={here({ show: "today" })} aria-current={show === "today" ? "page" : undefined} className={chip}>
              Today
            </Link>
            <Link href={here({ person: profile.id })} aria-current={personFilter === profile.id ? "page" : undefined} className={chip}>
              Mine
            </Link>
            <Link href={here({ person: "anyone" })} aria-current={anyone ? "page" : undefined} className={chip}>
              Anyone&apos;s
            </Link>
          </nav>
        )}

        {selecting && filtered && (
          <ChorePresets
            bulk={bulkChores}
            person={filtered.firstName}
            sickDayIds={sickDayIds}
            handOffIds={handOffIds}
            others={reassignCandidates.filter((m) => m.id !== filtered.id)}
          />
        )}

        <WaitingForCheck rows={waiting} notice={checkNotice} zone={household.timezone ?? undefined} />
        <GrownUpSwaps swaps={askedSwaps} zone={household.timezone ?? undefined} />
        {swaps && <KidSwaps incoming={swaps.incoming} outgoing={swaps.outgoing} notice={swapNotice} zone={household.timezone ?? undefined} />}

        <MilestoneToastBoard>
          {big ? boardCards : <BoardView personId={profile.id} board="chores" cards={boardCards} list={boardList} />}
          {selecting && <ChoresBulkBar bulk={bulkChores} people={reassignCandidates} />}
        </MilestoneToastBoard>
        {itemRef && <ItemPanel itemRef={itemRef} closeHref={here({ item: null })} />}
      </div>
    </SelectionProvider>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className={`${sectionTitle} ${tone ?? ""}`}>{title}</h2>
      <ul className="mt-2 space-y-2">{children}</ul>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

