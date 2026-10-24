"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkVin } from "@/lib/vin";
import { decodeVin, type VinDecode } from "@/lib/vehicles/vpic";
import { requireAdult } from "@/lib/authz";
import { atMidnight } from "@/lib/tasks/schedule";
import { parseLocalDate } from "@/lib/vehicles/dates";
import { parseMoneyInput } from "@/lib/money";
import { selectTemplates } from "@/lib/vehicles/templates";
import { parseSupplyUses, type SupplyUse } from "@/lib/vehicles/supplies";
import { consumeForService, restoreForUndo } from "@/lib/vehicles/supply-stock";
import { requestItemByName } from "@/lib/shopping-list";
import { captureError } from "@/lib/observability";

/** `notice` is a non-error heads-up on success (e.g. a fill-up saved without moving the odometer). */
export type VehicleFormState = { error?: string; notice?: string };

/**
 * Every mileage column is a Postgres INTEGER; without a cap, a pasted 10-digit number makes
 * Prisma throw inside the action — an error-boundary panel instead of a form error, which
 * matters most for logFuel (the one kid-reachable action here). 9,999,999 is well past any
 * real odometer.
 */
const MAX_MILEAGE = 9_999_999;

/**
 * A fill-up only moves the odometer forward by at most this much (owner's call, Phase 12):
 * kids can log fill-ups, and one typo (489,000 for 48,900) would otherwise mark every
 * mileage-tracked item overdue until an adult fixed it in the edit form. A bigger jump still
 * saves the fill-up — it just leaves the odometer for "Update odometer" to confirm.
 */
const MAX_FUEL_ODOMETER_JUMP = 2_000;

/**
 * Deactivated (sold/retired) vehicles are read-only history (owner's call, Phase 12): their
 * detail page hides the logging controls, and these actions re-check server-side.
 */
const INACTIVE_VEHICLE_ERROR = "This vehicle is inactive — reactivate it from Manage to log anything new.";

const vehicleSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  make: z.string().trim().optional(),
  model: z.string().trim().optional(),
  // Next year's models are on sale already. Checked when saved, not when the server started.
  year: z.coerce.number().int().min(1900).refine((y) => y <= new Date().getFullYear() + 1, "That year hasn't come yet").optional(),
  currentMileage: z.coerce.number().int().min(0, "Mileage can't be negative").max(MAX_MILEAGE, "Enter a valid mileage"),
});

function parseVehicleForm(formData: FormData) {
  // Phase 53: a VIN is optional; one that's there must read as a VIN.
  const vinRaw = String(formData.get("vin") ?? "").trim().slice(0, 40);
  const vin = vinRaw ? checkVin(vinRaw) : null;
  if (vin && !vin.ok) return { error: vin.error } as const;
  const yearRaw = String(formData.get("year") ?? "").trim();
  const makeRaw = String(formData.get("make") ?? "").trim();
  const modelRaw = String(formData.get("model") ?? "").trim();

  const parsed = vehicleSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    make: makeRaw || undefined,
    model: modelRaw || undefined,
    year: yearRaw || undefined,
    currentMileage: String(formData.get("currentMileage") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" } as const;
  }

  const { make, model, year, ...rest } = parsed.data;
  return { fields: { ...rest, make: make ?? null, model: model ?? null, year: year ?? null, vin: vin?.ok ? vin.vin : null } } as const;
}

