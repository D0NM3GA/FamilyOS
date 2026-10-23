import { formatMonthDay } from "@/lib/format";
import type { DueResult } from "./due-status";

/**
 * Server-only formatting for a DueResult's date axis — must be computed here and passed
 * down as a plain string, never inside the client MaintenanceItemCard. Same reasoning as
 * lib/format.ts's formatTimeOfDay: a client component renders once on the server (Node's
 * timezone/locale) and again on hydration (the browser's), and formatting a Date there
 * risks a mismatch between the two.
 */
export function formatDueDetail(due: DueResult): string | null {
  const parts: string[] = [];

  if (due.milesRemaining != null) {
    const abs = Math.abs(due.milesRemaining).toLocaleString();
    parts.push(due.milesRemaining <= 0 ? `${abs} mi overdue` : `${abs} mi left`);
  }

  if (due.dueByDate != null && due.daysRemaining != null) {
    const label = formatMonthDay(due.dueByDate.getMonth() + 1, due.dueByDate.getDate());
    parts.push(
      due.daysRemaining <= 0
        ? `${label} (${Math.abs(due.daysRemaining)}d overdue)`
        : `by ${label} (${due.daysRemaining}d left)`,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

type LastDone = { lastDoneMileage: number | null; lastDoneAt: Date | null };

/** "45,100 mi · Jun 1", or null if never serviced — the bare detail, for the print table. */
export function formatLastDoneDetail(item: LastDone): string | null {
  if (item.lastDoneAt == null && item.lastDoneMileage == null) return null;

  const bits: string[] = [];
  if (item.lastDoneMileage != null) bits.push(`${item.lastDoneMileage.toLocaleString()} mi`);
  if (item.lastDoneAt != null) {
    bits.push(formatMonthDay(item.lastDoneAt.getMonth() + 1, item.lastDoneAt.getDate()));
  }
  return bits.join(" · ");
}

export function formatLastDone(item: LastDone): string {
  const detail = formatLastDoneDetail(item);
  return detail == null ? "Never serviced" : `Last done ${detail}`;
}

export function formatInterval(item: { intervalMiles: number | null; intervalMonths: number | null }): string {
  const bits: string[] = [];
  if (item.intervalMiles != null) bits.push(`${item.intervalMiles.toLocaleString()} mi`);
  if (item.intervalMonths != null) bits.push(`${item.intervalMonths} mo`);
  return bits.length === 2 ? `Every ${bits[0]} or ${bits[1]}` : `Every ${bits[0]}`;
}

// Hoisted to the kernel lib/format.ts in Phase 13 (the print kernel needs it too);
// re-exported so vehicles callers are unchanged.
export { formatFullDate } from "@/lib/format";

/** "Apr 11, 2020" from an "YYYY-MM-DD" string (NHTSA recall report dates), or "" if null. */
export function formatISODate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${formatMonthDay(m, d)}, ${y}`;
}

export function formatMpg(mpg: number | null): string {
  return mpg == null ? "—" : mpg.toFixed(1);
}
