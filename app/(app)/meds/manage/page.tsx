import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { isLowStock } from "@/lib/meds/quantity";
import { AvatarStack } from "@/components/avatar-stack";
import { PageHeader } from "@/components/page-header";
import { btn, btnPrimary, card, field } from "@/components/styles";
import { describeRecurrence, formatHHmm } from "@/lib/tasks/format";
import { setDefinitionActive, addStock } from "../actions";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

export default async function ManageMedsPage() {
  await requireAppOn("meds");
  const profile = await requireActiveProfile();

  if (!isAdult(profile)) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Only adults can manage medications.</p>
      </div>
    );
  }

  const definitions = await prisma.taskDefinition.findMany({
    where: { householdId: profile.householdId, domain: "MED" },
    include: { assignees: { omit: { photo: true } }, medication: true },
    orderBy: [{ active: "desc" }, { title: "asc" }],
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Manage medications">
        <Link href="/meds/new" className={btnPrimary}>
          + New medication
        </Link>
      </PageHeader>

      <div className={`mt-4 ${card}`}>
        {definitions.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">No medications yet.</p>
        ) : (
          // Pulls the first and last rows' padding into the card's own, so the edges match.
          <ul className="-my-3 divide-y divide-border">
            {definitions.map((def) => (
              <li key={def.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                {/* A 12rem basis, not 0, so the buttons drop under the details on a phone
                    instead of squeezing the name down to a few letters. */}
                <div className="min-w-0 flex-[1_1_12rem]">
                  <p
                    className={`truncate text-sm font-bold ${
                      def.active ? "text-foreground" : "text-muted-foreground line-through"
                    }`}
                  >
                    {def.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {describeRecurrence(def)} · {def.timesOfDay.map(formatHHmm).join(", ")}
                    {def.points > 0 ? ` · ${def.points} ⭐` : ""}
                  </p>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    {def.assignees.length > 0 ? (
                      <>
                        <AvatarStack
                          size={20}
                          people={def.assignees.map((a) => ({
                            id: a.id,
                            label: a.firstName,
                            hasPhoto: a.photoContentType !== null,
                          }))}
                        />
                        <span className="truncate text-xs text-muted-foreground">
                          {def.assignees.map((a) => a.firstName).join(", ")}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unassigned</span>
                    )}
                  </div>
                  {def.medication?.quantityOnHand != null && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {def.medication.quantityOnHand} on hand
                      </span>
                      {isLowStock(def.medication.quantityOnHand, def.medication.refillThresholdQuantity) && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
                          Low
                        </span>
                      )}
                      <form action={addStock.bind(null, def.id)} className="flex items-center gap-2">
                        <input
                          type="number"
                          name="amount"
                          step="any"
                          min="0"
                          placeholder="+ qty"
                          required
                          aria-label={`Amount of ${def.title} to add`}
                          className={`${field} w-20`}
                        />
                        <SubmitButton className={btn}>
                          Add stock
                        </SubmitButton>
                      </form>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <a
                    href={`https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(def.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center px-1 text-sm font-bold text-brand-text hover:underline sm:min-h-9"
                  >
                    DailyMed
                    <span className="sr-only">: look up {def.title} (opens in a new tab)</span>
                  </a>
                  <Link href={`/meds/${def.id}/edit`} className={btn}>
                    Edit<span className="sr-only"> {def.title}</span>
                  </Link>
                  <form action={setDefinitionActive.bind(null, def.id, !def.active)}>
                    <SubmitButton className={btn}>
                      {def.active ? "Deactivate" : "Reactivate"}
                      <span className="sr-only"> {def.title}</span>
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
