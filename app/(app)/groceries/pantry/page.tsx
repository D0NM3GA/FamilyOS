import Link from "next/link";
import Form from "next/form";
import type { Metadata } from "next";
import { requireActiveProfile } from "@/lib/active-profile";
import { ensureStartingSections, getPantryItems, getSections, getUsuals } from "@/lib/groceries/queries";
import { getLastPrices, type LastPrice } from "@/lib/groceries/receipts";
import { formatMoney } from "@/lib/money";
import { isAdult } from "@/lib/authz";
import { amountLabel, describeSize, needsSize } from "@/lib/groceries/size";
import { describeEvery } from "@/lib/groceries/usual";
import { createPantryItem } from "../actions";
import { ItemSheet } from "../item-sheet";
import { backLink, btn, btnPrimary, chip, chipRow, field } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

export const metadata: Metadata = { title: "Pantry" };

const sticker = "inline-block -rotate-1 rounded-md bg-sun px-1.5 text-xs font-bold text-ink";

/**
 * Phase 22: the Pantry, everything the family buys. A tidy-up page, not an inventory: no
 * stock counts. "Needs details" shows exactly what's missing per item so a two-minute
 * tidy-up does it. Anyone can fill details in; merging and removing are on the item sheet,
 * grown-ups only, and so is the Store sections page (Phase 37) linked from here.
 */