export async function createVehicle(
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const profile = await requireAdult();
  const result = parseVehicleForm(formData);
  if ("error" in result) return { error: result.error };

  const existing = await prisma.vehicle.findFirst({
    where: { householdId: profile.householdId, name: { equals: result.fields.name, mode: "insensitive" } },
  });
  if (existing) return { error: `A vehicle named "${result.fields.name}" already exists.` };

  const vehicle = await prisma.vehicle.create({
    data: { householdId: profile.householdId, ...result.fields, mileageUpdatedAt: new Date() },
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
  // Straight to the starter-items picker (it has a Skip link) — otherwise a brand-new
  // vehicle lands on the board with nothing tracked and templates are easy to miss.
  redirect(`/vehicles/${vehicle.id}/items/templates`);
}

export async function updateVehicle(
  vehicleId: string,
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const profile = await requireAdult();
  const result = parseVehicleForm(formData);
  if ("error" in result) return { error: result.error };

  const existing = await prisma.vehicle.findFirst({
    where: { id: vehicleId, householdId: profile.householdId },
  });
  if (!existing) return { error: "Vehicle not found." };

  const nameTaken = await prisma.vehicle.findFirst({
    where: {
      householdId: profile.householdId,
      id: { not: vehicleId },
      name: { equals: result.fields.name, mode: "insensitive" },
    },
  });
  if (nameTaken) return { error: `A vehicle named "${result.fields.name}" already exists.` };

  // The edit form is the deliberate override path for correcting a mis-entered odometer
  // reading (see the monotonic guard on updateOdometer below) — unlike the board's quick
  // control, this can move currentMileage in either direction.
  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { ...result.fields, mileageUpdatedAt: new Date() },
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/vehicles/manage");
  revalidatePath("/");
  redirect("/vehicles/manage");
}

export async function setVehicleActive(vehicleId: string, active: boolean) {
  const profile = await requireAdult();

  await prisma.vehicle.updateMany({
    where: { id: vehicleId, householdId: profile.householdId },
    data: { active },
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/vehicles/manage");
  revalidatePath("/");
}

const odometerSchema = z.object({
  mileage: z.coerce.number().int().min(0, "Enter a valid mileage").max(MAX_MILEAGE, "Enter a valid mileage"),
});

/**
 * The board's quick "update odometer" control — deliberately monotonic (real odometers
 * don't go backward). A typo that undershoots is harmless (the next real reading corrects
 * it); a typo that overshoots would falsely mark every mileage-tracked item overdue with no
 * way back from this control, so overshoot correction is the vehicle edit form's job
 * (updateVehicle above), not this one's.
 */
export async function updateOdometer(
  vehicleId: string,
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const profile = await requireAdult();
  const parsed = odometerSchema.safeParse({ mileage: String(formData.get("mileage") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, householdId: profile.householdId },
  });
  if (!vehicle) return { error: "Vehicle not found." };
  if (parsed.data.mileage < vehicle.currentMileage) {
    return {
      error: `Must be at least ${vehicle.currentMileage.toLocaleString()} (the current reading). To correct a mistake, edit the vehicle directly.`,
    };
  }

  // Atomic re-check against a concurrent update racing this one, same shape as
  // app/(app)/meds/actions.ts's setDefinitionActive count check.
  const updated = await prisma.vehicle.updateMany({
    where: { id: vehicleId, householdId: profile.householdId, currentMileage: { lte: parsed.data.mileage } },
    data: { currentMileage: parsed.data.mileage, mileageUpdatedAt: new Date() },
  });
  if (updated.count === 0) {
    return { error: "Someone just updated this vehicle's odometer — refresh and try again." };
  }

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
  return {};
}

const itemSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    notes: z.string().trim().optional(),
    intervalMiles: z.coerce.number().int().min(1).optional(),
    intervalMonths: z.coerce.number().int().min(1).optional(),
  })
  .refine((data) => data.intervalMiles != null || data.intervalMonths != null, {
    message: "Set a mileage interval, a time interval, or both",
    path: ["intervalMiles"],
  });

function parseItemForm(formData: FormData) {
  const milesRaw = String(formData.get("intervalMiles") ?? "").trim();
  const monthsRaw = String(formData.get("intervalMonths") ?? "").trim();

  const parsed = itemSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    intervalMiles: milesRaw || undefined,
    intervalMonths: monthsRaw || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" } as const;
  }

  const { notes, intervalMiles, intervalMonths, ...rest } = parsed.data;
  return {
    fields: {
      ...rest,
      notes: notes || null,
      intervalMiles: intervalMiles ?? null,
      intervalMonths: intervalMonths ?? null,
    },
  } as const;
}

/**
 * The item form's "Uses" rows (Phase 12.5), with every supply checked against the
 * household: the ids come from the browser.
 */
async function parseItemUses(formData: FormData, householdId: string): Promise<{ uses: SupplyUse[] } | { error: string }> {
  const parsed = parseSupplyUses(formData);
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.uses.length === 0) return { uses: [] };
  const owned = await prisma.vehicleSupply.count({
    where: { householdId, id: { in: parsed.uses.map((u) => u.supplyId) } },
  });
  if (owned !== parsed.uses.length) return { error: "One of those supplies wasn't found." };
  return { uses: parsed.uses };
}

