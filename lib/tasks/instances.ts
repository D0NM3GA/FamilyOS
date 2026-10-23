import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { withStoredDays } from "@/lib/household-zone";
import type { TaskDomain } from "@/app/generated/prisma/enums";
import {
  atMidnight,
  expandTimesOfDay,
  generateOccurrences,
  type FrequencyType,
  type RecurrenceRule,
} from "./schedule";
import { pickAssignee, type AssignmentStrategyValue, type PriorInstance } from "./assignment";

export type TaskDefinitionLike = {
  frequencyType: FrequencyType;
  startDate: Date;
  interval: number | null;
  daysOfWeek: number[];
  timesOfDay: string[];
  assignmentStrategy: AssignmentStrategyValue;
};

export type PlannedInstance = { dueDate: Date; assignedToId: string | null };

/**
 * Pure planning step for ensureInstancesGenerated below — no Prisma. Given a definition,
 * its recent instances (any order, any length — used both to bound the roll-forward start
 * and as ROUND_ROBIN/LEAST_ASSIGNED history), today, and a horizon, returns the new
 * instances to create.
 *
 * When there are existing instances, regenerates from `min(latest's calendar day, today)`
 * rather than "the day after latest" or an unconditional "latest's day":
 * - A multi-dose (meds) definition's `latest` might be today's 08:00 dose while today's
 *   20:00 dose doesn't exist yet — starting the day after would skip it entirely.
 * - Editing a definition (app/(app)/meds/actions.ts's updateTaskDefinition) deletes future
 *   PENDING instances so the new schedule can regenerate, but leaves already-DONE ones in
 *   place. If a dose further out than today was completed early, it can end up as `latest`
 *   even though everything between today and it was just deleted — anchoring only at
 *   `latest`'s day would leave that gap permanently unfilled, since nothing here ever
 *   looks backward from its start point. Flooring at `today` closes that gap: on the next
 *   call, `from` never lands later than today, so every day from today onward gets
 *   reconsidered, and `existingTimes` (below) is what makes reconsidering already-created
 *   days a no-op rather than a duplicate or a re-counted history entry — see
 *   lib/tasks/instances.test.ts for both the LEAST_ASSIGNED corruption case and the
 *   edit-created-gap case this covers.
 *
 * With no existing instances at all, starts at `startDate` as always (a definition that
 * hasn't started yet shouldn't generate instances before it does).
 */
export function planInstances(
  def: TaskDefinitionLike,
  existing: PriorInstance[],
  assigneeIds: string[],
  today: Date,
  horizon: Date,
): PlannedInstance[] {
  const rule: RecurrenceRule = {
    frequencyType: def.frequencyType,
    startDate: def.startDate,
    interval: def.interval,
    daysOfWeek: def.daysOfWeek,
  };

  const latest = existing.reduce<Date | null>(
    (max, i) => (!max || i.dueDate > max ? i.dueDate : max),
    null,
  );
  const todayMid = atMidnight(today);
  const from = latest ? (atMidnight(latest) < todayMid ? atMidnight(latest) : todayMid) : def.startDate;

  const dayOccurrences = generateOccurrences(rule, { from, to: horizon });
  const dueDates = expandTimesOfDay(dayOccurrences, def.timesOfDay);
  if (dueDates.length === 0) return [];

  const existingTimes = new Set(existing.map((i) => i.dueDate.getTime()));
  const history = existing.slice();
  const planned: PlannedInstance[] = [];

  for (const dueDate of dueDates) {
    if (existingTimes.has(dueDate.getTime())) continue;
    const assignedToId = pickAssignee(def.assignmentStrategy, assigneeIds, history);
    planned.push({ dueDate, assignedToId });
    history.push({ assignedToId, dueDate });
  }

  return planned;
}

/**
 * On-demand roll-forward: for every active TaskDefinition in the household, generate any
 * missing TaskInstance rows up to `horizon` (see planInstances above for exactly where
 * that roll-forward starts). Called at read time from the board — there's no cron.
 *
 * Takes `domain` explicitly (rather than generating every domain in one pass) so a
 * Meds/Vehicle board's read doesn't pay for — or accidentally roll forward — Chores
 * instances it has no opinion on, and vice versa.
 */
export async function ensureInstancesGenerated(householdId: string, horizon: Date, domain: TaskDomain) {
  // Most board reads have nothing to add, so they stay outside a transaction. Rows to write are
  // planned again under the stored-days lock (Phase 49): a zone move in between would otherwise
  // leave them in the old zone.
  if ((await plannedRows(prisma, householdId, horizon, domain)).length === 0) return;
  await withStoredDays(async (tx) => {
    const rows = await plannedRows(tx, householdId, horizon, domain);
    // Two boards rendering at once can plan the same rows; the (definitionId, dueDate) unique
    // index keeps one of each.
    if (rows.length > 0) await tx.taskInstance.createMany({ data: rows, skipDuplicates: true });
  });
}

type Db = Prisma.TransactionClient | typeof prisma;

async function plannedRows(db: Db, householdId: string, horizon: Date, domain: TaskDomain) {
  const definitions = await db.taskDefinition.findMany({
    where: { householdId, active: true, domain },
    include: { assignees: { select: { id: true } } },
  });
  if (definitions.length === 0) return [];

  const histories = await recentInstances(db, definitions.map((d) => d.id));
  const today = new Date();
  return definitions.flatMap((def) =>
    planInstances(def, histories.get(def.id) ?? [], def.assignees.map((a) => a.id), today, horizon).map((p) => ({
      definitionId: def.id,
      ...p,
    })),
  );
}

/** How many past instances the assignment rotation looks back over: plenty for a family. */
const HISTORY_WINDOW = 60;

/**
 * Each definition's latest instances, newest first. One query that walks the
 * (definitionId, dueDate) index backwards per definition: a nested `take` on the Prisma
 * include isn't pushed into SQL, so it loaded every instance ever and trimmed in memory.
 */
async function recentInstances(db: Db, definitionIds: string[]): Promise<Map<string, PriorInstance[]>> {
  const rows = await db.$queryRaw<{ definitionId: string; dueDate: Date; assignedToId: string | null }[]>`
    SELECT d.id AS "definitionId", i."dueDate", i."assignedToId"
    FROM unnest(${definitionIds}::text[]) AS d(id)
    CROSS JOIN LATERAL (
      SELECT "dueDate", "assignedToId" FROM task_instance
      WHERE "definitionId" = d.id
      ORDER BY "dueDate" DESC
      LIMIT ${HISTORY_WINDOW}
    ) AS i`;
  const byDefinition = new Map<string, PriorInstance[]>();
  for (const { definitionId, dueDate, assignedToId } of rows) {
    const list = byDefinition.get(definitionId) ?? [];
    list.push({ dueDate, assignedToId });
    byDefinition.set(definitionId, list);
  }
  return byDefinition;
}
