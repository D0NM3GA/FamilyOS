import Link from "next/link";
import { Mail, Phone, Printer } from "lucide-react";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin, isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { formatEventWhen } from "@/lib/format";
import { AwayTime } from "@/components/away-time";
import { getHouseholdSettings } from "@/lib/household-settings";
import { getStudentHub, getUpcomingSchoolEvents, listStudents } from "@/lib/school/queries";
import { scheduleFeedRefresh } from "@/lib/school/feeds/schedule";
import { byDueDate, classAverages, matchesShow, SCHOOL_SHOWS, type SchoolShow } from "@/lib/school/rules";
import { atMidnight } from "@/lib/tasks/schedule";
import { PageHeader } from "@/components/page-header";
import { btn, card, chip, chipRow, fieldLabel, iconBtn, sectionTitle } from "@/components/styles";
import { addAssignment, addTask, approveKidChange, bulkSchool, putBackKidChange, setAssignmentStatus, setTaskDone } from "./actions";
import { AssignmentForm, TaskForm } from "./forms";
import { KidChange } from "./rows";
import { FormRow, HomeworkRow } from "./row-items";
import { Everyone, ShowChips } from "./everyone";
import { ItemPanel } from "../item-panel";
import { itemParam, parseItemRef } from "@/lib/work-items/history";
import { MilestoneToastBoard } from "@/components/tasks/milestone-toast";
import { SelectionProvider, SelectToggle } from "@/components/selection";
import { FormsBulkBar, HomeworkBulkBar } from "./bulk";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

const cardTitle = "text-lg font-extrabold text-foreground";

/**
 * School (Phase 18): one tab per student with their school details, teachers, forms &
 * to-dos, and homework & grades. Adults see every student; a kid sees only their own tab.
 */
