import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Phase 51: what the finder found, handed to the browser sealed. Feed addresses can carry tokens,
 * so they never reach the page in the clear; the list goes back as one encrypted value bound to the
 * admin and household who searched and to a 15-minute expiry, and **Add** opens it and takes the
 * chosen entry. Nothing is kept in server memory, so a restart or a second app instance doesn't
 * matter.
 */

export type SealedEntry = { url: string; name: string };

const TTL_MS = 15 * 60_000;
const aad = (householdId: string, personId: string) => `schoolfinder:${householdId}:${personId}`;

export function sealFound(entries: SealedEntry[], who: { householdId: string; personId: string }, now = Date.now()): string {
  const s = encryptSecret(JSON.stringify({ exp: now + TTL_MS, entries }), aad(who.householdId, who.personId));
  return [s.iv, s.authTag, s.encryptedValue].map((b) => b.toString("base64url")).join(".");
}

/** The chosen entry, or null when the bundle is someone else's, changed, expired or out of range. */
export function openFound(sealed: string, index: number, who: { householdId: string; personId: string }, now = Date.now()): SealedEntry | null {
  const parts = typeof sealed === "string" && sealed.length < 20_000 ? sealed.split(".") : [];
  if (parts.length !== 3 || !Number.isInteger(index) || index < 0) return null;
  try {
    const [iv, authTag, encryptedValue] = parts.map((p) => Buffer.from(p, "base64url"));
    const data = JSON.parse(decryptSecret({ iv, authTag, encryptedValue }, aad(who.householdId, who.personId))) as { exp: number; entries: SealedEntry[] };
    if (typeof data.exp !== "number" || data.exp < now) return null;
    const entry = data.entries?.[index];
    return entry && typeof entry.url === "string" && typeof entry.name === "string" ? entry : null;
  } catch {
    return null;
  }
}
