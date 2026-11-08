import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAppOn } from "@/lib/app-guard";
import { doseHistory, HISTORY_DAYS } from "@/lib/meds/history";
import { PageHeader } from "@/components/page-header";
import { btn, sectionTitle } from "@/components/styles";

export const metadata: Metadata = { title: "Dose history" };

/** Phase 65a: a medicine's doses over the last 90 days. Grown-ups, or the medicine's own person. */
export default async function DoseHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAppOn("meds");
  const profile = await requireActiveProfile();
  const { id } = await params;
  const history = await doseHistory(id, profile);
  if (!history) notFound();
  const { definition, days, taken } = history;
  const person = definition.assignees[0];

  return (
    <div className="max-w-2xl p-4 sm:p-6">
      <PageHeader
        title={<span className="block break-words">{definition.title}</span>}
      >
        <Link href={`/print/meds/${definition.id}/history`} className={btn}>
          Print
        </Link>
      </PageHeader>
      <p className="mt-2 text-sm text-muted-foreground">
        {person ? `${person.firstName} · ` : ""}
        {taken} {taken === 1 ? "dose" : "doses"} taken in the last{" "}
        {HISTORY_DAYS} days
      </p>
      {days.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          No doses in the last {HISTORY_DAYS} days.
        </p>
      ) : (
        <div className="mt-6 space-y-5">
          {days.map((d) => (
            <section key={d.day}>
              <h2 className={sectionTitle}>{d.day}</h2>
              <ul className="ui-card mt-2 divide-y-2 divide-dashed divide-ink/10 rounded-2xl border-2 border-ink bg-card dark:divide-white/10 dark:border-white/20">
                {d.doses.map((x) => (
                  <li
                    key={x.id}
                    className="flex min-h-11 items-center gap-3 px-3 py-2"
                  >
                    <span className="w-20 shrink-0 text-sm font-bold tabular-nums">
                      {x.time}
                    </span>
                    <span
                      className={`flex-1 font-semibold ${x.what === "Taken" ? "" : "text-muted-foreground"}`}
                    >
                      {x.what}
                    </span>
                    {x.who && (
                      <span className="text-sm text-muted-foreground">
                        {x.who}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
