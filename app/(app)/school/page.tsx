import Link from "next/link";
import { Mail, Phone, Printer } from "lucide-react";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin, isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { formatEventWhen, formatFullDate } from "@/lib/format";
import { AwayTime } from "@/components/away-time";
import { getHouseholdSettings } from "@/lib/household-settings";
import { getStudentHub, getUpcomingSchoolEvents, listStudents } from "@/lib/school/queries";
import { scheduleFeedRefresh } from "@/lib/school/feeds/schedule";
import { byDueDate, classAverages, isOverdue } from "@/lib/school/rules";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { btn, btnDanger, card, chip, chipRow, fieldLabel, iconBtn, sectionTitle } from "@/components/styles";
import { addAssignment, addTask, deleteAssignment, deleteTask, setAssignmentStatus, setTaskDone } from "./actions";
import { ConfirmButton } from "@/components/confirm-button";
import { AssignmentForm, TaskForm } from "./forms";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

const KIND_LABEL = { FORM: "📝 Form", FEE: "💵 Fee", SUPPLIES: "✏️ Supplies", OTHER: "📌 To-do" } as const;
const cardTitle = "text-lg font-extrabold text-foreground";

/**
 * School (Phase 18): one tab per student with their school details, teachers, forms &
 * to-dos, and homework & grades. Adults see every student; a kid sees only their own tab.
 */
