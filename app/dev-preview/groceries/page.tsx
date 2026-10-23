import { notFound } from "next/navigation";
import { AddBox } from "@/app/(app)/groceries/add-box";
import { ListRow, type ListRowItem } from "@/app/(app)/groceries/list-row";
import { ItemSheetForm } from "@/app/(app)/groceries/item-sheet-form";
import { STARTING_SECTIONS } from "@/lib/groceries/sections";

// Phase 22 harness: the add box, list rows and item sheet with sample data, for screenshots
// without signing in. Dev only, like the other dev-preview pages. The buttons call the real
// actions, which need a signed-in profile — render-only. `?sheet=1` opens the item sheet.
const rows: ListRowItem[] = [
  { id: "1", quantity: 1, done: false, requestedBy: { firstName: "Ivy" }, product: { name: "Dog food", sizeAmount: 31.1, sizeUnit: "lb", container: "bag", group: { emoji: "🐾" } } },
  { id: "2", quantity: 2, done: false, requestedBy: null, product: { name: "Paper towels", sizeAmount: 12, sizeUnit: "rolls", container: "pack", group: { emoji: "🧽" } } },
  { id: "3", quantity: 1, done: false, requestedBy: null, product: { name: "Goldfish crackers", sizeAmount: null, sizeUnit: null, container: null, group: { emoji: "🍿" } } },
  { id: "4", quantity: 1, done: true, requestedBy: null, product: { name: "Milk", sizeAmount: 1, sizeUnit: "gal", container: "jug", group: { emoji: "🥛" } } },
];

export default async function GroceriesPreviewPage({ searchParams }: { searchParams: Promise<{ sheet?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const sheet = (await searchParams).sheet === "1";
  return (
    <div className="graph-paper min-h-screen space-y-6 bg-muted p-4 sm:p-6">
      <h1 className="text-4xl font-extrabold">Groceries preview</h1>
      <AddBox />
      <section>
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted-foreground">Costco</h2>
        <ul className="mt-2 divide-y-2 divide-dashed divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink bg-card shadow-[3px_3px_0_rgb(31_41_51/0.15)]">
          {rows.map((r) => (
            <ListRow key={r.id} item={r} href="/dev-preview/groceries?sheet=1" />
          ))}
        </ul>
      </section>
      {sheet && (
        <ItemSheetForm
          product={{ id: "p", name: "Dog food", brand: "Purina Pro Plan", imageUrl: null, barcode: "0038100194839", sizeAmount: 31.1, sizeUnit: "lb", container: "bag", defaultStoreId: "s1", groupId: "g10" }}
          stores={[{ id: "s1", name: "Costco" }, { id: "s2", name: "Target" }]}
          sections={STARTING_SECTIONS.map((s, i) => ({ id: `g${i}`, name: s.name, emoji: s.emoji }))}
          usualText="1 bag every ~5 weeks · from 4 trips"
          listRow={{ id: "1", requestedById: "k" }}
          members={[{ id: "m", firstName: "Mom" }, { id: "k", firstName: "Ivy" }]}
          others={[{ id: "o", name: "Dog treats" }]}
          canTidy
          returnTo="/groceries"
        />
      )}
    </div>
  );
}
