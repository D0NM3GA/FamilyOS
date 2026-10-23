import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { consumeToken, findToken, storeToken } from "@/lib/one-time-tokens";

/**
 * Phase 40.1c: setting up a brand-new install. The owner's call: whoever opens it first sets it
 * up (docs/BUILD.md Phase 40 has the risk). Two steps, so a failure halfway can't strand the
 * install (Fable's scope review):
 *
 * 1. Register a passkey. The setup form gets a single-use token (a `verification` row holding
 *    the household name, first name and email, 15 minutes, only while there's no household).
 *    The passkey plugin's `resolveUser` checks it without using it up; `afterVerification`
 *    uses it up and creates the new user (never an existing one), and the plugin signs them in.
 *    If anything fails there, at worst a user with no household and no person is left, who can
 *    do nothing.
 * 2. Finish: signed in as that user, `finishSetup` creates the household and their Admin
 *    person, under a lock that re-checks "no household yet", so two visitors can't both.
 *
 * A Microsoft setup skips step 1: the first Microsoft sign-in (with the Admin role in Entra)
 * goes straight to step 2.
 */

export const SETUP_TOKEN_MINUTES = 15;
const FINISH_HOURS = 1;
// One household never needs more than a few tries at once; a cap keeps the form from being a
// way to fill the database before setup.
const MAX_LIVE_SETUP_TOKENS = 20;

export const setupDetailsSchema = z.object({
  householdName: z.string().trim().min(1, "Give your household a name.").max(60, "Keep the household's name to 60 characters."),
  firstName: z.string().trim().min(1, "Your first name, please.").max(40, "Keep your first name to 40 characters."),
  email: z.string().trim().toLowerCase().max(254).email("That email doesn't look right."),
});
export type SetupDetails = z.infer<typeof setupDetailsSchema>;

export const finishDetailsSchema = setupDetailsSchema.pick({ householdName: true, firstName: true });
export type FinishDetails = z.infer<typeof finishDetailsSchema>;

/** Thrown when setup can't go ahead; the message is fixed text, safe to show. */
export class SetupError extends Error {}

// Stored hashed (lib/one-time-tokens.ts).
const TOKEN = "setup";
const finishIdentifier = (userId: string) => `setup-finish:${userId}`;

// Once a household exists it never goes away again, so after that no query is needed.
let setUp = false;

/** Whether this install has been set up (has a household). */
export async function isSetUp(): Promise<boolean> {
  if (setUp) return true;
  setUp = (await prisma.household.count()) > 0;
  return setUp;
}

function parseDetails(value: string): SetupDetails | null {
  try {
    const parsed = setupDetailsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Step 1, the form: a single-use token for registering the first passkey. */
export async function createSetupToken(details: SetupDetails): Promise<string> {
  if (await isSetUp()) throw new SetupError("This app is already set up. Sign in instead.");
  await prisma.verification.deleteMany({ where: { identifier: { startsWith: `${TOKEN}:` }, expiresAt: { lt: new Date() } } });
  if ((await prisma.verification.count({ where: { identifier: { startsWith: `${TOKEN}:` } } })) >= MAX_LIVE_SETUP_TOKENS) {
    throw new SetupError("Too many setup attempts at once. Wait a few minutes and try again.");
  }
  return storeToken(TOKEN, JSON.stringify(details), new Date(Date.now() + SETUP_TOKEN_MINUTES * 60_000));
}

/** What a setup token holds, without using it up (the passkey's resolveUser). Null when it isn't a live one. */
export async function readSetupToken(token: string | null | undefined): Promise<SetupDetails | null> {
  const row = await findToken(TOKEN, token);
  return row ? parseDetails(row.value) : null;
}

/** Uses a setup token up, once: only one caller ever gets its details back. */
export async function consumeSetupToken(token: string | null | undefined): Promise<SetupDetails | null> {
  const value = await consumeToken(TOKEN, token);
  return value === null ? null : parseDetails(value);
}

/** Keeps the household's name and the first name for step 2, for the user step 1 created. */
export async function saveFinishDetails(userId: string, details: FinishDetails): Promise<void> {
  await prisma.verification.deleteMany({ where: { identifier: finishIdentifier(userId) } });
  await prisma.verification.create({
    data: { identifier: finishIdentifier(userId), value: JSON.stringify(details), expiresAt: new Date(Date.now() + FINISH_HOURS * 3_600_000) },
  });
}

/** Step 2's details, if step 1 left them (null after an hour, or for a Microsoft setup). */
export async function readFinishDetails(userId: string): Promise<FinishDetails | null> {
  const row = await prisma.verification.findFirst({ where: { identifier: finishIdentifier(userId), expiresAt: { gt: new Date() } } });
  if (!row) return null;
  try {
    const parsed = finishDetailsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Removes every expired `verification` row (passkey challenges, setup tokens, finish details).
 * Better Auth only clears them on paths this app has turned off (passwords) or, for Microsoft,
 * at its sign-in, so the background tick does it (lib/background.ts).
 */
export async function purgeExpiredVerifications(): Promise<number> {
  const { count } = await prisma.verification.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

/**
 * Step 2: creates the household and the signed-in user's Admin person, once for the install.
 * The advisory lock makes concurrent finishes take turns, and the "no household yet" check
 * inside it means only the first one does anything.
 */
export async function finishSetup(user: { id: string; email: string | null }, details: FinishDetails, timezone: string | null = null): Promise<string> {
  const adminId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('familyos-setup'))`;
    if ((await tx.household.count()) > 0) throw new SetupError("This app is already set up.");
    if (await tx.person.findFirst({ where: { authUserId: user.id }, select: { id: true } })) {
      throw new SetupError("This sign-in already belongs to someone here.");
    }
    // Phase 45.2: the setting-up device's zone (already checked and canonical), not left empty.
    const household = await tx.household.create({ data: { name: details.householdName, timezone } });
    const admin = await tx.person.create({
      data: { householdId: household.id, firstName: details.firstName, email: user.email, role: "ADMIN", isHouseholdMember: true, authUserId: user.id },
      select: { id: true },
    });
    await tx.verification.deleteMany({ where: { identifier: finishIdentifier(user.id) } });
    return admin.id;
  });
  setUp = true;
  return adminId;
}