export default async function SchoolPage({ searchParams }: { searchParams: Promise<{ kid?: string }> }) {
  await requireAppOn("school");
  const viewer = await requireActiveProfile();
  const adult = isAdult(viewer);
  const students = await listStudents(viewer);
  const { kid } = await searchParams;

  if (students.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="🎒 School" />
        <p className="mt-4 text-sm text-muted-foreground">
          No students here yet. 🎒 Kids in the household show up here automatically; add them in Settings → Household.
        </p>
      </div>
    );
  }

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
  // Ticked off in the last two weeks and not graded (graded work shows below): a mis-tap
  // used to make homework vanish with no way back.
  const fortnightAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const doneRecently = assignments
    .filter((a) => a.status === "DONE" && a.score == null && a.doneAt != null && a.doneAt >= fortnightAgo)
    .sort((a, b) => b.doneAt!.getTime() - a.doneAt!.getTime());
  const graded = assignments.filter((a) => a.score != null).sort((a, b) => (b.dueDate?.getTime() ?? 0) - (a.dueDate?.getTime() ?? 0));
  const averages = classAverages(assignments);

  const members = adult
    ? await prisma.person.findMany({
        where: { householdId: viewer.householdId, isHouseholdMember: true },
        select: { id: true, firstName: true, role: true },
        orderBy: { firstName: "asc" },
      })
    : [];

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="🎒 School">
        {adult && (
          <Link href="/data#school" className={btn}>
            Export
          </Link>
        )}
      </PageHeader>

      {students.length > 1 && (
        <nav className={`mt-4 ${chipRow}`} aria-label="Students">
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

      <div className="mt-6 grid max-w-5xl gap-4 lg:grid-cols-2">
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
          <section className={`min-w-0 ${card}`}>
            <h2 className={cardTitle}>Forms & to-dos</h2>
            {tasks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing to sign or pay. 🎉</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {tasks.map((t) => {
                  const late = t.dueDate != null && t.dueDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                  return (
                    <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                      <form action={setTaskDone.bind(null, t.id, true)}>
                        <DoneButton label={`Mark ${t.title} done`} />
                      </form>
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="text-sm text-foreground">
                          <span className="text-xs text-muted-foreground">{KIND_LABEL[t.kind]}</span> {t.title}
                          {t.amountCents != null && <span className="text-muted-foreground"> · {formatMoney(t.amountCents)}</span>}
                        </p>
                        <p className={`text-xs ${late ? "font-bold text-destructive" : "text-muted-foreground"}`}>
                          {t.dueDate ? `${late ? "Was due" : "Due"} ${formatFullDate(t.dueDate)}` : "No due date"}
                          {t.kid ? ` · ${t.kid.firstName}` : " · everyone"}
                          {t.owner ? ` · ${t.owner.firstName} has it` : ""}
                        </p>
                      </div>
                      <form action={deleteTask.bind(null, t.id)} className="ml-auto">
                        <ConfirmButton message={`Remove "${t.title}"? This can't be undone.`} aria-label={`Remove ${t.title}`} className={btnDanger}>
                          Remove
                        </ConfirmButton>
                      </form>
                    </li>
                  );
                })}
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
          </section>
        )}

        <section className={`min-w-0 ${card} lg:col-span-2`}>
          <h2 className={cardTitle}>Homework & tests</h2>
          {!school ? (
            <p className="mt-2 text-sm text-muted-foreground">Set up the school details first.</p>
          ) : (
            <>
              {open.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">All caught up. ✨</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {open.map((a) => {
                    const overdue = isOverdue(a, today);
                    // Mirrors the server rules (actions.ts): a kid can't clear "missing" or
                    // remove graded or missing work, so those controls aren't offered.
                    const canTick = adult || a.status !== "MISSING";
                    const canRemove = adult || (a.score == null && a.status !== "MISSING");
                    return (
                      <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                        {canTick ? (
                          <form action={setAssignmentStatus.bind(null, a.id, "DONE")}>
                            <DoneButton label={`Mark ${a.title} done`} />
                          </form>
                        ) : (
                          <span aria-hidden className="size-11 shrink-0 sm:size-9" />
                        )}
                        <div className="min-w-0 flex-1 basis-40">
                          <p className="text-sm text-foreground">
                            <span className="text-xs font-bold text-muted-foreground">{a.className}</span> {a.title}
                            {a.status === "MISSING" && (
                              <span className="ml-2 inline-block -rotate-1 rounded-md bg-tomato px-1.5 text-xs font-bold text-ink">
                                Missing
                              </span>
                            )}
                          </p>
                          <p className={`text-xs ${overdue ? "font-bold text-destructive" : "text-muted-foreground"}`}>
                            {a.dueDate ? `${overdue ? "Was due" : "Due"} ${formatFullDate(a.dueDate)}` : "No due date"}
                          </p>
                        </div>
                        {(adult || canRemove) && (
                          <div className="ml-auto flex flex-wrap items-center gap-2">
                            {adult && a.status !== "MISSING" && (
                              <form action={setAssignmentStatus.bind(null, a.id, "MISSING")}>
                                <SubmitButton aria-label={`Mark ${a.title} missing`} className={btn}>
                                  Missing
                                </SubmitButton>
                              </form>
                            )}
                            {adult && (
                              <Link href={`/school/${person.id}/assignments/${a.id}`} aria-label={`Edit ${a.title}`} className={btn}>
                                Edit
                              </Link>
                            )}
                            {canRemove && (
                              <form action={deleteAssignment.bind(null, a.id)}>
                                <ConfirmButton
                                  message={`Remove "${a.title}"${a.score != null ? " and its grade" : ""}? This can't be undone.`}
                                  aria-label={`Remove ${a.title}`}
                                  className={btnDanger}
                                >
                                  Remove
                                </ConfirmButton>
                              </form>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {doneRecently.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer py-3 font-bold text-muted-foreground sm:py-1">Done recently ({doneRecently.length})</summary>
                  <ul className="mt-1 space-y-1">
                    {doneRecently.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 text-muted-foreground line-through">
                          <span className="text-xs font-bold">{a.className}</span> {a.title}
                        </span>
                        <form action={setAssignmentStatus.bind(null, a.id, "TODO")}>
                          <SubmitButton aria-label={`Undo ${a.title}`} className={btn}>
                            Undo
                          </SubmitButton>
                        </form>
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
                    {!e.allDay && <AwayTime at={e.startsAt} />} · {e.feed.kid?.firstName ?? e.feed.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
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

/** A done box: small to look at, a whole thumb wide to tap. */
function DoneButton({ label }: { label: string }) {
  return (
    <SubmitButton aria-label={label} className={`group ${iconBtn}`}>
      <span aria-hidden className="size-5 rounded-md border-2 border-input transition group-hover:border-foreground" />
    </SubmitButton>
  );
}
