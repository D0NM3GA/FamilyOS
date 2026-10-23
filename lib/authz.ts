import { requireActiveProfile } from "@/lib/active-profile";

type RoleBearing = { role: "ADULT" | "KID" | "ADMIN" | null };

/** ADMIN is a superset of ADULT everywhere "adult" gating applies. */
export function isAdult(profile: RoleBearing): boolean {
  return profile.role === "ADULT" || profile.role === "ADMIN";
}

/**
 * Fetches the active profile and throws if it isn't an adult — for use inside server
 * actions (which throw on rejection), not pages (which render an inline message; check
 * `isAdult(profile)` directly there instead, see lib/authz.ts callers in app/(app)/chores).
 */
export async function requireAdult() {
  const profile = await requireActiveProfile();
  if (!isAdult(profile)) {
    throw new Error("Only adults can do that");
  }
  return profile;
}

/** Kids may only act on records they themselves own (e.g. their own chore instance). */
export function assertOwnRecord(profile: RoleBearing & { id: string }, ownerId: string | null) {
  if (!isAdult(profile) && ownerId !== profile.id) {
    throw new Error("You can only act on your own records");
  }
}

/** True household-admin powers (member management) — ADMIN only, not just any adult. */
export function isAdmin(profile: RoleBearing): boolean {
  return profile.role === "ADMIN";
}

/** Fetches the active profile and throws if it isn't an admin — for admin-only server actions. */
export async function requireAdmin() {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile)) {
    throw new Error("Only admins can do that");
  }
  return profile;
}
