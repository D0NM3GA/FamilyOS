import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { btn, card, chip, chipRow } from "@/components/styles";
import { SelectionProvider, SelectToggle } from "@/components/selection";
import { getEveryoneOpen } from "@/lib/school/queries";
import { matchesShow, type SchoolShow } from "@/lib/school/rules";
import { itemParam, type ItemRef } from "@/lib/work-items/history";
import { ItemPanel } from "../item-panel";
import { bulkSchool } from "./actions";
import { FormsBulkBar, HomeworkBulkBar } from "./bulk";
import { FormRow, HomeworkRow } from "./row-items";

const cardTitle = "text-lg font-extrabold text-foreground";

const SHOW_LABEL: Record<SchoolShow, string> = { overdue: "Overdue", week: "This week", tests: "Tests", missing: "Missing" };

/** Phase 59.4a: the homework list's quick filters, kept in the address. */
export function ShowChips({ here, show }: { here: (change: Record<string, string | null>) => string; show: SchoolShow | null }) {
  return (
    <nav aria-label="Show" className={`mt-3 ${chipRow}`}>
      <Link href={here({ show: null })} aria-current={show === null ? "page" : undefined} className={chip}>
        All
      </Link>
      {(Object.keys(SHOW_LABEL) as SchoolShow[]).map((s) => (
        <Link key={s} href={here({ show: s })} aria-current={show === s ? "page" : undefined} className={chip}>
          {SHOW_LABEL[s]}
        </Link>
      ))}
    </nav>
  );
}

type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };

/**
 * Phase 59.4a: School's "Everyone" for grown-ups: every student's open homework, tests and
 * projects, each row saying whose it is, and every open form, with the same quick changes as a
 * student's own page. Kids never get here (the page sends them to their own tab).
 */
export async function Everyone({
  viewer,
  students,
  show,
  itemRef,
}: {
  viewer: Viewer;
  students: { id: string; firstName: string }[];
  show: SchoolShow | null;
  itemRef: ItemRef | null;
}) {
  const data = await getEveryoneOpen(viewer);
  if (!data) return null;
  const today = new Date();
  const members = await prisma.person.findMany({
    where: { householdId: viewer.householdId, isHouseholdMember: true },
    select: { id: true, firstName: true, role: true },
    orderBy: { firstName: "asc" },
  });
  const here = (change: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ kid: "all", show, item: null, ...change })) if (v) q.set(k, v);
    return `/school?${q.toString()}`;
  };
  const shown = data.assignments.filter((a) => matchesShow(a, show, today));
  const kids = students.map((s) => ({ id: s.id, name: s.firstName }));
  const adults = members.filter((m) => m.role !== "KID").map((m) => ({ id: m.id, name: m.firstName }));

  return (
    <div className="max-w-5xl p-4 sm:p-6">
      <PageHeader title="🎒 School">
        <Link href="/data#school" className={btn}>
          Export
        </Link>
      </PageHeader>
      <nav className={`mt-4 ${chipRow}`} aria-label="Students">
        <Link href="/school?kid=all" aria-current="page" className={chip}>
          Everyone
        </Link>
        {students.map((s) => (
          <Link key={s.id} href={`/school?kid=${s.id}`} className={chip}>
            {s.firstName}
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid gap-4">
        <SelectionProvider key={`everyone-homework-${show ?? "all"}`}>
          <section className={`min-w-0 ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={cardTitle}>Everyone&apos;s homework & tests</h2>
              {data.assignments.length > 1 && <SelectToggle />}
            </div>
            <ShowChips here={here} show={show} />
            {shown.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{data.assignments.length === 0 ? "All caught up. ✨" : "Nothing like that right now."}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {shown.map((a) => (
                  <HomeworkRow key={a.id} a={a} student={a.profile.person} viewer={viewer} today={today} detailsHref={here({ item: itemParam("ASSIGNMENT", a.id) })} showStudent />
                ))}
              </ul>
            )}
            <HomeworkBulkBar bulk={bulkSchool} />
          </section>
        </SelectionProvider>

        <SelectionProvider key="everyone-forms">
          <section className={`min-w-0 ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={cardTitle}>Forms & to-dos</h2>
              {data.tasks.length > 1 && <SelectToggle />}
            </div>
            {data.tasks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing to sign or pay. 🎉</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {data.tasks.map((t) => (
                  <FormRow key={t.id} t={t} viewer={viewer} today={today} detailsHref={here({ item: itemParam("SCHOOL_TASK", t.id) })} kids={kids} adults={adults} />
                ))}
              </ul>
            )}
            <FormsBulkBar bulk={bulkSchool} />
          </section>
        </SelectionProvider>
      </div>
      {itemRef && <ItemPanel itemRef={itemRef} closeHref={here({ item: null })} />}
    </div>
  );
}
