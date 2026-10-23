"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireJar } from "@/lib/finance/access";
import { logJarEvent } from "@/lib/finance/history";
import * as edits from "@/lib/finance/category-edits";
import { emojiSchema, listNameSchema } from "@/lib/list-names";
import type { EditState } from "@/components/list-editing";

/**
 * Phase 37: the jar's Categories page. Any member of the jar, through requireJar (members
 * only, own Microsoft sign-in); category ids are only ever looked up inside that jar
 * (lib/finance/category-edits.ts). Each change goes in the jar's history, logged after its
 * transaction commits, like the other money actions.
 */

const idSchema = z.string().min(1).max(64);
const categoryForm = z.object({ name: listNameSchema, emoji: emojiSchema });
const CHECK = "That didn't look right. Reload and try again.";

function readForm(formData: FormData) {
  return categoryForm.safeParse({ name: String(formData.get("name") ?? ""), emoji: String(formData.get("emoji") ?? "") });
}

/** Category names show on Activity, Budget, Trends, Bills and the history. */
const revalidateJar = (jarId: string) => revalidatePath(`/finances/${jarId}`, "layout");

export async function renameCategory(jarId: string, categoryId: string, _prev: EditState, formData: FormData): Promise<EditState> {
  const { jar, viewer } = await requireJar(jarId);
  const id = idSchema.safeParse(categoryId);
  if (!id.success) return { error: CHECK };
  const input = readForm(formData);
  if (!input.success) return { error: input.error.issues[0]?.message ?? CHECK };
  const result = await edits.renameCategory(jar.id, id.data, input.data);
  if (!result.ok) return { error: result.error };
  if (result.changed) {
    await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "CATEGORY_RENAMED", data: { from: result.from, to: result.to, emoji: result.emoji } });
  }
  revalidateJar(jar.id);
  return { ok: "Saved." };
}

// Transfers has the one built-in category: money moving between accounts needs no more.
const addForm = categoryForm.extend({ kind: z.enum(["SPEND", "INCOME"], { message: "Pick Spending or Income." }) });

export async function addCategory(jarId: string, _prev: EditState, formData: FormData): Promise<EditState> {
  const { jar, viewer } = await requireJar(jarId);
  const input = addForm.safeParse({
    name: String(formData.get("name") ?? ""),
    emoji: String(formData.get("emoji") ?? ""),
    kind: String(formData.get("kind") ?? ""),
  });
  if (!input.success) return { error: input.error.issues[0]?.message ?? CHECK };
  const result = await edits.addCategory(jar.id, input.data);
  if (!result.ok) return { error: result.error };
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "CATEGORY_ADDED", data: { name: result.name, emoji: result.emoji, kind: result.kind } });
  revalidateJar(jar.id);
  return { ok: `Added ${result.name}.` };
}

/** `to` is the category its charges, rules and budget move to. */
export async function removeCategory(jarId: string, categoryId: string, _prev: EditState, formData: FormData): Promise<EditState> {
  const { jar, viewer } = await requireJar(jarId);
  const id = idSchema.safeParse(categoryId);
  const to = idSchema.safeParse(String(formData.get("to") ?? ""));
  if (!id.success || !to.success) return { error: CHECK };
  const result = await edits.removeCategory(jar.id, id.data, to.data);
  if (!result.ok) return { error: result.error };
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "CATEGORY_REMOVED", data: { name: result.name, to: result.to } });
  revalidateJar(jar.id);
  return { ok: `Removed ${result.name}.` };
}
