"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdult } from "@/lib/authz";
import { emojiSchema, listNameSchema } from "@/lib/list-names";
import * as edits from "@/lib/groceries/section-edits";
import type { EditState } from "@/components/list-editing";

/**
 * Phase 37: the Store sections page. Grown-ups only (requireAdult throws for anyone else);
 * every write is scoped to the person's own household, and ids from the browser are only
 * ever looked up inside it (lib/groceries/section-edits.ts).
 */

const idSchema = z.string().min(1).max(64);
const sectionForm = z.object({ name: listNameSchema, emoji: emojiSchema });
const CHECK = "That didn't look right. Reload and try again.";

/** Sections order the list, the Pantry, Shop and the item sheet's picker. */
function revalidateSections() {
  revalidatePath("/groceries");
  revalidatePath("/groceries/pantry");
  revalidatePath("/groceries/shop");
  revalidatePath("/groceries/sections");
}

function readForm(formData: FormData) {
  return sectionForm.safeParse({ name: String(formData.get("name") ?? ""), emoji: String(formData.get("emoji") ?? "") });
}

export async function renameSection(sectionId: string, _prev: EditState, formData: FormData): Promise<EditState> {
  const profile = await requireAdult();
  const id = idSchema.safeParse(sectionId);
  if (!id.success) return { error: CHECK };
  const input = readForm(formData);
  if (!input.success) return { error: input.error.issues[0]?.message ?? CHECK };
  const result = await edits.renameSection(profile.householdId, id.data, input.data);
  if (!result.ok) return { error: result.error };
  revalidateSections();
  return { ok: "Saved." };
}

export async function addSection(_prev: EditState, formData: FormData): Promise<EditState> {
  const profile = await requireAdult();
  const input = readForm(formData);
  if (!input.success) return { error: input.error.issues[0]?.message ?? CHECK };
  const result = await edits.addSection(profile.householdId, input.data);
  if (!result.ok) return { error: result.error };
  revalidateSections();
  return { ok: `Added ${result.name} at the end. Move it up to where it is in the store.` };
}

/** The ↑ and ↓ buttons: plain forms, so they work before the page's script loads. */
export async function moveSection(sectionId: string, direction: "up" | "down") {
  const profile = await requireAdult();
  const id = idSchema.safeParse(sectionId);
  const dir = z.enum(["up", "down"]).safeParse(direction);
  if (!id.success || !dir.success) return;
  if (await edits.moveSectionStep(profile.householdId, id.data, dir.data)) revalidateSections();
}

/** `to` is another section's id, or "" for no section. */
export async function removeSection(sectionId: string, _prev: EditState, formData: FormData): Promise<EditState> {
  const profile = await requireAdult();
  const id = idSchema.safeParse(sectionId);
  const to = z.union([z.literal(""), idSchema]).safeParse(String(formData.get("to") ?? ""));
  if (!id.success || !to.success) return { error: CHECK };
  const result = await edits.removeSection(profile.householdId, id.data, to.data || null);
  if (!result.ok) return { error: result.error };
  revalidateSections();
  return { ok: `Removed ${result.name}.` };
}
