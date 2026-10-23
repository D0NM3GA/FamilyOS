import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";

/**
 * Phase 42.7: the emergency local entrance for a Cloudflare outage, off unless turned on from the
 * server (scripts/break-glass.sh). Turning it on writes a state file with a fresh random secret
 * and when it ends (24 hours at most), mounted read-only into the app; the local Caddy sends that
 * secret as a header (and strips any incoming one). A request skips the Cloudflare Access check
 * only when its header matches an unexpired state file. The app's own sign-in is still required.
 */
export const BREAK_GLASS_HEADER = "x-familyos-break-glass";
export const BREAK_GLASS_MAX_MS = 24 * 60 * 60 * 1000;

export type BreakGlassState = { id: string; secret: string; startedAt: Date; endsAt: Date };

const statePath = () => process.env.BREAK_GLASS_STATE?.trim() || "/run/familyos/break-glass/state.json";

let cache: { at: number; path: string; state: BreakGlassState | null } | null = null;
/** Read at most every few seconds: the proxy asks on every request. */
const CACHE_MS = 5_000;

export function parseBreakGlass(text: string, now: number): BreakGlassState | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.secret !== "string" || raw.secret.length < 32) return null;
    const startedAt = new Date(String(raw.startedAt));
    const endsAt = new Date(String(raw.endsAt));
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
    // Never longer than 24 hours, whatever the file says, and only while it lasts.
    if (endsAt.getTime() - startedAt.getTime() > BREAK_GLASS_MAX_MS) return null;
    if (startedAt.getTime() > now + 60_000 || endsAt.getTime() <= now) return null;
    return { id: raw.id, secret: raw.secret, startedAt, endsAt };
  } catch {
    return null;
  }
}

/** The break-glass entrance if it's on right now, else null. */
export async function readBreakGlass(now = Date.now()): Promise<BreakGlassState | null> {
  const path = statePath();
  if (cache && cache.path === path && now - cache.at < CACHE_MS) {
    return cache.state && cache.state.endsAt.getTime() > now ? cache.state : null;
  }
  const state = await readFile(path, "utf8").then(
    (text) => parseBreakGlass(text, now),
    () => null,
  );
  cache = { at: now, path, state };
  return state;
}

export async function breakGlassAllows(header: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!header) return false;
  const state = await readBreakGlass(now);
  if (!state) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(state.secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Test support. */
export function resetBreakGlassCache(): void {
  cache = null;
}
