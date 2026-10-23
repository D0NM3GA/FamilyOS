import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

declare global {
  // `ReturnType<typeof createPrismaClient>`, not `PrismaClient` — the generated client's
  // omit-tracking generic is invariant, so a plain `PrismaClient` here wouldn't accept the
  // client below (typed with its `omit` config baked in) without a cast.
  var __prisma: ReturnType<typeof createPrismaClient> | undefined;
}

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  // Global default: never return `pinHash` or `photo` unless a query explicitly opts back
  // in with `omit: { <field>: false }` (pinHash: only app/profiles/actions.ts, to verify a
  // PIN) or `select: { <field>: true }` (photo: only the dedicated photo route — see
  // prisma/schema.prisma's Person.photo doc comment). Closes the PII/credential leak where
  // full Person rows — including the PIN's argon2 hash — were reaching "use client"
  // components verbatim (see docs/BUILD.md's security remediation phase for the audit that
  // found this).
  return new PrismaClient({ adapter, omit: { person: { pinHash: true, photo: true } } });
}

export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

/** An interactive-transaction client, for helpers that run inside or outside one. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
