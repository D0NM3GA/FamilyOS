import Link from "next/link";
import type { Metadata } from "next";
import { requireJar } from "@/lib/finance/access";
import { todayCivil } from "@/lib/finance/budget";
import { chargeCount, keyNote, removalNote } from "@/lib/finance/categories";
import { categoriesForEditing } from "@/lib/finance/category-edits";
import { PageHeader } from "@/components/page-header";
import { AddRow, RemoveAndMove, RenameFields } from "@/components/list-editing";
import { backLink, card, sectionTitle } from "@/components/styles";
import { addCategory, removeCategory, renameCategory } from "./actions";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Categories" };

type Row = Awaited<ReturnType<typeof categoriesForEditing>>[number];

const GROUPS = [
  { kind: "SPEND", title: "Spending", note: null },
  { kind: "INCOME", title: "Income", note: null },
  { kind: "TRANSFER", title: "Transfers", note: "Never counted as spending." },
] as const;

const label = (c: { name: string; emoji: string | null }) => `${c.emoji ?? ""} ${c.name}`.trim();

/** "its 5 charges, its budget and its rules": only what it has. Budget and saving up are spelled out per pick (removalNote). */
function whatMoves(c: Row): string[] {
  return [
    c.charges > 0 ? `its ${chargeCount(c.charges).toLowerCase()}` : null,
    c.budgetCents != null ? "its budget" : null,
    c.rules > 0 ? `its ${c.rules === 1 ? "rule" : "rules"}` : null,
  ].filter((p): p is string => p != null);
}

function moveQuestion(c: Row): string {
  const parts = whatMoves(c);
  if (parts.length === 0) return `Remove ${c.name}? Anything in it moves to`;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Move ${list} to`;
}

/**
 * Phase 37: the jar's own categories. Any member renames, adds and removes them; everyone in
 * the jar sees the change, and it goes in the jar's history. Other, Income and Transfers can be
 * renamed but not removed; the owner's call is that settings lists show only what can be
 * changed, so their rows simply have no Remove and the intro says why once. Counts are the
 * charges this viewer can see.
 */
export default async function JarCategoriesPage({ params }: { params: Promise<{ jarId: string }> }) {
  await requireAppOn("money");
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);
  const categories = await categoriesForEditing(jar.id, viewer.id, todayCivil());

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-24 sm:p-6">
      <Link href={`/finances/${jar.id}/settings`} className={`${backLink} self-start`}>
        ← Jar settings
      </Link>
      <div>
        <PageHeader title="🏷️ Categories" />
        <p className="mt-1 text-muted-foreground">
          Just for this jar; everyone in it sees the change. Renaming keeps every charge, budget and &ldquo;always for this store&rdquo; rule.
          Removing one moves its charges and rules to the category you pick.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Other, Income and Transfers can be renamed but not removed: the app counts on them.</p>
      </div>

      {GROUPS.map((g) => {
        const rows = categories.filter((c) => c.kind === g.kind);
        if (rows.length === 0) return null;
        return (
          <section key={g.kind} className={card} aria-labelledby={`group-${g.kind}`}>
            <h2 id={`group-${g.kind}`} className={sectionTitle}>
              {g.title}
            </h2>
            {g.note && <p className="text-sm text-muted-foreground">{g.note}</p>}
            <ul className="mt-1 divide-y-2 divide-dashed divide-ink/10 dark:divide-white/10">
              {rows.map((c) => {
                const targets = rows.filter((t) => t.id !== c.id);
                const fallback = targets.find((t) => t.builtIn) ?? targets[0];
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <RenameFields key={`${c.name}|${c.emoji ?? ""}`} action={renameCategory.bind(null, jar.id, c.id)} name={c.name} emoji={c.emoji} label={c.name} />
                    <span className="min-w-20 text-sm text-muted-foreground">{chargeCount(c.charges)}</span>
                    {!c.builtIn && fallback && (
                      <RemoveAndMove
                        action={removeCategory.bind(null, jar.id, c.id)}
                        trigger="Remove…"
                        question={moveQuestion(c)}
                        options={targets.map((t) => ({ value: t.id, label: label(t), note: removalNote(c, t) }))}
                        defaultValue={fallback.id}
                        yes="Move and remove"
                        note={keyNote(c)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className={card}>
        <h2 className="font-extrabold">Add a category</h2>
        <p className="text-sm text-muted-foreground">New spending categories go just before Other.</p>
        <div className="mt-2">
          <AddRow
            action={addCategory.bind(null, jar.id)}
            namePlaceholder="Pets, School…"
            nameLabel="New category name"
            choice={{
              name: "kind",
              label: "Kind of category",
              options: [
                { value: "SPEND", label: "Spending" },
                { value: "INCOME", label: "Income" },
              ],
            }}
          />
        </div>
      </section>
    </div>
  );
}
