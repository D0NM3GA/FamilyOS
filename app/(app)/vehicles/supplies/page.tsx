import Link from "next/link";
import { getSupplies } from "@/lib/vehicles/queries";
import { formatQuantity, isSupplyLow } from "@/lib/vehicles/supplies";
import { PageHeader } from "@/components/page-header";
import { backLink, btn, btnPrimary } from "@/components/styles";
import { addSupplyStock, setSupplyActive } from "./actions";
import { StockForm } from "./stock-form";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

/**
 * Garage supplies (Phase 12.5): oil, filters, wipers, shared by every vehicle. Logging a
 * service takes what its item uses; a supply at or below "Low at" goes on the shopping
 * list. Grown-ups only, like all of Cars (lib/app-guard.ts).
 */
export default async function SuppliesPage() {
  const profile = await requireAppOn("cars");
  const supplies = await getSupplies(profile.householdId);

  return (
    <div className="p-4 sm:p-6">
      <Link href="/vehicles" className={backLink}>
        ← Cars
      </Link>
      <PageHeader className="mt-1" title="🧰 Garage">
        <Link href="/vehicles/supplies/new" className={btnPrimary}>
          + New supply
        </Link>
      </PageHeader>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Link a supply to a maintenance item (edit the item) and logging that service counts it down.
      </p>

      {supplies.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No supplies yet.</p>
      ) : (
        <ul className="mt-4 max-w-3xl divide-y divide-border overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
          {supplies.map((s) => {
            const low = s.active && isSupplyLow(s.quantityOnHand, s.lowThreshold);
            const usedBy = s.usedBy.map((u) => `${u.item.vehicle.name}: ${u.item.title}`);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className={`flex flex-wrap items-center gap-2 text-sm font-bold ${s.active ? "text-foreground" : "text-muted-foreground line-through"}`}>
                    {s.name}
                    {s.partNumber && <span className="text-xs font-normal text-muted-foreground">#{s.partNumber}</span>}
                    {low && <span className="inline-block -rotate-1 rounded-md bg-sun px-1.5 text-xs font-bold text-ink">Low</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.quantityOnHand == null ? "Not counted" : `${formatQuantity(s.quantityOnHand, s.unit)} on hand`}
                    {s.lowThreshold != null && ` · low at ${formatQuantity(s.lowThreshold, s.unit)}`}
                    {usedBy.length > 0 && ` · used by ${usedBy.join(", ")}`}
                  </p>
                  {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {s.active && s.quantityOnHand != null && (
                    <StockForm action={addSupplyStock.bind(null, s.id)} unit={s.unit} name={s.name} />
                  )}
                  <Link href={`/vehicles/supplies/${s.id}/edit`} aria-label={`Edit ${s.name}`} className={btn}>
                    Edit
                  </Link>
                  <form action={setSupplyActive.bind(null, s.id, !s.active)}>
                    <SubmitButton aria-label={`${s.active ? "Deactivate" : "Reactivate"} ${s.name}`} className={btn}>
                      {s.active ? "Deactivate" : "Reactivate"}
                    </SubmitButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
