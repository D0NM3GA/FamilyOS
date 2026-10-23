/** Pure assignment-rotation logic — no Prisma, no I/O. */

export type AssignmentStrategyValue = "FIXED" | "ROUND_ROBIN" | "LEAST_ASSIGNED";

export type PriorInstance = {
  assignedToId: string | null;
  dueDate: Date;
};

/**
 * Picks who a new task instance should go to, given the eligible pool (ordered) and the
 * prior instances of the same TaskDefinition (any order, any length).
 */
export function pickAssignee(
  strategy: AssignmentStrategyValue,
  assigneeIds: string[],
  history: PriorInstance[],
): string | null {
  if (assigneeIds.length === 0) return null;

  switch (strategy) {
    case "FIXED":
      return assigneeIds[0];

    case "ROUND_ROBIN": {
      const mostRecent = [...history]
        .filter((h) => h.assignedToId && assigneeIds.includes(h.assignedToId))
        .sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime())[0];

      if (!mostRecent) return assigneeIds[0];

      const lastIndex = assigneeIds.indexOf(mostRecent.assignedToId as string);
      return assigneeIds[(lastIndex + 1) % assigneeIds.length];
    }

    case "LEAST_ASSIGNED": {
      const counts = new Map<string, number>(assigneeIds.map((id) => [id, 0]));
      for (const h of history) {
        if (h.assignedToId && counts.has(h.assignedToId)) {
          counts.set(h.assignedToId, (counts.get(h.assignedToId) ?? 0) + 1);
        }
      }

      let best = assigneeIds[0];
      let bestCount = counts.get(best) ?? 0;
      for (const id of assigneeIds) {
        const count = counts.get(id) ?? 0;
        if (count < bestCount) {
          best = id;
          bestCount = count;
        }
      }
      return best;
    }
  }
}
