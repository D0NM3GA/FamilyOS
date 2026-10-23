import { prisma } from "@/lib/prisma";
import { csvDateTime, toCsv } from "@/lib/csv";
import type { CsvExport } from "@/lib/export";
import { describeSize } from "./size";

/** Groceries' CSV exports (Phase 16). */
export const GROCERY_EXPORTS: Record<string, CsvExport> = {
  products: {
    label: "Pantry",
    description: "Everything the family buys, with its brand, barcode, size, section and store.",
    build: async (householdId) => {
      const rows = await prisma.product.findMany({
        where: { householdId },
        include: {
          group: { select: { name: true } },
          defaultStore: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      });
      return toCsv(
        [
          { header: "Item", value: (r) => r.name, freeText: true },
          { header: "Brand", value: (r) => r.brand, freeText: true },
          { header: "Barcode", value: (r) => r.barcode, freeText: true },
          { header: "How it comes", value: (r) => describeSize(r), freeText: true },
          { header: "Section", value: (r) => r.group?.name, freeText: true },
          { header: "Where we buy it", value: (r) => r.defaultStore?.name, freeText: true },
          { header: "Image URL", value: (r) => r.imageUrl, freeText: true },
        ],
        rows,
      );
    },
  },
  "shopping-list": {
    label: "Shopping list",
    description: "What's on the list right now, including checked-off items.",
    build: async (householdId) => {
      const rows = await prisma.shoppingListItem.findMany({
        where: { list: { householdId } },
        include: {
          product: { select: { name: true, container: true, defaultStore: { select: { name: true } } } },
          requestedBy: { select: { firstName: true } },
          addedBy: { select: { firstName: true } },
        },
        orderBy: [{ done: "asc" }, { createdAt: "asc" }],
      });
      return toCsv(
        [
          { header: "Item", value: (r) => r.product.name, freeText: true },
          { header: "Quantity", value: (r) => r.quantity },
          { header: "Container", value: (r) => r.product.container, freeText: true },
          { header: "Store", value: (r) => r.product.defaultStore?.name, freeText: true },
          { header: "Done", value: (r) => r.done },
          { header: "For", value: (r) => r.requestedBy?.firstName, freeText: true },
          { header: "Added by", value: (r) => r.addedBy?.firstName, freeText: true },
          { header: "Added at", value: (r) => csvDateTime(r.createdAt) },
        ],
        rows,
      );
    },
  },
  purchases: {
    label: "Purchase history",
    description: "Every completed shopping trip, one row per item bought.",
    build: async (householdId) => {
      const rows = await prisma.purchaseItem.findMany({
        where: { purchase: { householdId } },
        include: {
          purchase: { select: { purchasedAt: true, purchasedBy: { select: { firstName: true } } } },
          requestedBy: { select: { firstName: true } },
        },
        orderBy: [{ purchase: { purchasedAt: "desc" } }, { description: "asc" }],
      });
      return toCsv(
        [
          { header: "Purchased at", value: (r) => csvDateTime(r.purchase.purchasedAt) },
          { header: "Purchased by", value: (r) => r.purchase.purchasedBy?.firstName, freeText: true },
          { header: "Item", value: (r) => r.description, freeText: true },
          { header: "Quantity", value: (r) => r.quantity },
          { header: "For", value: (r) => r.requestedBy?.firstName, freeText: true },
        ],
        rows,
      );
    },
  },
};
