import { prisma } from "@/lib/prisma";
import { csvDateTime, toCsv } from "@/lib/csv";
import type { CsvExport } from "@/lib/export";
import { fullName } from "@/lib/people";

/**
 * People's CSV exports (Phase 16). Unlike the printed contact sheet, these include each
 * person's private notes: exports are adults-only (the print view is kid-reachable).
 * Never exported: PIN data, sign-in links, and photos (those come from Microsoft 365).
 */
export const PEOPLE_EXPORTS: Record<string, CsvExport> = {
  people: {
    label: "People & contacts",
    description: "Everyone in the People list: household members and contacts, with notes.",
    build: async (householdId) => {
      const rows = await prisma.person.findMany({
        where: { householdId },
        select: {
          firstName: true,
          lastName: true,
          isHouseholdMember: true,
          role: true,
          email: true,
          phone: true,
          notes: true,
          contactCadenceDays: true,
          lastContactedAt: true,
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      });
      return toCsv(
        [
          { header: "First name", value: (r) => r.firstName, freeText: true },
          { header: "Last name", value: (r) => r.lastName, freeText: true },
          { header: "Household member", value: (r) => r.isHouseholdMember },
          { header: "Role", value: (r) => r.role },
          { header: "Email", value: (r) => r.email, freeText: true },
          { header: "Phone", value: (r) => r.phone, freeText: true },
          { header: "Check in every (days)", value: (r) => r.contactCadenceDays },
          { header: "Last contacted", value: (r) => csvDateTime(r.lastContactedAt) },
          { header: "Notes", value: (r) => r.notes, freeText: true },
        ],
        rows,
      );
    },
  },
  "important-dates": {
    label: "Birthdays & important dates",
    description: "Birthdays, anniversaries and other dates, per person.",
    build: async (householdId) => {
      const rows = await prisma.importantDate.findMany({
        where: { person: { householdId } },
        include: { person: { select: { firstName: true, lastName: true } } },
        orderBy: [{ month: "asc" }, { day: "asc" }],
      });
      return toCsv(
        [
          { header: "Person", value: (r) => fullName(r.person), freeText: true },
          { header: "Type", value: (r) => r.type },
          { header: "Label", value: (r) => r.label, freeText: true },
          { header: "Month", value: (r) => r.month },
          { header: "Day", value: (r) => r.day },
          { header: "Year", value: (r) => r.year },
        ],
        rows,
      );
    },
  },
  interactions: {
    label: "Interaction log",
    description: "Every logged call, text, email, visit and note.",
    build: async (householdId) => {
      const rows = await prisma.interactionLog.findMany({
        where: { person: { householdId } },
        include: {
          person: { select: { firstName: true, lastName: true } },
          loggedBy: { select: { firstName: true } },
        },
        orderBy: { occurredAt: "desc" },
      });
      return toCsv(
        [
          { header: "When", value: (r) => csvDateTime(r.occurredAt) },
          { header: "Person", value: (r) => fullName(r.person), freeText: true },
          { header: "Type", value: (r) => r.type },
          { header: "Note", value: (r) => r.note, freeText: true },
          { header: "Logged by", value: (r) => r.loggedBy?.firstName, freeText: true },
        ],
        rows,
      );
    },
  },
  relationships: {
    label: "Relationships",
    description: "How people are related (spouse, parent, child, sibling, other).",
    build: async (householdId) => {
      const rows = await prisma.personRelationship.findMany({
        where: { from: { householdId }, to: { householdId } },
        include: {
          from: { select: { firstName: true, lastName: true } },
          to: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return toCsv(
        [
          { header: "Person", value: (r) => fullName(r.from), freeText: true },
          { header: "Relationship", value: (r) => r.type },
          { header: "Label", value: (r) => r.label, freeText: true },
          { header: "Related to", value: (r) => fullName(r.to), freeText: true },
        ],
        rows,
      );
    },
  },
};
