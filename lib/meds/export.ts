import { prisma } from "@/lib/prisma";
import { csvDate, csvDateTime, csvLocalDateTime, toCsv } from "@/lib/csv";
import type { CsvExport } from "@/lib/export";
import { fullName } from "@/lib/people";
import { describeRecurrence, formatHHmm } from "@/lib/tasks/format";

/**
 * Meds' CSV exports (Phase 16). Adults only, like every CSV — and like the rest of the meds
 * detail (stock, prescriber, pharmacy), which kids can't see anywhere else either.
 */
export const MED_EXPORTS: Record<string, CsvExport> = {
  medications: {
    label: "Medications",
    description: "Every medication: dose, schedule, stock, prescriber and pharmacy.",
    build: async (householdId) => {
      const person = { select: { firstName: true, lastName: true, phone: true } } as const;
      const rows = await prisma.taskDefinition.findMany({
        where: { householdId, domain: "MED" },
        include: {
          assignees: { select: { firstName: true, lastName: true }, orderBy: { firstName: "asc" } },
          medication: { include: { prescriber: person, pharmacy: person } },
        },
        orderBy: [{ active: "desc" }, { title: "asc" }],
      });
      return toCsv(
        [
          { header: "Medication", value: (r) => r.title, freeText: true },
          { header: "For", value: (r) => r.assignees.map((a) => fullName(a)).join("; "), freeText: true },
          { header: "Dose / instructions", value: (r) => r.notes, freeText: true },
          { header: "Schedule", value: (r) => describeRecurrence(r) },
          { header: "Times", value: (r) => r.timesOfDay.map(formatHHmm).join("; ") },
          { header: "Starts", value: (r) => csvDate(r.startDate) },
          { header: "Amount per dose", value: (r) => r.medication?.doseAmount },
          { header: "On hand", value: (r) => r.medication?.quantityOnHand },
          { header: "Refill at", value: (r) => r.medication?.refillThresholdQuantity },
          { header: "Prescriber", value: (r) => (r.medication?.prescriber ? fullName(r.medication.prescriber) : null), freeText: true },
          { header: "Prescriber phone", value: (r) => r.medication?.prescriber?.phone, freeText: true },
          { header: "Pharmacy", value: (r) => (r.medication?.pharmacy ? fullName(r.medication.pharmacy) : null), freeText: true },
          { header: "Pharmacy phone", value: (r) => r.medication?.pharmacy?.phone, freeText: true },
          { header: "Active", value: (r) => r.active },
        ],
        rows,
      );
    },
  },
  "dose-history": {
    label: "Dose history",
    description: "Every scheduled dose, including upcoming ones, and when each was taken.",
    build: async (householdId) => {
      const rows = await prisma.taskInstance.findMany({
        where: { definition: { householdId, domain: "MED" } },
        include: {
          definition: { select: { title: true } },
          assignedTo: { select: { firstName: true } },
          completedBy: { select: { firstName: true } },
        },
        orderBy: [{ dueDate: "desc" }],
      });
      return toCsv(
        [
          // Doses carry a time of day (multi-dose meds): local date + time, as the app shows it.
          { header: "Due", value: (r) => csvLocalDateTime(r.dueDate) },
          { header: "Medication", value: (r) => r.definition.title, freeText: true },
          { header: "For", value: (r) => r.assignedTo?.firstName, freeText: true },
          { header: "Status", value: (r) => r.status },
          { header: "Taken at", value: (r) => csvDateTime(r.completedAt) },
          { header: "Marked by", value: (r) => r.completedBy?.firstName, freeText: true },
          { header: "Amount taken", value: (r) => r.quantityConsumed },
        ],
        rows,
      );
    },
  },
};
