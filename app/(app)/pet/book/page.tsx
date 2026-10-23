import Link from "next/link";
import { requireAppOn } from "@/lib/app-guard";
import { getMyDiscoveries } from "@/lib/pet/queries";
import { rngFor } from "@/lib/pet/random";
import { FORMS_PER_STAGE, SPECIES, STAGES, type Species, type Stage } from "@/lib/pet/state";
import { BOOK_HINT_LINES, pickLine } from "@/lib/pet/voice";
import { formName, SPECIES_NAMES } from "@/lib/pet/words";
import { backLink, card, pageTitle } from "@/components/styles";
import { PetSprite } from "../pet-sprite";

export const metadata = { title: "Collection book" };

const GROWN_STAGES = STAGES.filter((stage) => stage !== "egg") as Exclude<Stage, "egg">[];

/** Every form a species can grow into, in the order it grows: 1 baby, 2 child, 3 teen, 4 adult. */
function formsOf(): { stage: Exclude<Stage, "egg">; form: number }[] {
  return GROWN_STAGES.flatMap((stage) => Array.from({ length: FORMS_PER_STAGE[stage] }, (_, form) => ({ stage, form })));
}

/** A hint for a form not found yet: which way of raising leads there, nothing more. */
function hintFor(species: Species, stage: Stage, form: number): string {
  const forms = FORMS_PER_STAGE[stage];
  const pool = forms === 1 ? BOOK_HINT_LINES.first : form === 0 ? BOOK_HINT_LINES.splendid : form === forms - 1 ? BOOK_HINT_LINES.scruffy : BOOK_HINT_LINES.middle;
  return pickLine(pool, rngFor(species, stage, form));
}

/**
 * Phase 54: the collection book. Every form each species can grow into: the ones this person's
 * pets have reached drawn in full, the rest as silhouettes with a hint. Read only, no prizes.
 */
export default async function BookPage() {
  const profile = await requireAppOn("pet");
  const found = await getMyDiscoveries(profile);
  const has = (species: Species, stage: Stage, form: number) =>
    found.some((entry) => entry.species === species && entry.stage === stage && entry.form === form);
  const total = formsOf().length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <Link href="/pet" className={backLink}>
        ← Back to your pet
      </Link>
      <h1 className={pageTitle}>Collection book</h1>
      <p className="text-muted-foreground">
        {found.length === 0
          ? "Every form your pets grow into gets a page here. Hatch an egg to start."
          : "Every form your pets have grown into. How you look after a pet decides what it becomes."}
      </p>
      {SPECIES.map((species) => {
        const count = formsOf().filter(({ stage, form }) => has(species, stage, form)).length;
        return (
          <section key={species} className={`${card} space-y-3`} aria-labelledby={`book-${species}`}>
            <h2 id={`book-${species}`} className="text-xl font-extrabold">
              {SPECIES_NAMES[species]}{" "}
              <span className="text-base font-bold text-muted-foreground">
                {count} of {total}
              </span>
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {formsOf().map(({ stage, form }) => {
                const known = has(species, stage, form);
                return (
                  <li key={`${stage}-${form}`} className="flex flex-col items-center gap-1 rounded-2xl bg-muted/50 p-2 text-center">
                    <PetSprite
                      species={species}
                      stage={stage}
                      form={form}
                      mood="content"
                      pose="idle"
                      className={known ? "w-20" : "w-20 opacity-25 brightness-0 dark:invert"}
                    />
                    <p className="text-sm font-extrabold">{known ? formName(species, stage, form) : "???"}</p>
                    <p className="text-xs text-muted-foreground">{known ? stage[0].toUpperCase() + stage.slice(1) : hintFor(species, stage, form)}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
