import { atMidnight, daysBetween } from "@/lib/tasks/schedule";

/**
 * The printable fridge chore chart (Phase 13), built from generated TaskInstance rows, not
 * from recurrence rules: under ROUND_ROBIN/LEAST_ASSIGNED the assignee for a future day is
 * only decided when the instance is generated (lib/tasks/assignment.ts), and an adult can
 * reassign a single instance to anyone (reassignInstance). The rule alone would print the
 * wrong kid. Pure, so both layouts are testable without Prisma.
 */

export type ChartInstance = {
  dueDate: Date;
  status: "PENDING" | "DONE" | "SKIPPED";
  assignedTo: { id: string; firstName: string } | null;
  definition: { id: string; title: string; points: number };
};

/** One day's cell: how many times it's due that day, and how many of those are done. */
export type ChartCell = { due: number; done: number } | null;

export type PersonChart = {
  /** null = unassigned ("Anyone"). */
  personId: string | null;
  name: string;
  rows: { definitionId: string; title: string; points: number; cells: ChartCell[] }[];
};

export type GridRow = {
  definitionId: string;
  title: string;
  points: number;
  /** Per day, who's on it: first names ("Anyone" for unassigned), with done status. */
  cells: { name: string; done: boolean }[][];
};

export const ANYONE = "Anyone";

function dayIndex(start: Date, dueDate: Date, dayCount: number): number | null {
  const i = daysBetween(start, atMidnight(dueDate));
  return i >= 0 && i < dayCount ? i : null;
}

/** One chart per person (rows = their chores, columns = days). "Anyone" last. */
export function buildPersonCharts(instances: readonly ChartInstance[], start: Date, dayCount = 7): PersonChart[] {
  const people = new Map<string, PersonChart>();

  for (const inst of instances) {
    if (inst.status === "SKIPPED") continue;
    const day = dayIndex(start, inst.dueDate, dayCount);
    if (day == null) continue;

    const key = inst.assignedTo?.id ?? "";
    let chart = people.get(key);
    if (!chart) {
      chart = { personId: inst.assignedTo?.id ?? null, name: inst.assignedTo?.firstName ?? ANYONE, rows: [] };
      people.set(key, chart);
    }
    let row = chart.rows.find((r) => r.definitionId === inst.definition.id);
    if (!row) {
      row = {
        definitionId: inst.definition.id,
        title: inst.definition.title,
        points: inst.definition.points,
        cells: Array.from({ length: dayCount }, () => null),
      };
      chart.rows.push(row);
    }
    const cell = row.cells[day] ?? { due: 0, done: 0 };
    cell.due += 1;
    if (inst.status === "DONE") cell.done += 1;
    row.cells[day] = cell;
  }

  for (const chart of people.values()) chart.rows.sort((a, b) => a.title.localeCompare(b.title));
  return [...people.values()].sort((a, b) =>
    a.personId == null ? 1 : b.personId == null ? -1 : a.name.localeCompare(b.name),
  );
}

/** One household grid (rows = chores, columns = days, cell = who). */
export function buildHouseholdGrid(instances: readonly ChartInstance[], start: Date, dayCount = 7): GridRow[] {
  const rows = new Map<string, GridRow>();

  for (const inst of instances) {
    if (inst.status === "SKIPPED") continue;
    const day = dayIndex(start, inst.dueDate, dayCount);
    if (day == null) continue;

    let row = rows.get(inst.definition.id);
    if (!row) {
      row = {
        definitionId: inst.definition.id,
        title: inst.definition.title,
        points: inst.definition.points,
        cells: Array.from({ length: dayCount }, () => []),
      };
      rows.set(inst.definition.id, row);
    }
    row.cells[day].push({ name: inst.assignedTo?.firstName ?? ANYONE, done: inst.status === "DONE" });
  }

  for (const row of rows.values()) {
    for (const cell of row.cells) cell.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...rows.values()].sort((a, b) => a.title.localeCompare(b.title));
}
