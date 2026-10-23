import { prisma } from "@/lib/prisma";
import { csvDateTime, toCsv } from "@/lib/csv";
import type { CsvExport } from "@/lib/export";

/** Points and rewards CSV exports (Phase 16) — household-wide, across Chores and Meds. */
export const POINTS_EXPORTS: Record<string, CsvExport> = {
  points: {
    label: "Points ledger",
    description: "Every point earned or spent, per person.",
    build: async (householdId) => {
      const rows = await prisma.pointsLedger.findMany({
        where: { person: { householdId } },
        include: { person: { select: { firstName: true } }, order: { select: { title: true } } },
        orderBy: { createdAt: "desc" },
      });
      return toCsv(
        [
          { header: "When", value: (r) => csvDateTime(r.createdAt) },
          { header: "Person", value: (r) => r.person.firstName, freeText: true },
          { header: "Points", value: (r) => r.delta },
          { header: "Reason", value: (r) => r.reason, freeText: true },
          { header: "Store order", value: (r) => r.order?.title ?? null, freeText: true },
        ],
        rows,
      );
    },
  },
  rewards: {
    label: "Rewards",
    description: "The rewards catalog and what each costs.",
    build: async (householdId) => {
      const rows = await prisma.reward.findMany({
        where: { householdId },
        include: { bucket: { select: { name: true } } },
        orderBy: [{ active: "desc" }, { pointCost: "asc" }],
      });
      return toCsv(
        [
          { header: "Reward", value: (r) => r.title, freeText: true },
          { header: "Emoji", value: (r) => r.emoji, freeText: true },
          { header: "Shelf", value: (r) => r.bucket?.name ?? null, freeText: true },
          { header: "Cost (points)", value: (r) => r.pointCost },
          { header: "Per week", value: (r) => r.limitPerWeek },
          { header: "Needs an OK", value: (r) => r.needsApproval },
          { header: "Active", value: (r) => r.active },
        ],
        rows,
      );
    },
  },
  orders: {
    label: "Store orders",
    description: "Every store purchase: who, what, and how it ended.",
    build: async (householdId) => {
      const rows = await prisma.rewardOrder.findMany({
        where: { householdId },
        include: {
          person: { select: { firstName: true } },
          placedBy: { select: { firstName: true } },
          decidedBy: { select: { firstName: true } },
          closedBy: { select: { firstName: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return toCsv(
        [
          { header: "Bought", value: (r) => csvDateTime(r.createdAt) },
          { header: "For", value: (r) => r.person.firstName, freeText: true },
          { header: "Placed by", value: (r) => r.placedBy?.firstName ?? null, freeText: true },
          { header: "Reward", value: (r) => r.title, freeText: true },
          { header: "Cost (points)", value: (r) => r.cost },
          { header: "Status", value: (r) => r.status },
          { header: "OK'd / declined", value: (r) => (r.decidedAt ? csvDateTime(r.decidedAt) : null) },
          { header: "OK'd / declined by", value: (r) => r.decidedBy?.firstName ?? null, freeText: true },
          { header: "Delivered / refunded", value: (r) => (r.closedAt ? csvDateTime(r.closedAt) : null) },
          { header: "Delivered / refunded by", value: (r) => r.closedBy?.firstName ?? null, freeText: true },
          { header: "Note", value: (r) => r.note, freeText: true },
        ],
        rows,
      );
    },
  },
};
