import { prisma } from "@/lib/prisma";
import { csvDate, csvDateTime, toCsv } from "@/lib/csv";
import type { CsvExport } from "@/lib/export";
import { describeRecurrence } from "@/lib/tasks/format";

/** Chores' CSV exports (Phase 16). Points and rewards export from /points. */
export const CHORE_EXPORTS: Record<string, CsvExport> = {
  chores: {
    label: "Chores",
    description: "Every chore with its schedule, points, and who it rotates between.",
    build: async (householdId) => {
      const rows = await prisma.taskDefinition.findMany({
        where: { householdId, domain: "CHORE" },
        include: { assignees: { select: { firstName: true }, orderBy: { firstName: "asc" } } },
        orderBy: [{ active: "desc" }, { title: "asc" }],
      });
      return toCsv(
        [
          { header: "Chore", value: (r) => r.title, freeText: true },
          { header: "Notes", value: (r) => r.notes, freeText: true },
          { header: "Schedule", value: (r) => describeRecurrence(r) },
          { header: "Starts", value: (r) => csvDate(r.startDate) },
          { header: "Points", value: (r) => r.points },
          { header: "Assignment", value: (r) => r.assignmentStrategy },
          { header: "Assignees", value: (r) => r.assignees.map((a) => a.firstName).join("; "), freeText: true },
          { header: "Weather-sensitive", value: (r) => r.weatherSensitive },
          { header: "Active", value: (r) => r.active },
        ],
        rows,
      );
    },
  },
  "chore-history": {
    label: "Chore history",
    description: "Every scheduled chore, including upcoming ones: who it's for and when it was done.",
    build: async (householdId) => {
      const rows = await prisma.taskInstance.findMany({
        where: { definition: { householdId, domain: "CHORE" } },
        include: {
          definition: { select: { title: true } },
          assignedTo: { select: { firstName: true } },
          completedBy: { select: { firstName: true } },
        },
        orderBy: [{ dueDate: "desc" }],
      });
      return toCsv(
        [
          { header: "Due", value: (r) => csvDate(r.dueDate) },
          { header: "Chore", value: (r) => r.definition.title, freeText: true },
          { header: "Assigned to", value: (r) => r.assignedTo?.firstName, freeText: true },
          { header: "Status", value: (r) => r.status },
          { header: "Completed at", value: (r) => csvDateTime(r.completedAt) },
          { header: "Completed by", value: (r) => r.completedBy?.firstName, freeText: true },
        ],
        rows,
      );
    },
  },
};
