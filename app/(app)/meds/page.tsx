import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getHouseholdMembers, fullName } from "@/lib/people";
import { formatTimeOfDay } from "@/lib/format";
import { addDays } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { getBoardInstances, getPointsTally } from "@/lib/tasks/queries";
import { TaskInstanceCard } from "@/components/tasks/task-instance-card";
import { toCardInstance } from "@/lib/tasks/card";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { PointsPill, PointsPills } from "@/components/tasks/points-pill";
import { PageHeader } from "@/components/page-header";
import { btn, btnPrimary, chip, chipRow, sectionTitle } from "@/components/styles";
import { completeInstance, uncompleteInstance, skipInstance, unskipInstance, markOlderMissed } from "./actions";
import { requireAppOn } from "@/lib/app-guard";
import { appOn } from "@/lib/app-switches";
import { SubmitButton } from "@/components/submit";

export default async function MedsPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  await requireAppOn("meds");
  const profile = await requireActiveProfile();
  // The Rewards button only while the Store is on (Settings → Apps).
  const storeOn = await appOn(profile.householdId, "store");
  const { person: personFilter } = await searchParams;
  const viewerIsAdult = isAdult(profile);

  const horizon = addDays(new Date(), 14);
  await ensureInstancesGenerated(profile.householdId, horizon, "MED");

  const [{ overdue, dueToday, upcoming, olderMissed }, tally, members] = await Promise.all([
    getBoardInstances(profile.householdId, { personId: personFilter, domain: "MED" }),
    getPointsTally(profile.householdId, { domain: "MED" }),
    getHouseholdMembers(profile.householdId),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="💊 Meds">
        {storeOn && (
          <Link href="/points" className={btn}>
            ⭐ Rewards
          </Link>
        )}
        {viewerIsAdult && (
          <>
            <Link href="/data#meds" className={btn}>
              Export
            </Link>
            {/* Adult-only, like the print page itself (stock + prescriber/pharmacy). */}
            <Link href="/print/meds" className={btn}>
              Print
            </Link>
            <Link href="/meds/manage" className={btn}>
              Manage
            </Link>
            <Link href="/meds/new" className={btnPrimary}>
              + New medication
            </Link>
          </>
        )}
      </PageHeader>

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
        <FilterLink label="Everyone" active={!personFilter} href="/meds" />
        {members.map((m) => (
          <FilterLink
            key={m.id}
            label={fullName(m)}
            active={personFilter === m.id}
            href={{ pathname: "/meds", query: { person: m.id } }}
          />
        ))}
      </div>

      <div className="mt-6 space-y-6">
        {/* Only once every dose today is taken — never beside an overdue or pending dose. */}
        {overdue.length === 0 && dueToday.length > 0 && dueToday.every((i) => i.status === "DONE") && (
          <BunsonMoment kind="cheer" text={MOMENT_LINES.medsDone} />
        )}
        {overdue.length > 0 && (
          <Section title="Overdue" tone="text-destructive">
            {overdue.map((i, idx) => (
              <TaskInstanceCard
                key={i.id}
                instance={toCardInstance(i)}
                viewerId={profile.id}
                viewerIsAdult={viewerIsAdult}
                onComplete={completeInstance}
                onUndo={uncompleteInstance}
                onSkip={viewerIsAdult ? skipInstance : undefined}
                onUnskip={viewerIsAdult ? unskipInstance : undefined}
                skipLabel="Missed"
                subtitle={i.definition.notes ?? undefined}
                timeLabel={formatTimeOfDay(i.dueDate)}
                disappearsOnComplete
                index={idx}
              />
            ))}
          </Section>
        )}

        {viewerIsAdult && olderMissed > 0 && (
          <form action={markOlderMissed.bind(null, personFilter ?? null)} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            <span className="mr-auto">
              {olderMissed} older {olderMissed === 1 ? "dose" : "doses"} from before last week {olderMissed === 1 ? "was" : "were"} never marked.
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
                onComplete={completeInstance}
                onUndo={uncompleteInstance}
                onSkip={viewerIsAdult ? skipInstance : undefined}
                onUnskip={viewerIsAdult ? unskipInstance : undefined}
                subtitle={i.definition.notes ?? undefined}
                showDate={false}
                timeLabel={formatTimeOfDay(i.dueDate)}
                index={idx}
              />
            ))
          )}
        </Section>

        <Section title="Upcoming">
          {upcoming.length === 0 ? (
            <li>
              <EmptyNote>Nothing else in the next 14 days.</EmptyNote>
            </li>
          ) : (
            upcoming.map((i, idx) => (
              <TaskInstanceCard
                key={i.id}
                instance={toCardInstance(i)}
                viewerId={profile.id}
                viewerIsAdult={viewerIsAdult}
                onComplete={completeInstance}
                onUndo={uncompleteInstance}
                subtitle={i.definition.notes ?? undefined}
                timeLabel={formatTimeOfDay(i.dueDate)}
                disappearsOnComplete
                index={idx}
              />
            ))
          )}
        </Section>
      </div>
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
