import type { DueResult } from "@/lib/vehicles/due-status";
import { formatDueDetail, formatFullDate, formatInterval, formatLastDone } from "@/lib/vehicles/format";
import { formatQuantity, isSupplyLow } from "@/lib/vehicles/supplies";
import type { MaintenanceItem } from "@/components/vehicles/maintenance-item-card";

/**
 * Board row -> the plain, pre-formatted props MaintenanceItemCard takes. Shared by the
 * board and the per-vehicle detail page so both render an item identically; all date
 * formatting stays server-side (see lib/vehicles/format.ts).
 */
export function toCardItem(
  item: {
    id: string;
    title: string;
    notes: string | null;
    intervalMiles: number | null;
    intervalMonths: number | null;
    lastDoneMileage: number | null;
    lastDoneAt: Date | null;
    kind?: string;
    supplies?: {
      quantity: number;
      supply: { name: string; unit: string | null; quantityOnHand: number | null; lowThreshold: number | null; active: boolean };
    }[];
  },
  due: DueResult,
  currentMileage: number,
): MaintenanceItem {
  return {
    id: item.id,
    title: item.title,
    notes: item.notes,
    status: due.status,
    intervalLabel: formatInterval(item),
    // Paperwork is renewed, and its odometer reading means nothing.
    lastDoneLabel: item.kind === "PAPERWORK" ? (item.lastDoneAt ? `Renewed ${formatFullDate(item.lastDoneAt)}` : "Not renewed yet") : formatLastDone(item),
    // Never logged: say how to start, rather than nothing.
    dueDetail: due.status === "UNKNOWN" ? "Log when it was last done to start counting" : formatDueDetail(due),
    hasHistory: item.lastDoneAt != null || item.lastDoneMileage != null,
    currentMileageLabel: String(currentMileage),
    paperwork: item.kind === "PAPERWORK",
    supplies: (item.supplies ?? [])
      .filter((s) => s.supply.active)
      .map((s) => ({
        label: `${formatQuantity(s.quantity, s.supply.unit)} ${s.supply.name}`,
        onHand: s.supply.quantityOnHand == null ? null : formatQuantity(s.supply.quantityOnHand, s.supply.unit),
        low: isSupplyLow(s.supply.quantityOnHand, s.supply.lowThreshold),
      })),
  };
}
