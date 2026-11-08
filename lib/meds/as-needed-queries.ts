import { prisma } from "@/lib/prisma";
import { dosesLeft, nextAllowed, whenWords } from "./as-needed";

/**
 * Phase 65a: the household's as-needed medicines with what their row says: when the last dose
 * was, whether one may be taken now, and the doses left. Shaped for the client row
 * (components/meds/as-needed-row.tsx): words, not dates, so the times are the household's.
 */
export type AsNeededView = {
  definitionId: string;
  title: string;
  notes: string | null;
  person: { id: string; firstName: string } | null;
  status: string;
  canTakeNow: boolean;
  dosesLeft: string | null;
  last: { id: string; byId: string | null; words: string } | null;
};

const HOUR = 3_600_000;
const LAST_DOSE_DAYS = 90;

export async function getAsNeeded(
  householdId: string,
  opts: { personId?: string; now?: Date } = {},
): Promise<AsNeededView[]> {
  const now = opts.now ?? new Date();
  const defs = await prisma.taskDefinition.findMany({
    where: {
      householdId,
      domain: "MED",
      frequencyType: "AS_NEEDED",
      active: true,
      ...(opts.personId ? { assignees: { some: { id: opts.personId } } } : {}),
    },
    select: {
      id: true,
      title: true,
      notes: true,
      assignees: { select: { id: true, firstName: true }, take: 1 },
      medication: {
        select: {
          minGapHours: true,
          maxPerDay: true,
          quantityOnHand: true,
          doseAmount: true,
        },
      },
    },
    orderBy: { title: "asc" },
  });
  if (defs.length === 0) return [];
  // Enough history for the longest gap and the 24 hours, plus the very last dose of each.
  const longest = Math.max(
    24,
    ...defs.map((d) => d.medication?.minGapHours ?? 0),
  );
  const [recent, lastOnes] = await Promise.all([
    prisma.taskInstance.findMany({
      where: {
        definitionId: { in: defs.map((d) => d.id) },
        status: "DONE",
        completedAt: { gt: new Date(now.getTime() - longest * HOUR) },
      },
      select: { definitionId: true, completedAt: true },
    }),
    prisma.taskInstance.findMany({
      // Bounded: Prisma's distinct runs in memory, so not every dose ever. Older reads "not lately".
      where: { definitionId: { in: defs.map((d) => d.id) }, status: "DONE", completedAt: { gt: new Date(now.getTime() - LAST_DOSE_DAYS * 24 * HOUR) } },
      orderBy: { completedAt: "desc" },
      distinct: ["definitionId"],
      select: {
        id: true,
        definitionId: true,
        completedAt: true,
        completedById: true,
        completedBy: { select: { firstName: true } },
      },
    }),
  ]);
  const lastOf = new Map(lastOnes.map((l) => [l.definitionId, l]));
  return defs.map((d) => {
    const rules = {
      minGapHours: d.medication?.minGapHours ?? null,
      maxPerDay: d.medication?.maxPerDay ?? null,
    };
    const next = nextAllowed(
      recent.filter((r) => r.definitionId === d.id).map((r) => r.completedAt!),
      rules,
      now,
    );
    const last = lastOf.get(d.id);
    const left = dosesLeft(
      d.medication?.quantityOnHand ?? null,
      d.medication?.doseAmount ?? null,
    );
    const lastWords = last?.completedAt
      ? `Last taken ${whenWords(last.completedAt, now)}${last.completedBy ? ` (${last.completedBy.firstName})` : ""}`
      : "Not taken lately";
    return {
      definitionId: d.id,
      title: d.title,
      notes: d.notes,
      person: d.assignees[0] ?? null,
      status: next.ok
        ? `${lastWords} · can take now`
        : `${lastWords} · next from ${whenWords(next.from, now)}`,
      canTakeNow: next.ok,
      dosesLeft:
        left == null ? null : `${left} ${left === 1 ? "dose" : "doses"} left`,
      // Undo is for a slip: the last dose, within a day.
      last:
        last?.completedAt &&
        now.getTime() - last.completedAt.getTime() < 24 * HOUR
          ? { id: last.id, byId: last.completedById, words: lastWords }
          : null,
    };
  });
}
