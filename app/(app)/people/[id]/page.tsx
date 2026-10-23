import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Mail, Phone, Pencil, RefreshCw } from "lucide-react";
import { requireActiveProfile, isSessionOwner } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import {
  getPersonWithDetails,
  getHouseholdMembers,
  getPersonRelationships,
  listPeople,
  fullName,
  nextOccurrence,
  dayInZone,
} from "@/lib/people";
import { getHouseholdSettings } from "@/lib/household-settings";
import { getDisabledApps } from "@/lib/app-switches";
import { isAppOn } from "@/lib/apps";
import { formatRelative, formatDateTime, formatMonthDay } from "@/lib/format";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { getBoardInstances, getPointsBalance, getPointsTally } from "@/lib/tasks/queries";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/avatar";
import { iconBtn, sectionTitle } from "@/components/styles";
import { searchRecentMail, type RecentMailResult } from "@/lib/graph/mail";
import { LogInteractionForm } from "./log-interaction-form";
import { InteractionList, type InteractionRow } from "./interaction-list";
import { ImportantDates } from "./important-dates";
import { RelationshipsCard } from "./relationships-card";
import { RecordTabs } from "./record-tabs";
import { syncFromMicrosoft } from "./actions";
import { getRewardWords } from "@/lib/household-settings";
import { rewardCount } from "@/lib/reward-words";
import { SubmitButton } from "@/components/submit";
import { microsoftLinkedUserIds, signInKindOf } from "@/lib/sign-in-kind";

