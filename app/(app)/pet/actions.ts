"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveProfile } from "@/lib/active-profile";
import { appOn } from "@/lib/app-switches";
import { clean, feedMeal, feedSnack, giveMedicine, petIt, play, sayNo, type CareOutcome } from "@/lib/pet/care";
import { isToy, ROOM_SLOTS, type Place } from "@/lib/pet/items";
import { PET_SPOTS } from "@/lib/pet/personality";
import { isGame } from "@/lib/pet/games/catalog";
import { changeMyPet, finishMyGame, getMyItem, hatchEgg, openMyPresent, placeMyItem, renameMyPet, type ChangeResult, type OpenedPresent } from "@/lib/pet/queries";
import { SPECIES } from "@/lib/pet/state";
import { cleanPetName } from "@/lib/pet/words";

/**
 * Phase 47: the pet's actions. Thin wrappers: each checks the Pet app is on, parses its input
 * and hands the signed-in profile to lib/pet/queries.ts, which only ever touches that
 * profile's own pet and items. Nothing here touches points, stickers or the Store.
 */

async function petProfile() {
  const profile = await requireActiveProfile();
  if (!(await appOn(profile.householdId, "pet"))) redirect("/apps-off/pet");
  return profile;
}

/** A database row id from the browser: a cuid, never anything long or odd. */
const rowId = z.string().regex(/^[a-z0-9]{10,40}$/);

export type CareReply = { outcome: CareOutcome | "no-pet" | "gone" | "asleep" | "busy" | "played-recently" };

function reply(change: ChangeResult | { ok: false; reason: "played-recently" }): CareReply {
  revalidatePath("/pet");
  return { outcome: change.ok ? change.result.outcome : change.reason };
}

const careKind = z.enum(["meal", "snack", "clean", "medicine", "no"]);

export async function careForPet(kind: string): Promise<CareReply> {
  const profile = await petProfile();
  const parsed = careKind.safeParse(kind);
  if (!parsed.success) return { outcome: "no-pet" };
  return reply(
    await changeMyPet(profile, (state, minute) => {
      switch (parsed.data) {
        case "meal":
          return feedMeal(state);
        case "snack":
          return feedSnack(state, minute);
        case "clean":
          return clean(state);
        case "medicine":
          return giveMedicine(state);
        case "no":
          return sayNo(state);
      }
    }),
  );
}

export async function petPet(spot: string): Promise<CareReply & { favorite: boolean }> {
  const profile = await petProfile();
  const parsed = z.enum(PET_SPOTS).safeParse(spot);
  if (!parsed.success) return { outcome: "no-pet", favorite: false };
  let favorite = false;
  const change = await changeMyPet(profile, (state, minute, personality) => {
    favorite = personality.favoriteSpot === parsed.data;
    return petIt(state, minute, favorite);
  });
  return { ...reply(change), favorite: change.ok && change.result.outcome === "ok" && favorite };
}

/** Playing with a toy together: a little fun for a little energy, and more with its favorite. */
export async function playWithToy(itemRowId: string): Promise<CareReply & { favorite: boolean }> {
  const profile = await petProfile();
  const id = rowId.safeParse(itemRowId);
  if (!id.success) return { outcome: "no-pet", favorite: false };
  const owned = await getMyItem(profile.id, id.data);
  if (!owned || !isToy(owned.itemId)) return { outcome: "no-pet", favorite: false };
  let favorite = false;
  const change = await changeMyPet(profile, (state, _minute, personality) => {
    favorite = personality.favoriteToy === owned.itemId;
    return play(state, { fun: favorite ? 30 : 15, energy: 8 });
  });
  return { ...reply(change), favorite: change.ok && change.result.outcome === "ok" && favorite };
}

/** A finished mini-game round, with its score; the effect is capped on the server. */
export async function finishGame(game: string, score: number): Promise<CareReply> {
  const profile = await petProfile();
  if (!isGame(game)) return { outcome: "no-pet" };
  // A score that isn't a sensible number counts as zero (the effect is capped on the server anyway).
  const points = z.number().finite().min(0).max(10_000).safeParse(score);
  return reply(await finishMyGame(profile, game, points.success ? points.data : 0));
}

export async function openPresent(presentId: string): Promise<OpenedPresent> {
  const profile = await petProfile();
  const id = rowId.safeParse(presentId);
  if (!id.success) return { ok: false, reason: "no-present" };
  const result = await openMyPresent(profile, id.data);
  revalidatePath("/pet");
  return result;
}

const hatchForm = z.object({ species: z.enum(SPECIES), name: z.string() });

export type HatchState = { error?: string };

export async function hatchPet(_prev: HatchState, formData: FormData): Promise<HatchState> {
  const profile = await petProfile();
  const parsed = hatchForm.safeParse({ species: formData.get("species"), name: formData.get("name") });
  if (!parsed.success) return { error: "Pick an egg first." };
  const name = cleanPetName(parsed.data.name);
  if (!name) return { error: "Give your pet a name (letters and numbers)." };
  await hatchEgg(profile, parsed.data.species, name);
  revalidatePath("/pet");
  return {};
}

export async function renamePet(_prev: HatchState, formData: FormData): Promise<HatchState> {
  const profile = await petProfile();
  const name = cleanPetName(formData.get("name"));
  if (!name) return { error: "Give your pet a name (letters and numbers)." };
  await renameMyPet(profile, name);
  revalidatePath("/pet");
  return {};
}

const placeInput = z.enum([...ROOM_SLOTS, "out", "worn", "box"]);

/** Puts an item somewhere: a room slot, out on the floor, worn, or back in the toy box. */
export async function placeItem(itemRowId: string, place: string): Promise<{ ok: boolean }> {
  const profile = await petProfile();
  const id = rowId.safeParse(itemRowId);
  const parsed = placeInput.safeParse(place);
  if (!id.success || !parsed.success) return { ok: false };
  const ok = await placeMyItem(profile, id.data, parsed.data === "box" ? null : (parsed.data as Place));
  revalidatePath("/pet");
  return { ok };
}