export default async function SchoolPage({ searchParams }: { searchParams: Promise<{ kid?: string; show?: string; item?: string }> }) {
  await requireAppOn("school");
  const viewer = await requireActiveProfile();
  const adult = isAdult(viewer);
  const students = await listStudents(viewer);
  const { kid, show: rawShow, item } = await searchParams;
  // Phase 59.4a: quick filters and the side panel live in the address.
  const show = SCHOOL_SHOWS.includes(rawShow as SchoolShow) ? (rawShow as SchoolShow) : null;
  const itemRef = parseItemRef(item);

  if (students.length === 0) {
    return (
      <div className="max-w-5xl p-4 sm:p-6">
        <PageHeader title="🎒 School" />
        <p className="mt-4 text-sm text-muted-foreground">
          No students here yet. 🎒 Kids in the household show up here automatically; add them in Settings → Household.
        </p>
      </div>
    );
  }

  // Phase 59.4a: grown-ups with more than one student get Everyone (?kid=all).
  if (adult && students.length > 1 && kid === "all") return <Everyone viewer={viewer} students={students} show={show} itemRef={itemRef} />;
  const selectedId = students.some((s) => s.id === kid) ? kid! : students[0].id;
  // Feeds older than 6 hours refresh after this page is sent (Phase 18.5).
  await scheduleFeedRefresh(viewer.householdId).catch(() => {});
  const settings = await getHouseholdSettings(viewer.householdId);
  const zone = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [hub, events] = await Promise.all([
    getStudentHub(viewer, selectedId),
    getUpcomingSchoolEvents(viewer, { days: 14, studentId: selectedId, timeZone: zone }),
  ]);
  if (!hub) return null;
  const { person, tasks, recentlyDone } = hub;
  const school = person.schoolProfile;
  const today = new Date();

  const assignments = school?.assignments ?? [];
  const open = assignments.filter((a) => a.status !== "DONE").sort(byDueDate);
  const shownOpen = open.filter((a) => matchesShow(a, show, today));
  // Links keep the student and filter, and add or drop one.
  const here = (change: Record<string, string | null>) => {
    const q = new URLSearchParams();
    // The student shown, not ?kid=all when this page fell back from it.
    for (const [k, v] of Object.entries({ kid: kid === "all" ? null : (kid ?? null), show, item: null, ...change })) if (v) q.set(k, v);
    const qs = q.toString();
    return qs ? `/school?${qs}` : "/school";
  };
  // Ticked off in the last two weeks and not graded (graded work shows below): a mis-tap
  // used to make homework vanish with no way back.
  const fortnightAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const doneRecently = assignments
    .filter((a) => a.status === "DONE" && a.score == null && a.doneAt != null && a.doneAt >= fortnightAgo)
    .sort((a, b) => b.doneAt!.getTime() - a.doneAt!.getTime());
  const graded = assignments.filter((a) => a.score != null).sort((a, b) => (b.dueDate?.getTime() ?? 0) - (a.dueDate?.getTime() ?? 0));
  const averages = classAverages(assignments);
  // Phase 59.1b: tests and quizzes still to sit, from today through the next six days.
  const weekStart = atMidnight(today);
  const weekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  const toSit = open.filter(
    (a) => (a.kind === "TEST" || a.kind === "QUIZ") && a.status === "TODO" && a.dueDate != null && a.dueDate >= weekStart && a.dueDate < weekEnd,
  );
  const testsThisWeek = toSit.length;
  // Phase 59.2a: what the student changed themself, for a grown-up to check.
  // Counted where it can be checked: the open list and Done recently (a grown-up's own edit or
  // grade counts as checking it, so graded work never waits).
  const toCheck = adult ? [...open, ...doneRecently].filter((a) => a.kidChangedAt != null).length : 0;
  const kidsList = students.map((s) => ({ id: s.id, name: s.firstName }));
  // Says what's coming: "2 tests", "1 quiz", "1 test and 1 quiz".
  const tests = toSit.filter((a) => a.kind === "TEST").length;
  const quizzes = testsThisWeek - tests;
  const toSitLabel = [tests && `${tests} ${tests === 1 ? "test" : "tests"}`, quizzes && `${quizzes} ${quizzes === 1 ? "quiz" : "quizzes"}`].filter(Boolean).join(" and ");

  const members = adult
    ? await prisma.person.findMany({
        where: { householdId: viewer.householdId, isHouseholdMember: true },
        select: { id: true, firstName: true, role: true },
        orderBy: { firstName: "asc" },
      })
    : [];

  return (
    <MilestoneToastBoard>
    <div className="max-w-5xl p-4 sm:p-6">
      <PageHeader title="🎒 School">
        {adult && (
          <Link href="/data#school" className={btn}>
            Export
          </Link>
        )}
      </PageHeader>

      {students.length > 1 && (
        <nav className={`mt-4 ${chipRow}`} aria-label="Students">
          {adult && (
            <Link href="/school?kid=all" className={chip}>
              Everyone
            </Link>
          )}
          {students.map((s) => (
            <Link
              key={s.id}
              href={`/school?kid=${s.id}`}
              aria-current={s.id === selectedId ? "page" : undefined}
              className={chip}
            >
              {s.firstName}
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className={`min-w-0 ${card}`}>
          <div className="flex items-start justify-between gap-2">
            <h2 className={cardTitle}>{person.firstName}&apos;s school</h2>
            <div className="flex shrink-0 items-center gap-1.5">
              {school && (
                <Link
                  href={`/print/school/${person.id}`}
                  className={iconBtn}
                  title="Print a fridge card"
                  aria-label={`Print ${person.firstName}'s fridge card`}
                >
                  <Printer size={18} />
                </Link>
              )}
              {adult && (
                <Link href={`/school/${person.id}/edit`} className={btn}>
                  {school ? "Edit" : "Set up"}
                </Link>
              )}
            </div>
          </div>
          {!school ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {adult ? "No school details yet. Set them up to add homework and teachers." : "A grown-up hasn't set this up yet."}
            </p>
          ) : (
            <dl className="mt-2 space-y-1.5 text-sm">
              <Row label="School" value={[school.schoolName, school.grade && `grade ${school.grade}`, school.schoolYear].filter(Boolean).join(" · ")} />
              <Row label="Getting there" value={school.transportNotes} />
              <Row label="Lunch" value={school.lunchNotes} />
              <Row label="Schedule" value={school.scheduleNotes} />
              <Row label="Notes" value={school.notes} />
              {school.contacts.length > 0 && (
                <div className="pt-2">
                  <dt className={fieldLabel}>Teachers & contacts</dt>
                  <dd>
                    <ul className="mt-1">
                      {school.contacts.map((c) => {
                        const name = [c.person.firstName, c.person.lastName].filter(Boolean).join(" ");
                        return (
                          <li key={c.personId} className="flex flex-wrap items-center gap-x-2">
                            <Link
                              href={`/people/${c.person.id}`}
                              className="inline-flex min-h-11 items-center font-bold text-foreground hover:underline sm:min-h-9"
                            >
                              {name}
                            </Link>
                            <span className="text-xs text-muted-foreground">{c.role}</span>
                            {c.person.phone && (
                              <a href={`tel:${c.person.phone}`} className={iconBtn} aria-label={`Call ${name}`}>
                                <Phone size={16} />
                              </a>
                            )}
                            {c.person.email && (
                              <a href={`mailto:${c.person.email}`} className={iconBtn} aria-label={`Email ${name}`}>
                                <Mail size={16} />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </section>

        {adult && (
          // Phase 59.3: its own selection, new for each student.
          <SelectionProvider key={`forms-${selectedId}`}>
            <section className={`min-w-0 ${card}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className={cardTitle}>Forms & to-dos</h2>
                {tasks.length > 1 && <SelectToggle />}
              </div>
              {tasks.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Nothing to sign or pay. 🎉</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {tasks.map((t) => (
                    <FormRow
                      key={t.id}
                      t={t}
                      viewer={viewer}
                      today={today}
                      detailsHref={here({ item: itemParam("SCHOOL_TASK", t.id) })}
                      kids={kidsList}
                      adults={members.filter((m) => m.role !== "KID").map((m) => ({ id: m.id, name: m.firstName }))}
                    />
                  ))}
                </ul>
              )}
              {recentlyDone.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer py-3 font-bold text-muted-foreground sm:py-1">
                    Done recently ({recentlyDone.length})
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {recentlyDone.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 text-muted-foreground line-through">{t.title}</span>
                        <form action={setTaskDone.bind(null, t.id, false)}>
                          <SubmitButton aria-label={`Undo ${t.title}`} className={btn}>
                            Undo
                          </SubmitButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-3">
                <TaskForm
                  action={addTask}
                  defaultKidId={person.id}
                  kids={students.map((s) => ({ id: s.id, name: s.firstName }))}
                  adults={members.filter((m) => m.role !== "KID").map((m) => ({ id: m.id, name: m.firstName }))}
                />
              </div>
              <FormsBulkBar bulk={bulkSchool} />
            </section>
          </SelectionProvider>
        )}

        <SelectionProvider key={`homework-${selectedId}-${show ?? "all"}`}>
          <section className={`min-w-0 ${card} lg:col-span-2`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h2 className={cardTitle}>Homework & tests</h2>
              {/* Phase 59.3: grown-ups pick several. */}
              {adult && open.length > 1 && <SelectToggle />}
              {toCheck > 0 && (
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  {toCheck === 1 ? "1 change to check" : `${toCheck} changes to check`}
                </p>
              )}
              {testsThisWeek > 0 && (
                <p className="text-sm font-bold text-sky-800 dark:text-sky-300">
                  {toSitLabel} this week
                </p>
              )}
            </div>
            {!school ? (
              <p className="mt-2 text-sm text-muted-foreground">Set up the school details first.</p>
            ) : (
              <>
                {open.length > 0 && <ShowChips here={here} show={show} />}
                {shownOpen.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{open.length === 0 ? "All caught up. ✨" : "Nothing like that right now."}</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {shownOpen.map((a) => (
                      <HomeworkRow key={a.id} a={a} student={{ id: person.id, firstName: person.firstName }} viewer={viewer} today={today} detailsHref={here({ item: itemParam("ASSIGNMENT", a.id) })} />
                    ))}
                  </ul>
                )}
                {adult && <HomeworkBulkBar bulk={bulkSchool} />}
                {/* Done recently opens when it holds a kid's change to check, so the heading's count can be found. */}
                {doneRecently.length > 0 && (
                  <details className="mt-3 text-sm" open={adult && doneRecently.some((a) => a.kidChangedAt != null)}>
                    <summary className="cursor-pointer py-3 font-bold text-muted-foreground sm:py-1">Done recently ({doneRecently.length})</summary>
                    <ul className="mt-1 space-y-1">
                      {doneRecently.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 text-muted-foreground line-through">
                            <span className="text-xs font-bold">{a.className}</span> {a.title}
                          </span>
                          <form action={setAssignmentStatus.bind(null, a.id, "TODO")}>
                            <SubmitButton aria-label={`Undo ${a.title}`} className={btn}>
                              Undo
                            </SubmitButton>
                          </form>
                          {adult && a.kidChangedAt && (
                            <KidChange
                              who={person.firstName}
                              title={a.title}
                              onApprove={approveKidChange.bind(null, a.id, a.kidChangedAt.toISOString())}
                              onPutBack={putBackKidChange.bind(null, a.id, a.kidChangedAt.toISOString())}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-3">
                  <AssignmentForm action={addAssignment.bind(null, person.id)} canGrade={adult} />
                </div>

                {(averages.length > 0 || graded.length > 0) && (
                  <div className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                    <div>
                      <h3 className={sectionTitle}>Averages</h3>
                      <ul className="mt-1 space-y-1 text-sm">
                        {averages.map((c) => (
                          <li key={c.className} className="flex justify-between gap-2">
                            <span className="text-foreground">{c.className}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {c.percent}% <span className="text-xs">({c.graded} graded)</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="min-w-0">
                      <h3 className={sectionTitle}>Recent grades</h3>
                      <ul className="mt-1 space-y-1 text-sm">
                        {graded.slice(0, 8).map((a) => (
                          <li key={a.id} className="flex justify-between gap-2">
                            <span className="truncate text-foreground">
                              <span className="text-xs text-muted-foreground">{a.className}</span> {a.title}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {a.score}/{a.maxScore}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </SelectionProvider>

        <section className={`min-w-0 ${card} lg:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={cardTitle}>School calendar, next two weeks</h2>
            {isAdmin(viewer) && (
              <Link href="/school/feeds" className={btn}>
                Calendars
              </Link>
            )}
          </div>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {isAdmin(viewer) ? "Nothing coming up. Add the school's calendar feed under Calendars." : "Nothing coming up."}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {events.map((e) => (
                <li key={`${e.feedId}-${e.occurrenceKey}`} className="flex flex-wrap items-baseline justify-between gap-x-2 py-1.5 text-sm">
                  <span className="min-w-0 text-foreground">
                    {e.title}
                    {e.location && <span className="text-xs text-muted-foreground"> · {e.location}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatEventWhen(e, zone)}
                    {!e.allDay && <AwayTime at={e.startsAt} />} · {e.who}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {itemRef && <ItemPanel itemRef={itemRef} closeHref={here({ item: null })} />}
    </div>
    </MilestoneToastBoard>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className={`shrink-0 sm:w-28 ${fieldLabel}`}>{label}</dt>
      <dd className="whitespace-pre-line text-foreground">{value}</dd>
    </div>
  );
}
