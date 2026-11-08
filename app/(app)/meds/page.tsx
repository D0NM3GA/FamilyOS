import { LookQuiet } from "@/components/look-voice";
import { medicationDaysLeft } from "@/lib/reminders/stock";
import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getHouseholdMembers } from "@/lib/people";
import { formatMonthDay, formatTimeOfDay } from "@/lib/format";
import { addDays } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { getBoardInstances, getPointsTally } from "@/lib/tasks/queries";
import { PageMore } from "@/components/more-menu";
import { UpcomingFold } from "@/components/tasks/upcoming-fold";
import { TaskInstanceCard } from "@/components/tasks/task-instance-card";
import { toCardInstance } from "@/lib/tasks/card";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { PersonFilterRow } from "@/components/tasks/person-filter-row";
import { PageHeader } from "@/components/page-header";
import { btn, btnPrimary, sectionTitle } from "@/components/styles";
import { completeInstance, uncompleteInstance, skipInstance, unskipInstance, markOlderMissed, takeAsNeeded, undoAsNeeded } from "./actions";
import { getAsNeeded } from "@/lib/meds/as-needed-queries";
import { AsNeededRow } from "@/components/meds/as-needed-row";
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
  const viewerIsAdult = isAdult(profile);
  // Phase 66a: a kid sees only their own medicines, whatever the link says (the family guide's
  // rule, and the one dose history keeps). Doses for nobody in particular stay with the
  // grown-ups too: a kid can't take them (assertOwnRecord).
  const personFilter = viewerIsAdult ? (await searchParams).person : profile.id;

  const horizon = addDays(new Date(), 14);
  await ensureInstancesGenerated(profile.householdId, horizon, "MED");

  const [{ overdue, dueToday, upcoming, olderMissed }, tally, members, asNeeded] = await Promise.all([
    getBoardInstances(profile.householdId, { personId: personFilter, domain: "MED" }),
    getPointsTally(profile.householdId, { domain: "MED" }),
    getHouseholdMembers(profile.householdId),
    getAsNeeded(profile.householdId, { personId: personFilter }),
  ]);
  // Phase 62c: grown-ups see about how long each medicine's stock lasts (Manage shows the count).
  const daysLeft = viewerIsAdult ? await medicationDaysLeft(profile.householdId) : new Map<string, string | null>();
  // Phase 68a: a course says its last day.
  const lastDay = (d: { endDate?: Date | null }) => (d.endDate ? `Last day ${formatMonthDay(d.endDate.getMonth() + 1, d.endDate.getDate())}` : null);
  const subtitleOf = (d: { id: string; notes: string | null; endDate?: Date | null }) => [d.notes, lastDay(d), daysLeft.get(d.id)].filter(Boolean).join(" · ") || undefined;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="💊 Meds">
        {viewerIsAdult && (
          <Link href="/meds/new" className={btnPrimary}>
            + New medication
          </Link>
        )}
        {storeOn && (
          <Link href="/points" className={btn}>
            ⭐ Rewards
          </Link>
        )}
        {viewerIsAdult && (
          <>
            <Link href="/meds/manage" className={btn}>
              Manage
            </Link>
            {/* Print is adult-only, like the print page itself (stock + prescriber/pharmacy). */}
            <PageMore
              items={[
                { label: "Print", href: "/print/meds" },
                { label: "Export", href: "/data#meds" },
              ]}
            />
          </>
        )}
      </PageHeader>

      {viewerIsAdult && (
        <PersonFilterRow
          members={members}
          tally={tally}
          path="/meds"
          everyoneHref="/meds"
          selected={personFilter}
        />
      )}

      <div className="mt-6 space-y-6">
        {/* Only once every dose today is taken — never beside an overdue or pending dose. */}
        {overdue.length === 0 && dueToday.length > 0 && dueToday.every((i) => i.status === "DONE") && (
          <BunsonMoment kind="cheer" text={MOMENT_LINES.medsDone} />
        )}
        {overdue.length > 0 && (
          <Section title="Overdue" tone="text-destructive">
            {overdue.map((i, idx) => (
              <TaskInstanceCard
                completeLabel="Taken"
                key={i.id}
                instance={toCardInstance(i)}
                viewerId={profile.id}
                viewerIsAdult={viewerIsAdult}
                onComplete={completeInstance}
                onUndo={uncompleteInstance}
                onSkip={viewerIsAdult ? skipInstance : undefined}
                onUnskip={viewerIsAdult ? unskipInstance : undefined}
                skipLabel="Missed"
                subtitle={subtitleOf(i.definition)}
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
              <EmptyNote>Nothing due today.<LookQuiet /></EmptyNote>
            </li>
          ) : (
            dueToday.map((i, idx) => (
              <TaskInstanceCard
                completeLabel="Taken"
                key={i.id}
                instance={toCardInstance(i)}
                viewerId={profile.id}
                viewerIsAdult={viewerIsAdult}
                onComplete={completeInstance}
                onUndo={uncompleteInstance}
                onSkip={viewerIsAdult ? skipInstance : undefined}
                onUnskip={viewerIsAdult ? unskipInstance : undefined}
                subtitle={subtitleOf(i.definition)}
                showDate={false}
                timeLabel={formatTimeOfDay(i.dueDate)}
                index={idx}
              />
            ))
          )}
        </Section>

        {asNeeded.length > 0 && (
          <Section title="As needed">
            {asNeeded.map((m) => (
              <AsNeededRow key={m.definitionId} med={m} viewerId={profile.id} viewerIsAdult={viewerIsAdult} take={takeAsNeeded} undo={undoAsNeeded} />
            ))}
          </Section>
        )}

        {upcoming.length === 0 ? (
          <Section title="Upcoming">
            <li>
              <EmptyNote>Nothing else in the next 14 days.</EmptyNote>
            </li>
          </Section>
        ) : (
          <UpcomingFold days={14} count={upcoming.length}>
            {upcoming.map((i, idx) => (
              <TaskInstanceCard
                completeLabel="Taken"
                key={i.id}
                instance={toCardInstance(i)}
                viewerId={profile.id}
                viewerIsAdult={viewerIsAdult}
                onComplete={completeInstance}
                onUndo={uncompleteInstance}
                subtitle={subtitleOf(i.definition)}
                timeLabel={formatTimeOfDay(i.dueDate)}
                disappearsOnComplete
                quietDone
                notYet
                index={idx}
              />
            ))}
          </UpcomingFold>
        )}
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

