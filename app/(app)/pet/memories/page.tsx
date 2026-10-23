import Link from "next/link";
import { requireAppOn } from "@/lib/app-guard";
import { getMyMemories } from "@/lib/pet/queries";
import { SPECIES, STAGES, type DeathCause, type Species, type Stage } from "@/lib/pet/state";
import { formName, memoryLine } from "@/lib/pet/words";
import { backLink, card, pageTitle } from "@/components/styles";
import { PetSprite } from "../pet-sprite";

export const metadata = { title: "Memory book" };

const CAUSES: readonly DeathCause[] = ["hunger", "sickness", "old-age"];

/** Phase 47: every pet this person has had, newest first. Their own book only. */
export default async function MemoriesPage() {
  const profile = await requireAppOn("pet");
  const memories = await getMyMemories(profile.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Link href="/pet" className={backLink}>
        ← Back to your pet
      </Link>
      <h1 className={pageTitle}>Memory book</h1>
      {memories.length === 0 ? (
        <p className="text-muted-foreground">No pages yet. Every pet you raise gets a page here.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {memories.map((memory) => {
            const species = (SPECIES as readonly string[]).includes(memory.species) ? (memory.species as Species) : "blob";
            const stage = (STAGES as readonly string[]).includes(memory.stage) ? (memory.stage as Stage) : "adult";
            const cause = (CAUSES as readonly string[]).includes(memory.cause) ? (memory.cause as DeathCause) : "old-age";
            return (
              <li key={memory.id} className={`${card} flex items-center gap-3`}>
                <PetSprite species={species} stage={stage} form={memory.form} mood="content" pose="idle" className="w-20 shrink-0" />
                <div>
                  <h2 className="text-lg font-extrabold">{memory.name}</h2>
                  <p className="text-sm">{memoryLine(memory.name, memory.ageMinutes, formName(species, stage, memory.form), cause)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {memory.goneAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
