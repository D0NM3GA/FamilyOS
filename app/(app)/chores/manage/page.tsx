import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { AvatarStack } from "@/components/avatar-stack";
import { PageHeader } from "@/components/page-header";
import { btn, btnPrimary, card } from "@/components/styles";
import { describeRecurrence } from "@/lib/tasks/format";
import { setDefinitionActive } from "../actions";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

export default async function ManageChoresPage() {
  await requireAppOn("chores");
  const profile = await requireActiveProfile();

  if (!isAdult(profile)) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Only adults can manage chores.</p>
      </div>
    );
  }

  const definitions = await prisma.taskDefinition.findMany({
    where: { householdId: profile.householdId, domain: "CHORE" },
    include: { assignees: { omit: { photo: true } } },
    orderBy: [{ active: "desc" }, { title: "asc" }],
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Manage chores">
        <Link href="/chores/new" className={btnPrimary}>
          + New chore
        </Link>
      </PageHeader>

      <div className={`mt-4 ${card}`}>
        {definitions.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">No chores yet.</p>
        ) : (
          // Pulls the first and last rows' padding into the card's own, so the edges match.
          <ul className="-my-3 divide-y divide-border">
            {definitions.map((def) => (
              <li key={def.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                {/* A 12rem basis, not 0, so the buttons drop under the details on a phone
                    instead of squeezing the title down to a few letters. */}
                <div className="min-w-0 flex-[1_1_12rem]">
                  <p
                    className={`truncate text-sm font-bold ${
                      def.active ? "text-foreground" : "text-muted-foreground line-through"
                    }`}
                  >
                    {def.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {describeRecurrence(def)} · {def.points} ⭐
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
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Link href={`/chores/${def.id}/edit`} className={btn}>
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
