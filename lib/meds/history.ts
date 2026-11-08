import { prisma } from "@/lib/prisma";
import { isAdult, type RoleBearing } from "@/lib/roles";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { formatTimeOfDay } from "@/lib/format";

/**
 * Phase 65a: one medicine's doses over the last 90 days, newest first, grouped by day, for its
 * history page and the printout for a doctor visit. Grown-ups, or the medicine's own person (the
 * Meds board is household-wide; a history isn't). Times are the household's (server time).
 */
export const HISTORY_DAYS = 90;

export type DoseLine = {
  id: string;
  time: string;
  what: "Taken" | "Skipped" | "Not marked";
  who: string | null;
};
export type DoseDay = { day: string; doses: DoseLine[] };

type Viewer = RoleBearing & { id: string; householdId: string };

export async function doseHistory(
  definitionId: string,
  viewer: Viewer,
  now: Date = new Date(),
) {
  if (typeof definitionId !== "string" || definitionId.length > 64) return null;
  const definition = await prisma.taskDefinition.findFirst({
    where: { id: definitionId, householdId: viewer.householdId, domain: "MED" },
    select: {
      id: true,
      title: true,
      notes: true,
      frequencyType: true,
      assignees: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!definition) return null;
  if (!isAdult(viewer) && !definition.assignees.some((a) => a.id === viewer.id))
    return null;
  const since = addDays(atMidnight(now), -HISTORY_DAYS);
  const rows = await prisma.taskInstance.findMany({
    // An as-needed dose's time is when it was taken; a scheduled one's, when it was due.
    where: definition.frequencyType === "AS_NEEDED" ? { definitionId: definition.id, status: "DONE", completedAt: { gte: since, lte: now } } : { definitionId: definition.id, dueDate: { gte: since, lte: now } },
    orderBy: definition.frequencyType === "AS_NEEDED" ? [{ completedAt: "desc" }] : [{ dueDate: "desc" }],
    select: {
      id: true,
      dueDate: true,
      status: true,
      completedAt: true,
      completedBy: { select: { firstName: true } },
    },
  });
  const days: DoseDay[] = [];
  for (const r of rows) {
    const at =
      r.status === "DONE" && definition.frequencyType === "AS_NEEDED"
        ? (r.completedAt ?? r.dueDate)
        : r.dueDate;
    const day = at.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const line: DoseLine = {
      id: r.id,
      time: formatTimeOfDay(at),
      what:
        r.status === "DONE"
          ? "Taken"
          : r.status === "SKIPPED"
            ? "Skipped"
            : "Not marked",
      who: r.status === "DONE" ? (r.completedBy?.firstName ?? null) : null,
    };
    const last = days[days.length - 1];
    if (last && last.day === day) last.doses.push(line);
    else days.push({ day, doses: [line] });
  }
  return {
    definition,
    days,
    taken: rows.filter((r) => r.status === "DONE").length,
  };
}
