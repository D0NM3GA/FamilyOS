"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdult } from "@/lib/authz";
import { DocumentError, analyzeDocument } from "@/lib/documents/client";
import { parseReceipt } from "@/lib/documents/receipt";
import { captureError } from "@/lib/observability";
import { prepareReceipt, saveReceiptPrices, type PreparedReceipt } from "@/lib/groceries/receipts";

const MAX_BYTES = 3 * 1024 * 1024;

export type ReadState = { status: "idle" } | { status: "error"; message: string } | { status: "ready"; receipt: PreparedReceipt };

/** JPEG or PNG by their first bytes, not by the file's claimed type. */
function sniffImage(bytes: Uint8Array): boolean {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return jpeg || png;
}

/**
 * Phase 24: reads a receipt photo and returns it matched for review. Grown-ups only (prices
 * are money). The photo is sent to Document Intelligence and then dropped; nothing about
 * the receipt is stored until the review is saved.
 */
export async function readReceipt(_prev: ReadState, formData: FormData): Promise<ReadState> {
  const profile = await requireAdult();
  const file = formData.get("photo");
  const purchaseId = typeof formData.get("purchase") === "string" ? String(formData.get("purchase")).slice(0, 64) || null : null;
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Pick a photo of the receipt first." };
  if (file.size > MAX_BYTES) return { status: "error", message: "That photo is too big. Try again, or take a closer shot." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImage(bytes)) return { status: "error", message: "That isn't a photo the receipt reader can read (JPEG or PNG)." };

  try {
    const result = await analyzeDocument({ model: "prebuilt-receipt", bytes });
    const receipt = parseReceipt(result);
    if (receipt.lines.length === 0) {
      return { status: "error", message: "Couldn't find any items on that. Try a flatter, brighter shot of the whole receipt." };
    }
    return { status: "ready", receipt: await prepareReceipt(profile.householdId, receipt, { purchaseId }) };
  } catch (err) {
    if (err instanceof DocumentError) {
      // Fixed text only (see lib/documents/client.ts), safe to report as-is.
      if (err.kind !== "notConfigured" && err.kind !== "busy") captureError(new Error(`Receipt read failed: ${err.kind}`));
      return { status: "error", message: err.message };
    }
    captureError(new Error("Receipt read failed: unexpected"));
    return { status: "error", message: "Something went wrong reading that receipt. Try again." };
  }
}

const cents = z.int32().min(-10_000_000).max(10_000_000).nullable();
const reviewSchema = z.object({
  purchaseId: z.string().max(64).nullable(),
  storeId: z.string().max(64).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  lines: z
    .array(
      z.object({
        key: z.string().max(120),
        productId: z.string().max(64).nullable(),
        quantity: z.number().finite().positive().max(10_000).nullable(),
        unitCents: cents,
        totalCents: cents,
        initialProductId: z.string().max(64).nullable(),
        initialHow: z.enum(["learned", "suggested", "none"]),
      }),
    )
    .max(100),
});

/** Saves the reviewed prices and learned matches. Grown-ups only; every id household-checked. */
export async function saveReceipt(review: z.input<typeof reviewSchema>): Promise<{ error: string } | void> {
  const profile = await requireAdult();
  const parsed = reviewSchema.safeParse(review);
  if (!parsed.success) return { error: "Something about that receipt didn't look right. Try reading it again." };
  const saved = await saveReceiptPrices(profile.householdId, parsed.data);
  revalidatePath("/groceries");
  revalidatePath("/groceries/pantry");
  revalidatePath("/groceries/trips");
  redirect(`/groceries?prices=${saved}`);
}
