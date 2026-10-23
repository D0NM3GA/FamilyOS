import argon2 from "argon2";

/**
 * PIN hashing, in one place. Argon2id, the OWASP Password Storage Cheat Sheet's first choice,
 * with the settings spelled out rather than left to the library's defaults: 64 MiB, 3 passes,
 * 4 lanes, well above OWASP's floor (19 MiB, 2 passes, 1 lane). The `argon2` package (not
 * Node's own crypto.argon2, still experimental and without PHC strings or rehash checks).
 *
 * A PIN is short, so the hash is only half the protection: guesses are rate-limited and
 * locked out per profile (lib/pin-lockout.ts, app/profiles/actions.ts).
 */
const OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 4 } as const;

export function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, OPTIONS);
}

/**
 * Whether the PIN matches, and the hash to store instead when it was made with older settings
 * (rehash-on-login, so raising the settings later upgrades every PIN as people use them).
 */
export async function verifyPin(hash: string, pin: string): Promise<{ ok: boolean; rehashed: string | null }> {
  if (!(await argon2.verify(hash, pin))) return { ok: false, rehashed: null };
  return { ok: true, rehashed: argon2.needsRehash(hash, OPTIONS) ? await hashPin(pin) : null };
}
