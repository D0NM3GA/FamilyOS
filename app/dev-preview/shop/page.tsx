import { notFound } from "next/navigation";
import { ShopView } from "@/app/(app)/groceries/shop/shop-view";
import { KidTiles } from "@/app/(app)/groceries/kid-tiles";
import type { ShopRow } from "@/lib/groceries/shop";

// Phase 23 harness: the Shop view and a kid's picture tiles with sample data, for
// screenshots without signing in. Dev only, render-only: a tap queues locally and then tries
// the real sync action, which (signed out) redirects to sign-in. The queue survives that.
const row = (id: string, name: string, store: string, sectionOrder: number, emoji: string, extra: Partial<ShopRow> = {}): ShopRow => ({
  id,
  name,
  size: null,
  amount: "1",
  emoji,
  storeName: store,
  sectionOrder,
  forName: null,
  done: false,
  ...extra,
});

export default function ShopPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const rows = [
    row("1", "Dog food", "Costco", 10, "🐾", { size: "31.1 lb bag", amount: "1 bag", forName: "Ivy" }),
    row("2", "Paper towels", "Costco", 8, "🧽", { size: "12-roll pack", amount: "2 packs" }),
    row("3", "Bananas", "Anywhere", 0, "🥬", { size: "by the bunch", amount: "1 bunch" }),
    row("4", "Milk", "Costco", 1, "🥛", { size: "1 gal jug", amount: "1 jug", done: true }),
  ];
  return (
    <div className="graph-paper min-h-screen space-y-8 bg-muted p-4 sm:p-6">
      <div className="mx-auto max-w-2xl">
        <ShopView householdId="dev-preview" rows={rows} stores={["Costco", "Anywhere"]} />
      </div>
      <div className="mx-auto max-w-2xl">
        <KidTiles
          tiles={[
            { id: "a", name: "Goldfish crackers", imageUrl: null, emoji: "🍿" },
            { id: "b", name: "Apples", imageUrl: null, emoji: "🥬" },
            { id: "c", name: "Juice boxes", imageUrl: null, emoji: "🧃" },
            { id: "d", name: "Ice cream", imageUrl: null, emoji: "🧊" },
          ]}
        />
      </div>
    </div>
  );
}