export async function createMaintenanceItem(
  vehicleId: string,
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const profile = await requireAdult();
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, householdId: profile.householdId },
  });
  if (!vehicle) return { error: "Vehicle not found." };

  const result = parseItemForm(formData);
  if ("error" in result) return { error: result.error };
  const uses = await parseItemUses(formData, profile.householdId);
  if ("error" in uses) return { error: uses.error };

  await prisma.vehicleMaintenanceItem.create({
    data: { vehicleId, ...result.fields, supplies: { create: uses.uses } },
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
  redirect("/vehicles");
}

export async function updateMaintenanceItem(
  itemId: string,
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const profile = await requireAdult();
  const existing = await prisma.vehicleMaintenanceItem.findFirst({
    where: { id: itemId, vehicle: { householdId: profile.householdId } },
  });
  if (!existing) return { error: "Maintenance item not found." };

  const result = parseItemForm(formData);
  if ("error" in result) return { error: result.error };
  const uses = await parseItemUses(formData, profile.householdId);
  if ("error" in uses) return { error: uses.error };

  // Replace-all: the form always submits the item's complete list.
  await prisma.vehicleMaintenanceItem.update({
    where: { id: itemId },
    data: { ...result.fields, supplies: { deleteMany: {}, create: uses.uses } },
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/vehicles/manage");
  revalidatePath("/");
  redirect("/vehicles/manage");
}

export async function setMaintenanceItemActive(itemId: string, active: boolean) {
  const profile = await requireAdult();

  await prisma.vehicleMaintenanceItem.updateMany({
    where: { id: itemId, vehicle: { householdId: profile.householdId } },
    data: { active },
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/vehicles/manage");
  revalidatePath("/");
}

const logSchema = z.object({
  doneAt: z.string().optional(),
  mileage: z.coerce.number().int().min(0).max(MAX_MILEAGE, "Enter a valid mileage").optional(),
  notes: z.string().trim().optional(),
});

/**
 * Logs a completed service — appends a VehicleServiceLog row rather than just overwriting
 * the item's lastDone* fields, so "when did we last do the brakes" stays answerable and a
 * mis-tap can be undone (see undoLastService below). Both `doneAt` and `mileage` default to
 * "right now" so the one-tap board flow needs neither, but a shop-invoice entry logged days
 * later can backdate both.
 */
export async function logMaintenanceDone(
  itemId: string,
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const profile = await requireAdult();

  const item = await prisma.vehicleMaintenanceItem.findFirst({
    where: { id: itemId, vehicle: { householdId: profile.householdId } },
    include: { vehicle: true },
  });
  if (!item) return { error: "Maintenance item not found." };
  if (!item.vehicle.active) return { error: INACTIVE_VEHICLE_ERROR };

  const parsed = logSchema.safeParse({
    doneAt: String(formData.get("doneAt") ?? "").trim() || undefined,
    mileage: String(formData.get("mileage") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const cost = parseMoneyInput(String(formData.get("cost") ?? ""));
  if (!cost.ok) return { error: cost.error };

  // Always a local-midnight Date, whether parsed from the "YYYY-MM-DD" input or defaulted
  // to today — matching lib/vehicles/due-status.ts's "local-midnight dates" contract.
  // Mixing this with a time-of-day `new Date()` fallback would make a same-day entry
  // logged without a date lose the `becomesLatest` comparison below to an earlier same-day
  // entry that did carry an explicit (midnight) date.
  const doneAt = parsed.data.doneAt ? parseLocalDate(parsed.data.doneAt) : atMidnight(new Date());
  if (doneAt == null) return { error: "Enter a valid date." };
  if (doneAt > atMidnight(new Date())) {
    return { error: "Date can't be in the future." };
  }
  const mileage = parsed.data.mileage ?? item.vehicle.currentMileage;

  // Backdating is allowed, so this new entry only becomes the item's "latest" cache if it's
  // not older than what's already there — an invoice logged for a service done last month
  // shouldn't roll a more recent completion's cached values backward.
  const becomesLatest = item.lastDoneAt == null || doneAt >= item.lastDoneAt;

  const takeSupplies = formData.get("takeSupplies") === "1";
  const lowSupplies = await prisma.$transaction(async (tx) => {
    const log = await tx.vehicleServiceLog.create({
      data: {
        itemId,
        doneAt,
        mileage,
        costCents: cost.cents,
        notes: parsed.data.notes || null,
        loggedById: profile.id,
      },
    });
    if (becomesLatest) {
      await tx.vehicleMaintenanceItem.update({
        where: { id: itemId },
        data: { lastDoneMileage: mileage, lastDoneAt: doneAt },
      });
    }
    // Gated on becomesLatest too: a backdated entry the code has already decided is *older*
    // than the cached latest shouldn't be able to push the vehicle's odometer forward on the
    // strength of a reading it's simultaneously treating as stale.
    if (becomesLatest && mileage > item.vehicle.currentMileage) {
      await tx.vehicle.update({
        where: { id: item.vehicleId },
        data: { currentMileage: mileage, mileageUpdatedAt: new Date() },
      });
    }
    // Phase 12.5: only when the form says this service took from stock (ticked by default
    // for today's date, the owner's call). Absent means no: the checkbox is only rendered for
    // items that use supplies.
    if (!takeSupplies) return [];
    return consumeForService(tx, { householdId: profile.householdId, logId: log.id, itemId });
  });

  // After commit, best-effort, like Meds' refill hook: a shopping-list hiccup must not fail
  // (or roll back) a service that really happened. The list dedupes by Pantry item, so a supply
  // that's still low on the next service doesn't add a second line.
  const added: string[] = [];
  for (const name of lowSupplies) {
    try {
      const { created } = await requestItemByName({ householdId: profile.householdId, name, addedById: profile.id });
      if (created) added.push(name);
    } catch (err) {
      console.error("[vehicles] failed to request a low-supply shopping-list item", err);
      captureError(err);
    }
  }
  if (added.length > 0) revalidatePath("/groceries");

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
  // Say so: the list changing behind someone's back is how "who added this?" starts.
  return added.length > 0 ? { notice: `Logged ✓ Running low, so ${listOf(added)} went on the grocery list 🛒` } : {};
}

/** "oil", "oil and filters", "oil, filters and wipers". */
function listOf(names: string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Deletes the most recently LOGGED service entry — undo for a mis-tap on
 * logMaintenanceDone, not a general history editor — puts back the supplies it took, and
 * recomputes the item's lastDone* cache from what's left.
 *
 * "Most recently logged", by createdAt, not the latest doneAt (owner's call, Phase 12.5): a
 * backdated invoice entered just now is what a user undoing a mistake means, even when a
 * service with a later date exists. The odometer isn't rolled back (see the card).
 */
export async function undoLastService(itemId: string) {
  const profile = await requireAdult();

  const item = await prisma.vehicleMaintenanceItem.findFirst({
    where: { id: itemId, vehicle: { householdId: profile.householdId } },
  });
  if (!item) throw new Error("Maintenance item not found");

  await prisma.$transaction(async (tx) => {
    const latest = await tx.vehicleServiceLog.findFirst({ where: { itemId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (!latest) return;
    await restoreForUndo(tx, latest.id);
    await tx.vehicleServiceLog.delete({ where: { id: latest.id } });
    const remaining = await tx.vehicleServiceLog.findFirst({ where: { itemId }, orderBy: [{ doneAt: "desc" }, { createdAt: "desc" }] });
    await tx.vehicleMaintenanceItem.update({
      where: { id: itemId },
      data: { lastDoneMileage: remaining?.mileage ?? null, lastDoneAt: remaining?.doneAt ?? null },
    });
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
}

/**
 * Creates the chosen starter items (lib/vehicles/templates.ts) in one go, silently skipping
 * any whose title the vehicle already has — re-submitting the page can't duplicate items.
 */
export async function addTemplateItems(
  vehicleId: string,
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const profile = await requireAdult();
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, householdId: profile.householdId },
    include: { maintenanceItems: { select: { title: true } } },
  });
  if (!vehicle) return { error: "Vehicle not found." };

  const keys = formData.getAll("template").map(String);
  if (keys.length === 0) return { error: "Pick at least one item, or skip this step." };

  // Checked against every item, inactive included: re-adding "Oil change" next to a
  // deactivated one would be a confusing duplicate — reactivate it from Manage instead.
  const picked = selectTemplates(
    keys,
    vehicle.maintenanceItems.map((i) => i.title),
  );
  if (picked.length > 0) {
    await prisma.vehicleMaintenanceItem.createMany({
      data: picked.map((t) => ({
        vehicleId,
        title: t.title,
        intervalMiles: t.intervalMiles,
        intervalMonths: t.intervalMonths,
      })),
    });
  }

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
  redirect(`/vehicles/${vehicleId}`);
}

const fuelSchema = z.object({
  filledAt: z.string().optional(),
  mileage: z.coerce
    .number()
    .int("Mileage must be a whole number")
    .min(0, "Enter a valid mileage")
    .max(MAX_MILEAGE, "Enter a valid mileage"),
  gallons: z.coerce
    .number("Enter how many gallons")
    .positive("Gallons must be more than 0")
    .max(500, "That's more gallons than any tank holds"),
  notes: z.string().trim().optional(),
});

/**
 * Logs a fill-up. Grown-ups only, like every vehicle mutation (Phase 12 let kids log one; Cars
 * became grown-ups only when its pages stopped letting kids in). Mileage is required (it's what MPG is computed from) but is not
 * checked against earlier fill-ups — a mistyped earlier row shouldn't block every later one;
 * lib/vehicles/mpg.ts flags the inconsistent segment instead.
 */
export async function logFuel(
  vehicleId: string,
  _prevState: VehicleFormState,
  formData: FormData,
): Promise<VehicleFormState> {
  const profile = await requireAdult();
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, householdId: profile.householdId },
  });
  if (!vehicle) return { error: "Vehicle not found." };
  if (!vehicle.active) return { error: INACTIVE_VEHICLE_ERROR };

  const parsed = fuelSchema.safeParse({
    filledAt: String(formData.get("filledAt") ?? "").trim() || undefined,
    mileage: String(formData.get("mileage") ?? "").trim() || undefined,
    gallons: String(formData.get("gallons") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const cost = parseMoneyInput(String(formData.get("cost") ?? ""));
  if (!cost.ok) return { error: cost.error };

  const filledAt = parsed.data.filledAt ? parseLocalDate(parsed.data.filledAt) : atMidnight(new Date());
  if (filledAt == null) return { error: "Enter a valid date." };
  if (filledAt > atMidnight(new Date())) return { error: "Date can't be in the future." };

  const { mileage } = parsed.data;
  const gallons = Math.round(parsed.data.gallons * 1000) / 1000;
  if (gallons <= 0) return { error: "Gallons must be more than 0" };

  // Returns the odometer reading it declined to move from (for the notice below), or null.
  const skippedFrom = await prisma.$transaction(async (tx) => {
    const latest = await tx.vehicleFuelLog.findFirst({
      where: { vehicleId },
      orderBy: [{ filledAt: "desc" }, { createdAt: "desc" }],
      select: { filledAt: true },
    });

    await tx.vehicleFuelLog.create({
      data: {
        vehicleId,
        filledAt,
        mileage,
        gallons,
        costCents: cost.cents,
        fullTank: formData.get("fullTank") === "on",
        missedPrevious: formData.get("missedPrevious") === "on",
        notes: parsed.data.notes || null,
        loggedById: profile.id,
      },
    });

    // Same rule as logMaintenanceDone: only the newest entry may push the odometer
    // forward, so a backdated receipt can't. Atomic `lt` guard against a racing update;
    // a no-op when the odometer is already at or past this reading. Like undoLastService,
    // deleting this fill-up later does not roll the bump back — correcting an overshoot
    // is the vehicle edit form's job. The `gte` half caps the jump (MAX_FUEL_ODOMETER_JUMP).
    if (latest != null && filledAt < latest.filledAt) return null;
    const bumped = await tx.vehicle.updateMany({
      where: { id: vehicleId, currentMileage: { lt: mileage, gte: mileage - MAX_FUEL_ODOMETER_JUMP } },
      data: { currentMileage: mileage, mileageUpdatedAt: new Date() },
    });
    if (bumped.count > 0) return null;
    const now = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { currentMileage: true } });
    return now != null && now.currentMileage < mileage - MAX_FUEL_ODOMETER_JUMP ? now.currentMileage : null;
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
  if (skippedFrom != null) {
    return {
      notice: `Fill-up saved. The odometer stayed at ${skippedFrom.toLocaleString()} — ${mileage.toLocaleString()} is more than ${MAX_FUEL_ODOMETER_JUMP.toLocaleString()} mi past it. If that's right, use Update odometer.`,
    };
  }
  return {};
}

/** Deletes one fill-up outright — no cache depends on it (MPG is computed at read time). */
export async function deleteFuelLog(logId: string) {
  const profile = await requireAdult();

  await prisma.vehicleFuelLog.deleteMany({
    where: { id: logId, vehicle: { householdId: profile.householdId } },
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
}

const CAMPAIGN_NUMBER = /^[A-Z0-9]{1,20}$/i;

/**
 * The family's own "we've dealt with this" on an NHTSA recall — see VehicleRecallAck's
 * schema comment for why this is an attestation, not a verified remedy. Idempotent.
 */
export async function acknowledgeRecall(vehicleId: string, campaignNumber: string) {
  const profile = await requireAdult();
  if (!CAMPAIGN_NUMBER.test(campaignNumber)) return;

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, householdId: profile.householdId },
    select: { active: true },
  });
  if (!vehicle?.active) return;

  await prisma.vehicleRecallAck.upsert({
    where: { vehicleId_campaignNumber: { vehicleId, campaignNumber } },
    create: { vehicleId, campaignNumber, acknowledgedById: profile.id },
    update: {},
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
}

/** Undo for a mis-tapped "Mark handled" — a "Do not drive" recall must never stay hidden by accident. */
export async function unacknowledgeRecall(vehicleId: string, campaignNumber: string) {
  const profile = await requireAdult();

  await prisma.vehicleRecallAck.deleteMany({
    where: { vehicleId, campaignNumber, vehicle: { householdId: profile.householdId } },
  });

  revalidatePath("/(app)/vehicles", "layout");
  revalidatePath("/");
}

/**
 * Phase 53: "Look it up": the VIN decoded by NHTSA's vPIC, for the form to fill in (each field
 * stays editable). Grown-ups only, like the form; the VIN is never logged.
 */
export async function lookUpVin(vin: string): Promise<VinDecode> {
  await requireAdult();
  return decodeVin(typeof vin === "string" ? vin.slice(0, 40) : "");
}
