import { prisma } from "@/lib/prisma";
import { csvDate, csvMoney, toCsv } from "@/lib/csv";
import type { CsvExport } from "@/lib/export";

/** School's CSV exports (Phase 18), adults only like every CSV (lib/export.ts). */
export const SCHOOL_EXPORTS: Record<string, CsvExport> = {
  profiles: {
    label: "School details",
    description: "Each student's school, grade, getting there, lunch and schedule notes, and their teachers.",
    build: async (householdId) => {
      const rows = await prisma.schoolProfile.findMany({
        where: { person: { householdId } },
        include: {
          person: { select: { firstName: true, lastName: true } },
          contacts: { include: { person: { select: { firstName: true, lastName: true, email: true, phone: true } } } },
        },
        orderBy: { person: { firstName: "asc" } },
      });
      const name = (p: { firstName: string; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(" ");
      return toCsv(
        [
          { header: "Student", value: (r) => name(r.person), freeText: true },
          { header: "School", value: (r) => r.schoolName, freeText: true },
          { header: "Grade", value: (r) => r.grade, freeText: true },
          { header: "School year", value: (r) => r.schoolYear, freeText: true },
          { header: "Getting there", value: (r) => r.transportNotes, freeText: true },
          { header: "Lunch", value: (r) => r.lunchNotes, freeText: true },
          { header: "Schedule", value: (r) => r.scheduleNotes, freeText: true },
          { header: "Notes", value: (r) => r.notes, freeText: true },
          {
            header: "Teachers & contacts",
            value: (r) => r.contacts.map((c) => [c.role, name(c.person), c.person.phone, c.person.email].filter(Boolean).join(" · ")).join("; "),
            freeText: true,
          },
        ],
        rows,
      );
    },
  },
  todos: {
    label: "School forms & to-dos",
    description: "Permission slips, fees and supply lists, open and done.",
    build: async (householdId) => {
      const rows = await prisma.schoolTask.findMany({
        where: { householdId },
        include: { kid: { select: { firstName: true } }, owner: { select: { firstName: true } } },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      });
      return toCsv(
        [
          { header: "What", value: (r) => r.title, freeText: true },
          { header: "Kind", value: (r) => r.kind },
          { header: "For", value: (r) => r.kid?.firstName ?? "Everyone", freeText: true },
          { header: "Due", value: (r) => csvDate(r.dueDate) },
          { header: "Amount", value: (r) => csvMoney(r.amountCents) },
          { header: "Handled by", value: (r) => r.owner?.firstName, freeText: true },
          { header: "Status", value: (r) => r.status },
          { header: "Done", value: (r) => csvDate(r.doneAt) },
          { header: "Notes", value: (r) => r.notes, freeText: true },
        ],
        rows,
      );
    },
  },
  assignments: {
    label: "Homework & grades",
    description: "Every assignment with its due date, status and score.",
    build: async (householdId) => {
      const rows = await prisma.schoolAssignment.findMany({
        where: { profile: { person: { householdId } } },
        include: { profile: { select: { person: { select: { firstName: true } } } } },
        orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
      });
      return toCsv(
        [
          { header: "Student", value: (r) => r.profile.person.firstName, freeText: true },
          { header: "Class", value: (r) => r.className, freeText: true },
          { header: "Assignment", value: (r) => r.title, freeText: true },
          { header: "Due", value: (r) => csvDate(r.dueDate) },
          { header: "Status", value: (r) => r.status },
          { header: "Score", value: (r) => r.score },
          { header: "Out of", value: (r) => r.maxScore },
          { header: "Notes", value: (r) => r.notes, freeText: true },
        ],
        rows,
      );
    },
  },
};