export default async function PantryPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string | string[]; filter?: string | string[]; q?: string | string[] }>;
}) {
  await requireAppOn("groceries");
  const profile = await requireActiveProfile();
  const params = await searchParams;
  const sheetId = typeof params.item === "string" ? params.item : null;
  const filter = typeof params.filter === "string" ? params.filter : "all";
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";

  await ensureStartingSections(profile.householdId);
  // Prices are money: grown-ups only (Phase 24).
  const adult = isAdult(profile);
  const [items, sections, usuals, prices] = await Promise.all([
    getPantryItems(profile.householdId, q),
    getSections(profile.householdId),
    getUsuals(profile.householdId),
    adult ? getLastPrices(profile.householdId) : Promise.resolve(new Map<string, LastPrice>()),
  ]);

  const rows = items.map((p) => ({ ...p, size: describeSize(p), usual: usuals.get(p.id), price: prices.get(p.id) }));
  const needsDetails = (r: (typeof rows)[number]) => needsSize(r) || !r.defaultStore;
  const needsCount = rows.filter(needsDetails).length;
  const shown = rows.filter((r) => (filter === "needs" ? needsDetails(r) : filter === "all" ? true : r.groupId === filter));
  const usedSections = sections.filter((s) => rows.some((r) => r.groupId === s.id));

  // Every link keeps the other half: a chip keeps the search, clearing the search keeps the chip.
  const pantryHref = (opts: { filter: string; q: string; item?: string }) => {
    const query = new URLSearchParams();
    if (opts.filter !== "all") query.set("filter", opts.filter);
    if (opts.q) query.set("q", opts.q);
    if (opts.item) query.set("item", opts.item);
    const s = query.toString();
    return s ? `/groceries/pantry?${s}` : "/groceries/pantry";
  };

  const filterChip = (key: string, text: string) => (
    <Link key={key} href={pantryHref({ filter: key, q })} aria-current={filter === key ? "page" : undefined} className={chip}>
      {text}
    </Link>
  );

  return (
    <div className="p-4 pb-24 sm:p-6">
      <Link href="/groceries" className={backLink}>
        ← Back to the list
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-extrabold">Pantry</h1>
          <p className="text-muted-foreground">Everything the family buys. Tidy it up when you feel like it.</p>
          {/* Phase 37: rename, reorder, add and remove sections. Grown-ups only. */}
          {adult && (
            <Link href="/groceries/sections" className={`${btn} mt-2`}>
              🗂️ Store sections
            </Link>
          )}
        </div>
        <form action={createPantryItem} className="flex w-full gap-2 sm:w-auto">
          <input name="name" required maxLength={120} placeholder="Something new…" aria-label="New Pantry item" className={`${field} min-w-0 flex-1 sm:w-44 sm:flex-none`} />
          <SubmitButton className={`${btnPrimary} shrink-0`}>
            + Add
          </SubmitButton>
        </form>
      </div>

      {/* A GET form: the search lives in the URL (?q=), so Back and a shared link keep it. */}
      <Form action="/groceries/pantry" replace scroll={false} role="search" className="mt-4 flex gap-2">
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        {/* Keyed on the search: Clear and Back change the URL, and the box must follow it. */}
        <input
          key={q}
          type="search"
          name="q"
          defaultValue={q}
          maxLength={120}
          enterKeyHint="search"
          placeholder="Find in the Pantry…"
          aria-label="Find in the Pantry"
          className={`${field} min-w-0 flex-1 sm:max-w-xs`}
        />
        <button type="submit" className={`${btn} shrink-0`}>
          Find
        </button>
        {q && (
          <Link href={pantryHref({ filter, q: "" })} replace scroll={false} className={`${btn} shrink-0`}>
            Clear
          </Link>
        )}
      </Form>

      <nav aria-label="Filter the Pantry" className={`mt-3 ${chipRow}`}>
        {filterChip("all", `Everything ${rows.length}`)}
        {filterChip("needs", `✏️ Needs details ${needsCount}`)}
        {usedSections.map((s) => filterChip(s.id, `${s.emoji ?? ""} ${s.name}`.trim()))}
      </nav>

      {shown.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          {q
            ? filter === "all"
              ? `Nothing in the Pantry matches “${q}”. Something new? Add it with + Add above.`
              : `Nothing here matches “${q}”. Try Everything, or clear the search.`
            : filter === "needs"
              ? "Nothing needs details. Nice and tidy!"
              : "Nothing here yet. Things you add to the list show up here."}
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border-2 border-ink bg-card shadow-[3px_3px_0_rgb(31_41_51/0.15)] dark:border-white/20">
          <div className="hidden grid-cols-[2.25rem_1.6fr_1fr_1fr_1fr_1fr] gap-3 border-b-2 border-ink/10 px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground md:grid">
            <span />
            <span>Item</span>
            <span>How it comes</span>
            <span>Where</span>
            <span>Section</span>
            <span>{adult ? "Usually · last paid" : "Usually"}</span>
          </div>
          <ul className="divide-y-2 divide-dashed divide-ink/10 dark:divide-white/10">
            {shown.map((r) => {
              const every = describeEvery(r.usual?.everyDays ?? null);
              return (
                <li key={r.id}>
                  <Link
                    href={pantryHref({ filter, q, item: r.id })}
                    scroll={false}
                    className="grid grid-cols-[2.25rem_1fr] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted md:grid-cols-[2.25rem_1.6fr_1fr_1fr_1fr_1fr]"
                  >
                    <span className="row-span-2 flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-lg md:row-span-1" aria-hidden>
                      {r.group?.emoji ?? "🛒"}
                    </span>
                    <span className="min-w-0 truncate font-bold">
                      {r.name}
                      {r.brand && <span className="font-normal text-muted-foreground"> · {r.brand}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-sm md:contents">
                      <span>{r.size ? <span className="font-hand text-base">{r.size}</span> : <span className={sticker}>Add size</span>}</span>
                      <span>{r.defaultStore ? r.defaultStore.name : <span className={sticker}>Add store</span>}</span>
                      <span className="text-muted-foreground md:text-foreground">{r.group ? `${r.group.emoji ?? ""} ${r.group.name}`.trim() : "—"}</span>
                      <span className="text-muted-foreground">
                        {r.usual ? `${amountLabel(r.usual.quantity, r.container)}${every ? ` · ${every.replace("every ", "")}` : ""}` : "new"}
                        {r.price && <span className="font-bold text-foreground"> · {formatMoney(r.price.unitCents ?? r.price.totalCents)}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {sheetId && <ItemSheet productId={sheetId} profile={profile} returnTo={pantryHref({ filter, q })} />}
    </div>
  );
}
