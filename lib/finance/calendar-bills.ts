import { prisma } from "@/lib/prisma";
import { moneyViewer } from "./access";
import { todayCivil } from "./budget";
import { recurringRows } from "./bill-rows";
import { dueDays, readManualBills, standsFor, type ManualBillInput } from "./manual-bills";
import { addMonths, findRecurring, isRegularBill, type Recurring } from "./recurring";

/**
 * Phase 63b: bills on the calendar (the owner's call): their names on the days they're due,
 * only for the jars the viewer is a member of, never an amount, never which jar. The calendar
 * may import this module and nothing else from Money (eslint.config.mjs). `moneyViewer` is asked
 * here, so a kid, a switched profile or Money turned off sees nothing, whatever the caller does.
 */
export type BillDay = { day: string; name: string };

/** Regular found bills step by whole months, as findRecurring dates them (the 31st clamps). */
const STEP_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/**
 * One jar's bill days in [from, until] (civil days), names only. Pure. Found regular bills not
 * hidden and not stood for by a hand-added one, stepped from their next due day; hand-added bills'
 * own due days. A weekly or every-two-weeks subscription shows its next day only.
 */
export function billDaysOf(found: Recurring[], manual: ManualBillInput[], hidden: Set<string>, from: string, until: string): BillDay[] {
  const out: BillDay[] = [];
  const replaced = standsFor(manual, found);
  for (const r of found) {
    if (!isRegularBill(r) || hidden.has(r.key) || replaced.has(r.key) || !r.nextOn || !r.cadence) continue;
    const step = STEP_MONTHS[r.cadence];
    for (let k = 0; ; k++) {
      const d = step ? addMonths(r.nextOn, k * step) : r.nextOn;
      if (d > until) break;
      if (d >= from) out.push({ day: d, name: r.label });
      if (!step) break;
    }
  }
  for (const b of manual) for (const d of dueDays(b, from, until)) out.push({ day: d, name: b.name });
  return out;
}

/** `from` and `until` are civil days ("YYYY-MM-DD"), both included. */
export async function billDays(from: string, until: string): Promise<BillDay[]> {
  // The calendar asks only while Money is on (moneyViewer would otherwise send the page to the
  // turned-off note).
  const viewer = await moneyViewer();
  if (!viewer) return [];
  const jars = await prisma.moneyJar.findMany({
    where: { householdId: viewer.householdId, members: { some: { personId: viewer.id } } },
    select: { id: true },
  });
  const today = todayCivil();
  const perJar = await Promise.all(
    jars.map(async (jar) => {
      const [rows, marks, manual] = await Promise.all([
        recurringRows(jar.id, viewer.id, today),
        prisma.recurringMark.findMany({ where: { jarId: jar.id, status: "HIDDEN" }, select: { key: true } }),
        readManualBills(prisma, jar.id),
      ]);
      return billDaysOf(findRecurring(rows, today), manual, new Set(marks.map((m) => m.key)), from, until);
    }),
  );
  // The same bill in two jars, or found and hand-added under one name, shows once.
  const unique = new Map(perJar.flat().map((b) => [`${b.day}|${b.name}`, b]));
  return [...unique.values()].sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
}
