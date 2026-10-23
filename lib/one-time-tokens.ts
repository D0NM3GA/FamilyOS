import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Single-use tokens kept in Better Auth's `verification` table: setup's (lib/setup.ts) and
 * adding a passkey while signed in (lib/my-passkeys.ts). Stored hashed, so a database read
 * alone never yields a usable one, and each kind has its own prefix, so one kind's token is
 * never taken for another's. Expired rows go in the background tick (purgeExpiredVerifications).
 */

const identifier = (prefix: string, token: string) => `${prefix}:${createHash("sha256").update(token).digest("hex")}`;

/** Stores `value` under a new random token; returns the token (the only copy). */
export async function storeToken(prefix: string, value: string, expiresAt: Date, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.verification.create({ data: { identifier: identifier(prefix, token), value, expiresAt } });
  return token;
}

/** A live token's row, without using it up. */
export async function findToken(prefix: string, token: string | null | undefined) {
  if (!token || token.length > 100) return null;
  return prisma.verification.findFirst({ where: { identifier: identifier(prefix, token), expiresAt: { gt: new Date() } } });
}

/**
 * Uses a token up, once: only one caller ever gets its value back. `accept` can refuse it
 * first (a token bound to someone else), and a refused token is left as it was.
 */
export async function consumeToken(prefix: string, token: string | null | undefined, accept: (value: string) => boolean = () => true): Promise<string | null> {
  const row = await findToken(prefix, token);
  if (!row || !accept(row.value)) return null;
  const { count } = await prisma.verification.deleteMany({ where: { id: row.id } });
  return count === 1 ? row.value : null;
}