export default async function PersonRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireActiveProfile();
  const { id } = await params;

  const viewerIsAdult = isAdult(profile);
  // Grown-ups-only calls never reach a kid's page: the query leaves them out.
  const person = await getPersonWithDetails(id, profile.householdId, { viewerIsAdult });
  if (!person) notFound();
  // A kid's "Last contacted" comes from the calls they can see, so it can't give a hidden one away.
  const lastContactedAt = viewerIsAdult ? person.lastContactedAt : (person.interactions[0]?.occurredAt ?? null);

  // Graph data (mail, and the "Sync from Microsoft" button below) only makes sense when
  // the active profile IS the signed-in adult, not a kid or a different PIN-switched adult
  // who'd otherwise see — or overwrite, via sync — the signed-in adult's own data.
  const owner = await isSessionOwner(profile);
  // Phase 40.1b: and only through a Microsoft sign-in (a passkey has no mailbox behind it).
  const microsoftUsers = await microsoftLinkedUserIds([profile.authUserId, person.authUserId]);
  const ownerOnMicrosoft = owner && signInKindOf(profile.authUserId, microsoftUsers) === "microsoft";
  const personOnMicrosoft = signInKindOf(person.authUserId, microsoftUsers) === "microsoft";
  const showMail = Boolean(person.email) && ownerOnMicrosoft;
  // Phase 36: a turned-off app's summary and links leave this page too, and its boards aren't
  // read or rolled forward (no writes for a paused app).
  const disabled = await getDisabledApps(profile.householdId);
  const on = (app: string) => isAppOn(disabled, app);
  const choresHere = person.isHouseholdMember && on("chores");
  const medsHere = person.isHouseholdMember && on("meds");

  // A short horizon — this card is a summary, not a second board (the full boards at
  // /chores and /meds already exist for that, and this page's own links point there).
  const taskHorizon = addDays(new Date(), 7);
  await Promise.all([
    choresHere ? ensureInstancesGenerated(profile.householdId, taskHorizon, "CHORE") : null,
    medsHere ? ensureInstancesGenerated(profile.householdId, taskHorizon, "MED") : null,
  ]);

  const [householdMembers, relationships, pickablePeople, choreBoard, medBoard, choreTally, medTally, around] =
    await Promise.all([
      getHouseholdMembers(profile.householdId, person.id),
      getPersonRelationships(person.id, profile.householdId),
      listPeople(profile.householdId).then((people) =>
        people
          .filter((p) => p.id !== person.id)
          .map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName })),
      ),
      choresHere ? getBoardInstances(profile.householdId, { personId: person.id, domain: "CHORE", horizonDays: 7 }) : null,
      medsHere ? getBoardInstances(profile.householdId, { personId: person.id, domain: "MED", horizonDays: 7 }) : null,
      choresHere ? getPointsTally(profile.householdId, { domain: "CHORE" }) : null,
      medsHere ? getPointsTally(profile.householdId, { domain: "MED" }) : null,
      // A wallet and a school tab are the person's own and the grown-ups' (the Store shows
      // kids only their own balance), so a kid looking at a sibling gets no card.
      person.isHouseholdMember && (viewerIsAdult || profile.id === person.id) ? aroundTheHouse(person.id, profile.householdId) : null,
    ]);

  const chorePoints = choreTally?.find((t) => t.person.id === person.id)?.points ?? 0;
  const medPoints = medTally?.find((t) => t.person.id === person.id)?.points ?? 0;

  const now = new Date();
  // The date boxes work in the family's days, not the server's (which may run in UTC).
  const zone = (await getHouseholdSettings(profile.householdId)).timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dayInZone(now, zone);
  const dates = person.importantDates
    .map((d) => ({ ...d, next: nextOccurrence(d, now) }))
    .sort((a, b) => a.next.getTime() - b.next.getTime())
    .map(({ next, ...d }) => {
      const days = Math.round((next.getTime() - atMidnight(now).getTime()) / 86_400_000);
      return {
        id: d.id,
        type: d.type,
        label: d.label,
        month: d.month,
        day: d.day,
        year: d.year,
        when: `${formatMonthDay(d.month, d.day)} · ${days === 0 ? "today!" : days === 1 ? "tomorrow" : `in ${days} days`}`,
      };
    });
  const interactions: InteractionRow[] = person.interactions.map((log) => ({
    id: log.id,
    type: log.type,
    note: log.note,
    when: formatDateTime(log.occurredAt),
    day: dayInZone(log.occurredAt, zone),
    loggedBy: log.loggedBy?.firstName ?? null,
    canEdit: viewerIsAdult || log.loggedById === profile.id,
    adultsOnly: log.adultsOnly,
  }));

  return (
    <div className="grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,280px)]">
      {/* Left column */}
      <div className="min-w-0 space-y-4">
        <div className="rounded-lg bg-card p-4 text-center shadow-sm ring-1 ring-border">
          <Avatar
            personId={person.id}
            hasPhoto={person.photoContentType !== null}
            initial={person.firstName}
            size={64}
            className="mx-auto text-xl"
          />
          <h1 className="mt-3 break-words text-lg font-semibold text-foreground">{fullName(person)}</h1>
          <p className="text-xs text-muted-foreground">
            {person.isHouseholdMember ? person.role ?? "Household" : "Contact"}
          </p>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <QuickAction
              href={person.email ? `mailto:${person.email}` : undefined}
              icon={Mail}
              label="Email"
            />
            <QuickAction
              href={person.phone ? `tel:${person.phone}` : undefined}
              icon={Phone}
              label="Call"
            />
            {viewerIsAdult && (
              <QuickAction href={`/people/${person.id}/edit`} icon={Pencil} label="Edit" />
            )}
            {person.id === profile.id && ownerOnMicrosoft && (
              <form action={syncFromMicrosoft.bind(null, person.id)}>
                <SubmitButton
                  title="Sync from Microsoft"
                  aria-label="Sync from Microsoft"
                  className={`${iconBtn} ring-1 ring-input`}
                >
                  <RefreshCw size={16} />
                </SubmitButton>
              </form>
            )}
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className={sectionTitle}>Key information</h2>
          <dl className="mt-2 space-y-2 text-sm">
            <InfoRow label="Email" value={person.email} />
            <InfoRow label="Phone" value={person.phone} />
            <InfoRow
              label="Household"
              value={person.isHouseholdMember ? `Yes · ${person.role ?? ""}` : "No"}
            />
            <InfoRow label="Last contacted" value={formatRelative(lastContactedAt)} />
            {personOnMicrosoft && (
              <InfoRow
                label="Synced from Microsoft"
                value={person.entraSyncedAt ? formatRelative(person.entraSyncedAt) : "Not yet"}
              />
            )}
            {person.notes && (viewerIsAdult || !person.notesAdultsOnly) && (
              <InfoRow label={person.notesAdultsOnly ? "Notes 🔒" : "Notes"} value={person.notes} />
            )}
          </dl>
        </div>
      </div>

      {/* Center column */}
      <div className="min-w-0 space-y-4">
        <LogInteractionForm personId={person.id} today={today} canHide={viewerIsAdult} />

        <RecordTabs
          catchUp={
            <>
              <Card title="Recent interactions">
                {interactions.length === 0 ? (
                  <EmptyNote>Nothing logged yet — use the box above.</EmptyNote>
                ) : (
                  <InteractionList personId={person.id} interactions={interactions.slice(0, 5)} today={today} canHide={viewerIsAdult} />
                )}
              </Card>

              {showMail && (
                // Outlook is two network hops away; the rest of the record shows first.
                <Suspense
                  fallback={
                    <Card title="Recent emails">
                      <EmptyNote>Checking the mailbox…</EmptyNote>
                    </Card>
                  }
                >
                  <RecentEmails email={person.email!} />
                </Suspense>
              )}
            </>
          }
          activities={
            interactions.length === 0 ? (
              <Card title="Activity">
                <EmptyNote>Nothing logged yet — use the box above.</EmptyNote>
              </Card>
            ) : (
              <Card title="Activity">
                <InteractionList personId={person.id} interactions={interactions} today={today} canHide={viewerIsAdult} />
              </Card>
            )
          }
        />
      </div>

      {/* Right column */}
      <div className="min-w-0 space-y-4">
        {(choreBoard || medBoard) && (
          <div className="min-w-0 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
            <h2 className={sectionTitle}>{choreBoard && medBoard ? "Chores & meds" : choreBoard ? "Chores" : "Meds"}</h2>
            {choreBoard && (
              <TaskSummary
                label="Chores"
                href={{ pathname: "/chores", query: { person: person.id } }}
                overdueCount={choreBoard.overdue.length}
                dueTodayCount={choreBoard.dueToday.filter((i) => i.status === "PENDING").length}
                upcomingCount={choreBoard.upcoming.length}
                points={chorePoints}
              />
            )}
            {medBoard && (
              <TaskSummary
                label="Meds"
                href={{ pathname: "/meds", query: { person: person.id } }}
                overdueCount={medBoard.overdue.length}
                dueTodayCount={medBoard.dueToday.filter((i) => i.status === "PENDING").length}
                upcomingCount={medBoard.upcoming.length}
                points={medPoints}
              />
            )}
          </div>
        )}

        {around && (on("store") || (on("groceries") && around.forThem > 0) || (on("school") && around.school)) && (
          <div className="min-w-0 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
            <h2 className={sectionTitle}>Around the house</h2>
            <ul className="mt-1 text-sm">
              {on("store") && (
                <AroundLink href="/points" emoji="⭐" text={`${rewardCount(around.stickers, around.words)} to spend`} />
              )}
              {on("groceries") && around.forThem > 0 && (
                <AroundLink href="/groceries" emoji="🛒" text={`${around.forThem} on the grocery list for ${person.firstName}`} />
              )}
              {on("school") && around.school && (
                <AroundLink href={`/school?kid=${person.id}`} emoji="🎒" text={around.school} />
              )}
            </ul>
          </div>
        )}

        {/* The viewer's own household roster doesn't belong on an external contact's page —
            RelationshipsCard covers "who this person is connected to" for contacts instead. */}
        {person.isHouseholdMember && (
          <div className="min-w-0 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
            <h2 className={sectionTitle}>Household ({householdMembers.length})</h2>
            {householdMembers.length === 0 ? (
              <EmptyNote>No other household members yet.</EmptyNote>
            ) : (
              <ul className="mt-2 sm:space-y-2">
                {householdMembers.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/people/${m.id}`}
                      className="flex min-h-11 min-w-0 items-center gap-2 text-sm text-muted-foreground hover:text-foreground sm:min-h-0"
                    >
                      <Avatar
                        personId={m.id}
                        hasPhoto={m.photoContentType !== null}
                        initial={m.firstName}
                        size={24}
                        colorClass="bg-muted text-foreground"
                      />
                      <span className="truncate">{fullName(m)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <RelationshipsCard
          personId={person.id}
          personFirstName={person.firstName}
          relationships={relationships}
          pickablePeople={pickablePeople}
          canEdit={viewerIsAdult}
        />

        <ImportantDates personId={person.id} dates={dates} canEdit={viewerIsAdult} />
      </div>
    </div>
  );
}

/** Where this household member shows up in the other apps: stickers, the list, school. */
async function aroundTheHouse(personId: string, householdId: string) {
  const [stickers, forThem, school, words] = await Promise.all([
    getPointsBalance(personId),
    prisma.shoppingListItem.count({ where: { requestedById: personId, done: false } }),
    prisma.schoolProfile.findUnique({ where: { personId }, select: { schoolName: true, grade: true } }),
    getRewardWords(householdId),
  ]);
  return { stickers, words, forThem, school: school ? [school.schoolName, school.grade && `grade ${school.grade}`].filter(Boolean).join(" · ") : null };
}

function AroundLink({ href, emoji, text }: { href: string; emoji: string; text: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-11 items-center gap-2 rounded-md px-1 text-muted-foreground transition hover:translate-x-1 hover:text-foreground sm:min-h-9">
        <span aria-hidden>{emoji}</span>
        <span className="min-w-0 truncate">{text}</span>
      </Link>
    </li>
  );
}

function TaskSummary({
  label,
  href,
  overdueCount,
  dueTodayCount,
  upcomingCount,
  points,
}: {
  label: string;
  href: { pathname: string; query: { person: string } };
  overdueCount: number;
  dueTodayCount: number;
  upcomingCount: number;
  points: number;
}) {
  const nothingDue = overdueCount === 0 && dueTodayCount === 0 && upcomingCount === 0;
  return (
    <Link
      href={href}
      className="mt-2 block rounded-md px-1 py-1.5 text-sm transition hover:translate-x-1"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{points} ⭐</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {overdueCount > 0 && <span className="text-destructive">{overdueCount} overdue</span>}
        {overdueCount > 0 && dueTodayCount > 0 && " · "}
        {dueTodayCount > 0 && `${dueTodayCount} due today`}
        {(overdueCount > 0 || dueTodayCount > 0) && upcomingCount > 0 && " · "}
        {upcomingCount > 0 && `${upcomingCount} upcoming this week`}
        {nothingDue && "Nothing due this week"}
      </p>
    </Link>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
}: {
  href?: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}) {
  if (!href) {
    return (
      <span
        role="link"
        aria-disabled="true"
        aria-label={label}
        title={label}
        className="inline-flex size-11 shrink-0 cursor-not-allowed items-center justify-center rounded-full text-muted-foreground/60 ring-1 ring-border sm:size-9"
      >
        <Icon size={16} />
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} title={label} className={`${iconBtn} ring-1 ring-input`}>
      <Icon size={16} />
    </Link>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-foreground">{value || "—"}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
      <h2 className={sectionTitle}>{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

async function RecentEmails({ email }: { email: string }) {
  return <RecentEmailsCard result={await searchRecentMail(email)} />;
}

function RecentEmailsCard({ result }: { result: RecentMailResult | null }) {
  return (
    <Card title="Recent emails">
      {!result ? (
        <EmptyNote>No email on file for this contact.</EmptyNote>
      ) : !result.ok ? (
        <EmptyNote>{result.error}</EmptyNote>
      ) : result.messages.length === 0 ? (
        <EmptyNote>No recent emails found.</EmptyNote>
      ) : (
        <ul className="space-y-3">
          {result.messages.map((m) => (
            <li key={m.id}>
              <a
                href={m.webLink}
                target="_blank"
                rel="noopener noreferrer"
                className="-m-1.5 block rounded-md p-1.5 hover:bg-muted"
              >
                <p
                  className={`truncate text-sm ${
                    m.isRead ? "text-muted-foreground" : "font-semibold text-foreground"
                  }`}
                >
                  {m.subject}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.direction === "sent" ? `To ${m.counterpart}` : `From ${m.counterpart}`} ·{" "}
                  {formatDateTime(m.receivedAt)}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.preview}</p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
