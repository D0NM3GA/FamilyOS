import { prisma } from "@/lib/prisma";
import { csvDate, csvDateTime, csvMoney, toCsv } from "@/lib/csv";
import type { CsvExport } from "@/lib/export";
import { formatQuantity } from "./supplies";

/** Vehicles' CSV exports (Phase 16). Inactive vehicles are included — history is history. */
export const VEHICLE_EXPORTS: Record<string, CsvExport> = {
  vehicles: {
    label: "Vehicles",
    description: "Every vehicle with its details and current odometer.",
    build: async (householdId) => {
      const rows = await prisma.vehicle.findMany({ where: { householdId }, orderBy: { name: "asc" } });
      return toCsv(
        [
          { header: "Name", value: (r) => r.name, freeText: true },
          { header: "Year", value: (r) => r.year },
          { header: "Make", value: (r) => r.make, freeText: true },
          { header: "Model", value: (r) => r.model, freeText: true },
          { header: "Odometer (mi)", value: (r) => r.currentMileage },
          { header: "Odometer updated", value: (r) => csvDateTime(r.mileageUpdatedAt) },
          { header: "Active", value: (r) => r.active },
        ],
        rows,
      );
    },
  },
  maintenance: {
    label: "Maintenance schedule",
    description: "Tracked maintenance items, their intervals, and when each was last done.",
    build: async (householdId) => {
      const rows = await prisma.vehicleMaintenanceItem.findMany({
        where: { vehicle: { householdId } },
        include: { vehicle: { select: { name: true } } },
        orderBy: [{ vehicle: { name: "asc" } }, { title: "asc" }],
      });
      return toCsv(
        [
          { header: "Vehicle", value: (r) => r.vehicle.name, freeText: true },
          { header: "Item", value: (r) => r.title, freeText: true },
          { header: "Every (mi)", value: (r) => r.intervalMiles },
          { header: "Every (months)", value: (r) => r.intervalMonths },
          { header: "Last done (mi)", value: (r) => r.lastDoneMileage },
          { header: "Last done", value: (r) => csvDate(r.lastDoneAt) },
          { header: "Notes", value: (r) => r.notes, freeText: true },
          { header: "Active", value: (r) => r.active },
        ],
        rows,
      );
    },
  },
  "service-log": {
    label: "Service history",
    description: "Every logged service, with mileage and cost.",
    build: async (householdId) => {
      const rows = await prisma.vehicleServiceLog.findMany({
        where: { item: { vehicle: { householdId } } },
        include: {
          item: { select: { title: true, vehicle: { select: { name: true } } } },
          loggedBy: { select: { firstName: true } },
          supplyUses: { include: { supply: { select: { name: true, unit: true } } } },
        },
        orderBy: [{ doneAt: "desc" }, { createdAt: "desc" }],
      });
      return toCsv(
        [
          { header: "Date", value: (r) => csvDate(r.doneAt) },
          { header: "Vehicle", value: (r) => r.item.vehicle.name, freeText: true },
          { header: "Item", value: (r) => r.item.title, freeText: true },
          { header: "Odometer (mi)", value: (r) => r.mileage },
          { header: "Cost", value: (r) => csvMoney(r.costCents) },
          { header: "Notes", value: (r) => r.notes, freeText: true },
          {
            header: "Supplies used",
            value: (r) => r.supplyUses.map((u) => `${formatQuantity(u.quantity, u.supply.unit)} ${u.supply.name}`).join("; "),
            freeText: true,
          },
          { header: "Logged by", value: (r) => r.loggedBy?.firstName, freeText: true },
        ],
        rows,
      );
    },
  },
  "fuel-log": {
    label: "Fill-ups",
    description: "Every fill-up: date, odometer, gallons, cost, and the full-tank flags MPG uses.",
    build: async (householdId) => {
      const rows = await prisma.vehicleFuelLog.findMany({
        where: { vehicle: { householdId } },
        include: { vehicle: { select: { name: true } }, loggedBy: { select: { firstName: true } } },
        orderBy: [{ filledAt: "desc" }, { createdAt: "desc" }],
      });
      return toCsv(
        [
          { header: "Date", value: (r) => csvDate(r.filledAt) },
          { header: "Vehicle", value: (r) => r.vehicle.name, freeText: true },
          { header: "Odometer (mi)", value: (r) => r.mileage },
          { header: "Gallons", value: (r) => r.gallons },
          { header: "Cost", value: (r) => csvMoney(r.costCents) },
          { header: "Filled to full", value: (r) => r.fullTank },
          { header: "Missed previous fill-up", value: (r) => r.missedPrevious },
          { header: "Notes", value: (r) => r.notes, freeText: true },
          { header: "Logged by", value: (r) => r.loggedBy?.firstName, freeText: true },
        ],
        rows,
      );
    },
  },
  supplies: {
    label: "Garage supplies",
    description: "Oil, filters and other supplies: part numbers, how many are on hand, and when each counts as low.",
    build: async (householdId) => {
      const rows = await prisma.vehicleSupply.findMany({ where: { householdId }, orderBy: { name: "asc" } });
      return toCsv(
        [
          { header: "Name", value: (r) => r.name, freeText: true },
          { header: "Part number", value: (r) => r.partNumber, freeText: true },
          { header: "Unit", value: (r) => r.unit, freeText: true },
          { header: "On hand", value: (r) => r.quantityOnHand },
          { header: "Low at", value: (r) => r.lowThreshold },
          { header: "Notes", value: (r) => r.notes, freeText: true },
          { header: "Active", value: (r) => r.active },
        ],
        rows,
      );
    },
  },
};
