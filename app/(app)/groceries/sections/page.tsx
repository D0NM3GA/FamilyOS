import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDown, ArrowUp } from "lucide-react";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { ensureStartingSections } from "@/lib/groceries/queries";
import { sectionsWithCounts } from "@/lib/groceries/section-edits";
import { itemCount, MAX_SECTIONS } from "@/lib/groceries/sections";
import { PageHeader } from "@/components/page-header";
import { AddRow, RemoveAndMove, RenameFields } from "@/components/list-editing";
import { backLink, card } from "@/components/styles";
import { addSection, moveSection, removeSection, renameSection } from "./actions";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

export const metadata: Metadata = { title: "Store sections" };

// Always 44px: the arrows sit side by side and are easy to miss with a thumb.
const arrow =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground ring-1 ring-input transition hover:bg-muted hover:text-foreground disabled:opacity-30";

/** "Its 18 items move to", "Its 1 item moves to". */
function moveQuestion(name: string, items: number) {
  if (items === 0) return `Remove ${name}? Anything in it moves to`;
  return `Remove ${name}? Its ${itemCount(items).toLowerCase()} ${items === 1 ? "moves" : "move"} to`;
}

/**
 * Phase 37: the family's store sections, in the order they walk the store. Rename, reorder,
 * add and remove; a removed section's items move where the family says. Grown-ups only, like
 * the item sheet's tidy-up tools.
 */
export default async function StoreSectionsPage() {
  await requireAppOn("groceries");
  const profile = await requireActiveProfile();
  if (!isAdult(profile)) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <Link href="/groceries/pantry" className={backLink}>
          ← Pantry
        </Link>
        <p className="mt-2 text-muted-foreground">Store sections are a grown-up job.</p>
      </div>
    );
  }

  await ensureStartingSections(profile.householdId);
  const sections = await sectionsWithCounts(profile.householdId);

  return (
    <div className="mx-auto max-w-2xl p-4 pb-24 sm:p-6">
      <Link href="/groceries/pantry" className={backLink}>
        ← Pantry
      </Link>
      <PageHeader title="🗂️ Store sections" className="mt-1" />
      <p className="text-muted-foreground">The order you walk the store. Shop view lists each store&apos;s items in this order.</p>

      <ol className={`mt-4 divide-y-2 divide-dashed divide-ink/10 dark:divide-white/10 ${card} py-1`}>
        {sections.map((s, i) => {
          const others = sections.filter((o) => o.id !== s.id);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="flex shrink-0 gap-1">
                <form action={moveSection.bind(null, s.id, "up")}>
                  <SubmitButton disabled={i === 0} aria-label={`Move ${s.name} up`} className={arrow}>
                    <ArrowUp aria-hidden className="size-5" />
                  </SubmitButton>
                </form>
                <form action={moveSection.bind(null, s.id, "down")}>
                  <SubmitButton disabled={i === sections.length - 1} aria-label={`Move ${s.name} down`} className={arrow}>
                    <ArrowDown aria-hidden className="size-5" />
                  </SubmitButton>
                </form>
              </div>
              <RenameFields key={`${s.name}|${s.emoji ?? ""}`} action={renameSection.bind(null, s.id)} name={s.name} emoji={s.emoji} label={s.name} />
              <span className="min-w-16 text-sm text-muted-foreground">{itemCount(s.items)}</span>
              {/* The last one stays: with none, the starting sections would come back. */}
              {others.length > 0 && (
                <RemoveAndMove
                  action={removeSection.bind(null, s.id)}
                  trigger="Remove"
                  question={moveQuestion(s.name, s.items)}
                  options={[{ value: "", label: "No section" }, ...others.map((o) => ({ value: o.id, label: `${o.emoji ?? ""} ${o.name}`.trim() }))]}
                  defaultValue=""
                  yes="Remove"
                />
              )}
            </li>
          );
        })}
      </ol>
      {/* Settings lists show only what can be changed (the owner's call): no badge on the last
          section, just this line once, when there's only one. */}
      {sections.length === 1 && <p className="mt-2 text-sm text-muted-foreground">Keep at least one section: rename this one to make it yours.</p>}

      <section className={`mt-4 ${card}`}>
        <h2 className="font-extrabold">Add a section</h2>
        {sections.length >= MAX_SECTIONS ? (
          <p className="mt-1 text-sm text-muted-foreground">That&apos;s a lot of sections already. Remove one you don&apos;t need first.</p>
        ) : (
          <div className="mt-2">
            <AddRow action={addSection} namePlaceholder="Deli, Flowers…" nameLabel="New section name" />
          </div>
        )}
      </section>
    </div>
  );
}
