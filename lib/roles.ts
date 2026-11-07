/**
 * The role test on its own, free of server imports (Phase 59.1a), so pure modules a client might
 * import (lib/school/permissions.ts, lib/work-items) can use it. lib/authz.ts re-exports it.
 */
export type RoleBearing = { role: "ADULT" | "KID" | "ADMIN" | null };

/** ADMIN is a superset of ADULT everywhere "adult" gating applies. */
export function isAdult(profile: RoleBearing): boolean {
  return profile.role === "ADULT" || profile.role === "ADMIN";
}
