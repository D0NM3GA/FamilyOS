"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdult } from "@/lib/authz";
import { parseSupplyForm, roundQuantity, type SupplyFields } from "@/lib/vehicles/supplies";
import { addStock } from "@/lib/vehicles/supply-stock";

/** Garage supplies (Phase 12.5). Adults only, like the page. */
export type SupplyFormState = { error?: string };

async function nameTaken(householdId: string, name: string, exceptId?: string) {
  // The unique index is case-sensitive; "Motor Oil" and "motor oil" are one supply to a person.
  const hit = await prisma.vehicleSupply.findFirst({
    where: { householdId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return hit != null;
}

const duplicateName = (name: string) => ({ error: `There's already a supply called "${name}".` });

/** The check above can race another adult saving the same name; the unique index is the backstop. */
async function saveOrDuplicate(fields: SupplyFields, write: () => Promise<unknown>): Promise<SupplyFormState | null> {
  try {
    await write();
    return null;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return duplicateName(fields.name);
    throw err;
  }
}

function revalidateSupplies() {
  revalidatePath("/(app)/vehicles", "layout");
}

export async function createSupply(_prev: SupplyFormState, formData: FormData): Promise<SupplyFormState> {
  const profile = await requireAdult();
  const parsed = parseSupplyForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  if (await nameTaken(profile.householdId, parsed.fields.name)) return duplicateName(parsed.fields.name);
  const failed = await saveOrDuplicate(parsed.fields, () =>
    prisma.vehicleSupply.create({ data: { householdId: profile.householdId, ...parsed.fields } }),
  );
  if (failed) return failed;
  revalidateSupplies();
  redirect("/vehicles/supplies");
}

export async function updateSupply(supplyId: string, _prev: SupplyFormState, formData: FormData): Promise<SupplyFormState> {
  const profile = await requireAdult();
  const parsed = parseSupplyForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  if (await nameTaken(profile.householdId, parsed.fields.name, supplyId)) return duplicateName(parsed.fields.name);
  let count = 0;
  const failed = await saveOrDuplicate(parsed.fields, async () => {
    ({ count } = await prisma.vehicleSupply.updateMany({ where: { id: supplyId, householdId: profile.householdId }, data: parsed.fields }));
  });
  if (failed) return failed;
  if (count === 0) return { error: "Supply not found." };
  revalidateSupplies();
  redirect("/vehicles/supplies");
}

/** Deactivate instead of delete: a delete would erase what past services took from it. */
export async function setSupplyActive(supplyId: string, active: boolean) {
  const profile = await requireAdult();
  await prisma.vehicleSupply.updateMany({ where: { id: supplyId, householdId: profile.householdId }, data: { active } });
  revalidateSupplies();
}

/**
 * "+ stock" after a shopping trip: one atomic UPDATE (lib/vehicles/supply-stock.ts), so it
 * can't lose a concurrent service log's decrement. Tracked supplies only.
 */
export async function addSupplyStock(supplyId: string, _prev: SupplyFormState, formData: FormData): Promise<SupplyFormState> {
  const profile = await requireAdult();
  const amount = Number(String(formData.get("amount") ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) return { error: "Enter an amount above zero." };
  if (!(await addStock(prisma, profile.householdId, supplyId, roundQuantity(amount)))) {
    return { error: "Set how many you have first (Edit)." };
  }
  revalidateSupplies();
  return {};
}
