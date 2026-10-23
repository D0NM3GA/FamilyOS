"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { checkHomePoint, checkHomeZip, type HomeCheck } from "@/lib/zip";

/**
 * Phase 45.1 (a kernel: Settings, the guided setup and Chores use it): where home is, for rain flags on outdoor chores (lib/weather.ts), from a phone's
 * location or a typed ZIP code; never typed coordinates. Admins only, like the rest of the
 * household's settings. The phone rounds its point before sending it, and checkHomePoint
 * rounds again, so nothing finer than about a kilometre is kept.
 */
export type HomeInput = { via: "device"; latitude: number; longitude: number } | { via: "zip"; zip: string };
export type HomeLocationResult = { ok: true; nearZip: string } | { ok: false; error: string };

function check(input: HomeInput): HomeCheck {
  if (input?.via === "device") return checkHomePoint(input.latitude, input.longitude);
  if (input?.via === "zip") return checkHomeZip(input.zip);
  return { ok: false, reason: "invalid" };
}

function explain(input: HomeInput, result: Extract<HomeCheck, { ok: false }>): string {
  switch (result.reason) {
    case "outside":
      return "That's outside the US. Rain warnings come from the US National Weather Service, so they only work for homes in the US.";
    case "unknownZip":
      return `There's no ZIP code ${input.via === "zip" ? input.zip.trim() : ""} on the map. It may be a PO box: try a nearby ZIP code, or use this phone's location.`;
    default:
      return input.via === "zip" ? "A ZIP code is 5 digits." : "That location didn't come through. Try again, or type a ZIP code.";
  }
}

/** What would be saved ("near ZIP 12345"), without saving it: the confirm step. */
export async function checkHomeLocation(input: HomeInput): Promise<HomeLocationResult> {
  await requireAdmin();
  const result = check(input);
  return result.ok ? { ok: true, nearZip: result.nearZip } : { ok: false, error: explain(input, result) };
}

export async function saveHomeLocation(input: HomeInput): Promise<HomeLocationResult> {
  const admin = await requireAdmin();
  const result = check(input);
  if (!result.ok) return { ok: false, error: explain(input, result) };
  await prisma.household.update({
    where: { id: admin.householdId },
    data: { latitude: result.latitude, longitude: result.longitude },
  });
  revalidatePath("/", "layout");
  return { ok: true, nearZip: result.nearZip };
}

export async function clearHomeLocation(): Promise<void> {
  const admin = await requireAdmin();
  await prisma.household.update({ where: { id: admin.householdId }, data: { latitude: null, longitude: null } });
  revalidatePath("/", "layout");
}
