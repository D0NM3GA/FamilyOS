import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { fingerprint } from "@/lib/crypto";

/**
 * The list's "Undo" after − takes a row off. The removed row travels to the phone and back
 * as a signed token rather than being kept on the server (there's no table for it), so the
 * undo puts back exactly what was taken off: same amount, same "for", same kid-pick flag.
 * The signature is why the server can trust it: a hand-made request can't invent a row,
 * say a kid's pick with the flag cleared so a grown-up can't veto it.
 */

/** Long enough for a slow phone on bad signal; the bar itself hides after a few seconds. */
export const UNDO_TTL_MS = 2 * 60 * 1000;

const removedRow = z.object({
  productId: z.string().min(1).max(64),
  quantity: z.number().finite().positive().max(1_000_000),
  done: z.boolean(),
  addedById: z.string().min(1).max(64).nullable(),
  requestedById: z.string().min(1).max(64).nullable(),
  kidPick: z.boolean(),
});
export type RemovedRow = z.infer<typeof removedRow>;

const payload = z.object({ h: z.string().min(1), t: z.number().int(), r: removedRow });

// Its own HKDF label, so this key signs nothing else.
const sign = (body: string) => fingerprint("groceries-undo", body);

export function sealRemoved(row: RemovedRow, householdId: string, now: Date = new Date()): string {
  const body = Buffer.from(JSON.stringify({ h: householdId, t: now.getTime(), r: row }), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The row back out of a token, or null when it's forged, from another family, or stale. */
export function openRemoved(token: string, householdId: string, now: Date = new Date()): RemovedRow | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(sign(body), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = payload.safeParse(value);
  if (!parsed.success || parsed.data.h !== householdId) return null;
  const age = now.getTime() - parsed.data.t;
  if (age < 0 || age > UNDO_TTL_MS) return null;
  return parsed.data.r;
}
