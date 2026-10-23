import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin, isAdult } from "@/lib/authz";
import { getHouseholdMembers, fullName } from "@/lib/people";
import { getHouseholdSettings } from "@/lib/household-settings";
import { addDays } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { getBoardInstances, getPointsTally } from "@/lib/tasks/queries";
import { getDailyForecast, type ForecastPeriod } from "@/lib/weather";
import { weatherFlagFor } from "@/lib/chores/weather-flag";
import { TaskInstanceCard } from "@/components/tasks/task-instance-card";
import { toCardInstance } from "@/lib/tasks/card";
import { MilestoneToastBoard } from "@/components/tasks/milestone-toast";
import { PointsPill, PointsPills } from "@/components/tasks/points-pill";
import { PageHeader } from "@/components/page-header";
import { btn, btnPrimary, chip, chipRow, sectionTitle } from "@/components/styles";
import { completeInstance, uncompleteInstance, reassignInstance, skipInstance, unskipInstance, markOlderMissed } from "./actions";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { resolveViewMode } from "@/lib/view-prefs";
import { requireAppOn } from "@/lib/app-guard";
import { appOn } from "@/lib/app-switches";
import { SubmitButton } from "@/components/submit";
import { HomeLocation } from "@/components/home-location";

export default async function ChoresPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; all?: string }>;
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
  const personFilter = params.person ?? (big && params.all !== "1" ? profile.id : undefined);
  const bigCards = big && personFilter === profile.id;
  const horizonDays = bigCards ? 3 : 14;
  const cardLook = bigCards ? ({ size: "big", completeLabel: "Done!" } as const) : {};

  const horizon = addDays(new Date(), 14);
  await ensureInstancesGenerated(profile.householdId, horizon, "CHORE");

  const [{ overdue, dueToday, upcoming, olderMissed }, tally, members, household] = await Promise.all([
    // Big cards look a few days ahead, not two weeks — it's a "my stuff now" list.
    // Big "my chores" includes "Anyone" ones they can grab.
    getBoardInstances(profile.householdId, { personId: personFilter, includeUnassigned: bigCards, domain: "CHORE", horizonDays }),
    getPointsTally(profile.householdId, { domain: "CHORE" }),
    getHouseholdMembers(profile.householdId),
    getHouseholdSettings(profile.householdId),
  ]);

  const allInstances = [...overdue, ...dueToday, ...upcoming];
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

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="🧹 Chores">
        {storeOn && (
          <Link href="/points" className={btn}>
            ⭐ Rewards
          </Link>
        )}
        <Link href="/print/chores" className={btn}>
          Print
        </Link>
        {viewerIsAdult && (
          <>
            <Link href="/data#chores" className={btn}>
              Export
            </Link>
            <Link href="/chores/manage" className={btn}>
              Manage
            </Link>
            <Link href="/chores/new" className={btnPrimary}>
              + New chore
            </Link>
          </>
        )}
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

      {tally.length > 0 && (
        <PointsPills>
          {tally.map(({ person, points }, i) => (
            <PointsPill
              key={person.id}
              person={{ id: person.id, firstName: person.firstName, hasPhoto: person.photoContentType !== null }}
              points={points}
              rank={i}
            />
          ))}
        </PointsPills>
      )}

      <div className={`mt-4 ${chipRow}`}>
        <FilterLink label="Everyone" active={!personFilter} href={big ? "/chores?all=1" : "/chores"} />
        {members.map((m) => (
          <FilterLink
            key={m.id}
            label={fullName(m)}
            active={personFilter === m.id}
            href={{ pathname: "/chores", query: { person: m.id } }}
          />
        ))}
      </div>

      <MilestoneToastBoard>
        <div className="mt-6 space-y-6">
          {nothingLeft && <BunsonMoment kind="cheer" text={MOMENT_LINES.choresDone} />}
          {overdue.length > 0 && (
            <Section title="Overdue" tone="text-destructive">
              {overdue.map((i, idx) => (
                <TaskInstanceCard
                  key={i.id}
                  instance={toCardInstance(i)}
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

          <Section title="Today">
            {dueToday.length === 0 ? (
              <li>
                <EmptyNote>Nothing due today.</EmptyNote>
              </li>
            ) : (
              dueToday.map((i, idx) => (
                <TaskInstanceCard
                  key={i.id}
                  instance={toCardInstance(i)}
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
                  showDate={false}
                  index={idx}
                  {...cardLook}
                />
              ))
            )}
          </Section>

          <Section title="Upcoming">
            {upcoming.length === 0 ? (
              <li>
                <EmptyNote>Nothing else in the next {horizonDays} days.</EmptyNote>
              </li>
            ) : (
              upcoming.map((i, idx) => (
                <TaskInstanceCard
                  key={i.id}
                  instance={toCardInstance(i)}
                  viewerId={profile.id}
                  viewerIsAdult={viewerIsAdult}
                  claimable
                  onComplete={completeInstance}
                  onUndo={uncompleteInstance}
                  onReassign={viewerIsAdult ? reassignInstance : undefined}
                  reassignCandidates={viewerIsAdult ? reassignCandidates : undefined}
                  weatherNote={weatherNoteFor(i)}
                  disappearsOnComplete
                  index={idx}
                  {...cardLook}
                />
              ))
            )}
          </Section>
        </div>
      </MilestoneToastBoard>
    </div>
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

function FilterLink({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string | { pathname: string; query: Record<string, string> };
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={chip}>
      {label}
    </Link>
  );
}
