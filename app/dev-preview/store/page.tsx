import { notFound } from "next/navigation";
import { StoreShelf } from "@/app/(app)/points/store-shelf";
import { OrdersPanel } from "@/app/(app)/points/orders-panel";

// Phase 20 harness: the Sticker Store's shelf, buy dialog and orders panel with sample data,
// for screenshots without signing in. Dev only, like the other dev-preview pages. Buying
// here calls the real action, which needs a signed-in profile — render-only.
export default async function StorePreviewPage({ searchParams }: { searchParams: Promise<{ adult?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const adult = (await searchParams).adult === "1";
  const now = new Date("2026-10-03T17:00:00Z").getTime();
  return (
    <div className="graph-paper min-h-screen space-y-8 bg-muted p-6">
      <h1 className="text-4xl font-extrabold">Sticker Store preview</h1>
      {adult && (
        <section className="rounded-3xl border-2 border-ink bg-card p-4">
          <h2 className="text-xl font-extrabold">🛍️ Orders to make happen</h2>
          <OrdersPanel
            orders={[
              { id: "o1", title: "DJ in the car", emoji: "🎵", cost: 20, status: "TO_DO", createdAt: new Date(now - 120_000), who: "Ivy" },
              { id: "o2", title: "Trampoline park", emoji: "🎢", cost: 200, status: "WAITING_OK", createdAt: new Date(now - 86_400_000), who: "Rowan" },
            ]}
          />
        </section>
      )}
      <StoreShelf
        viewerId="me"
        balance={85}
        goalId="r4"
        members={adult ? [{ id: "me", firstName: "Mom", points: 30 }, { id: "k", firstName: "Ivy", points: 85 }] : undefined}
        rewards={[
          { id: "r1", title: "Pick dessert", emoji: "🍪", pointCost: 15, limitPerWeek: null, needsApproval: false },
          { id: "r2", title: "DJ in the car", emoji: "🎵", pointCost: 20, limitPerWeek: null, needsApproval: false },
          { id: "r3", title: "Skip a chore", emoji: "🛁", pointCost: 40, limitPerWeek: 1, needsApproval: false },
          { id: "r4", title: "Ice cream trip", emoji: "🍦", pointCost: 100, limitPerWeek: null, needsApproval: false },
          { id: "r5", title: "Trampoline park", emoji: "🎢", pointCost: 200, limitPerWeek: null, needsApproval: true },
        ]}
      />
    </div>
  );
}
