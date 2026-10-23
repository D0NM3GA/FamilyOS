import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { computeDueStatus, type DueResult } from "./due-status";
import { isSupplyLow } from "./supplies";
import { checkRecalls, type Recall, type RecallCheck } from "./nhtsa";
import { appOn } from "@/lib/app-switches";

/** Each item's supplies (Phase 12.5), for the card's "Uses" line. */
const ITEM_SUPPLIES = {
  supplies: {
    include: { supply: { select: { name: true, unit: true, quantityOnHand: true, lowThreshold: true, active: true } } },
    orderBy: { supply: { name: "asc" } },
  },
} as const;

/**
 * All active vehicles for a household, each with its active maintenance items annotated
 * with a computed DueResult, sorted worst-first (OVERDUE, then UPCOMING, then OK) within
 * each vehicle — same "most urgent first" ordering the board wants without a second pass.
 * Once per request (React cache): Home and the layout's Bunson facts both ask for it.
 */
export const getVehiclesWithStatus = cache(async (householdId: string) => {
  const vehicles = await prisma.vehicle.findMany({
    where: { householdId, active: true },
    include: {
      maintenanceItems: { where: { active: true }, orderBy: { title: "asc" }, include: ITEM_SUPPLIES },
    },
    orderBy: { name: "asc" },
  });

  const today = new Date();
  const STATUS_RANK: Record<DueResult["status"], number> = { OVERDUE: 0, UPCOMING: 1, OK: 2 };

  return vehicles.map((vehicle) => {
    const items = vehicle.maintenanceItems
      .map((item) => ({ item, due: computeDueStatus(item, vehicle.currentMileage, today) }))
      .sort((a, b) => STATUS_RANK[a.due.status] - STATUS_RANK[b.due.status]);

    return { vehicle, items };
  });
});

/**
 * Everything the per-vehicle detail page and print view show. Unlike the board, this
 * includes inactive vehicles (a sold car's history is still worth printing) and service
 * history on inactive items — history is history; only the board filters by `active`.
 */
export async function getVehicleDetail(householdId: string, vehicleId: string) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, householdId },
    include: {
      maintenanceItems: { where: { active: true }, orderBy: { title: "asc" }, include: ITEM_SUPPLIES },
    },
  });
  if (!vehicle) return null;

  const [serviceLogs, fuelLogs] = await Promise.all([
    prisma.vehicleServiceLog.findMany({
      where: { item: { vehicleId } },
      orderBy: [{ doneAt: "desc" }, { createdAt: "desc" }],
      include: {
        item: { select: { title: true } },
        loggedBy: { select: { firstName: true } },
      },
    }),
    prisma.vehicleFuelLog.findMany({
      where: { vehicleId },
      orderBy: [{ filledAt: "desc" }, { createdAt: "desc" }],
      include: { loggedBy: { select: { firstName: true } } },
    }),
  ]);

  const today = new Date();
  const STATUS_RANK: Record<DueResult["status"], number> = { OVERDUE: 0, UPCOMING: 1, OK: 2 };
  const items = vehicle.maintenanceItems
    .map((item) => ({ item, due: computeDueStatus(item, vehicle.currentMileage, today) }))
    .sort((a, b) => STATUS_RANK[a.due.status] - STATUS_RANK[b.due.status]);

  return { vehicle, items, serviceLogs, fuelLogs };
}

export type VehicleRecalls =
  | { status: Exclude<RecallCheck["status"], "ok" | "unknown-model"> }
  | { status: "unknown-model"; suggestions: string[] }
  | { status: "ok"; open: Recall[]; handled: (Recall & { acknowledgedAt: Date })[] };

/**
 * NHTSA's recalls for this vehicle split into open vs. family-marked-handled. Never throws
 * (checkRecalls doesn't, and a failed ack lookup would only be a DB outage, which would
 * have already broken the page around it).
 *
 * Phase 36: no NHTSA lookups while the family has Cars turned off. The Cars pages already
 * send you away then (lib/app-guard.ts); checked here too, where the lookup starts, like
 * every other paused job. "unavailable" is what nobody sees.
 */
export async function getVehicleRecalls(vehicle: {
  id: string;
  householdId: string;
  year: number | null;
  make: string | null;
  model: string | null;
}): Promise<VehicleRecalls> {
  if (!(await appOn(vehicle.householdId, "cars"))) return { status: "unavailable" };
  const check = await checkRecalls(vehicle);
  if (check.status !== "ok") return check;

  const acks = await prisma.vehicleRecallAck.findMany({ where: { vehicleId: vehicle.id } });
  const ackedAt = new Map(acks.map((a) => [a.campaignNumber, a.acknowledgedAt]));

  const open: Recall[] = [];
  const handled: (Recall & { acknowledgedAt: Date })[] = [];
  for (const recall of check.recalls) {
    const at = ackedAt.get(recall.campaignNumber);
    if (at) handled.push({ ...recall, acknowledgedAt: at });
    else open.push(recall);
  }
  return { status: "ok", open, handled };
}

/**
 * The garage supplies (Phase 12.5) an item form can pick from: every active one, plus any
 * already linked to the item even if since deactivated, so editing the item doesn't
 * silently drop that link.
 */
export async function getSupplyOptions(householdId: string, linkedIds: string[] = []) {
  const supplies = await prisma.vehicleSupply.findMany({
    where: { householdId, OR: [{ active: true }, { id: { in: linkedIds } }] },
    select: { id: true, name: true, unit: true, active: true },
    orderBy: { name: "asc" },
  });
  return supplies.map((s) => ({
    id: s.id,
    label: `${s.name}${s.unit ? ` (${s.unit})` : ""}${s.active ? "" : " — inactive"}`,
  }));
}

/** The garage supplies page and the board's "low" count. */
export async function getSupplies(householdId: string) {
  return prisma.vehicleSupply.findMany({
    where: { householdId },
    include: { usedBy: { include: { item: { select: { title: true, vehicle: { select: { name: true } } } } } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

/** How many active garage supplies are low, for the board's Supplies link. */
export async function countLowSupplies(householdId: string): Promise<number> {
  const rows = await prisma.vehicleSupply.findMany({
    where: { householdId, active: true, quantityOnHand: { not: null }, lowThreshold: { not: null } },
    select: { quantityOnHand: true, lowThreshold: true },
  });
  return rows.filter((r) => isSupplyLow(r.quantityOnHand, r.lowThreshold)).length;
}
