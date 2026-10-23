import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { DEFAULT_LOOK, familyLookOf, LOOK_SELECT, type FamilyLook } from "@/lib/family-look";
import type { RewardWords } from "@/lib/reward-words";

/**
 * Phase 39: the household row, read once per request for everything the layout and its pages
 * take from it (settings and look here, app switches in lib/app-switches.ts), instead of three
 * selects of the same row. `React.cache` memoizes by argument for one render pass; outside a
 * render (a server action, an icon) it's a plain call.
 */
export const getHouseholdRow = cache(async (householdId: string) =>
  prisma.household.findUnique({
    where: { id: householdId },
    select: { id: true, name: true, timezone: true, dayZone: true, latitude: true, longitude: true, disabledApps: true, ...LOOK_SELECT },
  }),
);

/** The household's settings (name, app name, timezone, location). Throws if it's gone. */
export const getHouseholdSettings = cache(async (householdId: string) => {
  const row = await getHouseholdRow(householdId);
  if (!row) throw new Error(`Household ${householdId} not found.`);
  const { id, name, appName, timezone, dayZone, latitude, longitude } = row;
  return { id, name, appName, timezone, dayZone, latitude, longitude };
});

/**
 * The family's look (Settings → Make it yours: name, colors, reward words, mascot, icon).
 * Without a household id (sign-in, the manifest, the icons: nobody is known yet) it's this
 * install's household, the oldest, like first sign-ins (lib/active-profile.ts). Never
 * throws: it's decoration, so a database hiccup shows the defaults instead of an error page.
 */
export const getFamilyLook = cache(async (householdId?: string): Promise<FamilyLook> => {
  try {
    const row = householdId
      ? await getHouseholdRow(householdId)
      : await prisma.household.findFirst({ orderBy: { createdAt: "asc" }, select: LOOK_SELECT });
    return familyLookOf(row);
  } catch (err) {
    captureError(err);
    return DEFAULT_LOOK;
  }
});

/** The family's name for the app, or FamilyOS (see getFamilyLook). */
export async function getAppName(householdId?: string): Promise<string> {
  return (await getFamilyLook(householdId)).appName;
}

/** What the kids earn and the store's name, or stickers (see getFamilyLook). */
export async function getRewardWords(householdId?: string): Promise<RewardWords> {
  return (await getFamilyLook(householdId)).reward;
}

/**
 * Resolves a timezone string to its canonical IANA form (e.g. "america/new_york" or "EST5EDT"
 * both normalize to "America/New_York" via `Intl`'s own alias table), or null if `Intl`
 * doesn't recognize it at all. Always store the canonical form, not whatever the user typed:
 * the server's clock is set to it (lib/household-zone.ts), and a non-canonical name there would
 * quietly become UTC.
 */
export function canonicalizeTimeZone(timezone: string): string | null {
  try {
    return Intl.DateTimeFormat(undefined, { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** True for any string `Intl` accepts as an IANA zone — the same check the settings form runs. */
export function isValidTimeZone(timezone: string): boolean {
  return canonicalizeTimeZone(timezone) !== null;
}

/** Every IANA zone name this Node runtime knows about, for the settings form's picker. */
export function listTimeZones(): string[] {
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      // fall through to the empty list below
    }
  }
  return [];
}
