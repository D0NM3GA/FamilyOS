import { appNameOrDefault, appNameLength, cleanAppName, DEFAULT_APP_NAME } from "@/lib/app-name";
import { DEFAULT_REWARD_WORDS, rewardWordsOf, type RewardWords } from "@/lib/reward-words";
import { DEFAULT_THEME_COLOR, themeColorOf } from "@/lib/theme-colors";

/**
 * Phase 35: everything a family sets in Settings → Make it yours, read as one: the app's
 * name, the top bar color, what the kids earn, the mascot and the Home Screen icon. Pages
 * get it from getFamilyLook (lib/household-settings.ts), client components from
 * useFamilyLook (components/family-look.tsx). Every default is the app as it always looked.
 * Pure, so the client can use it too.
 */

export const DEFAULT_MASCOT_NAME = "Bunson";
export const MASCOT_NAME_MAX = 20;

export type AppIconKind = "BUNNY" | "LETTER";

export type FamilyLook = {
  appName: string;
  /** A preset id from lib/theme-colors.ts. */
  themeColor: string;
  reward: RewardWords;
  mascot: { on: boolean; name: string };
  appIcon: AppIconKind;
};

export const DEFAULT_LOOK: FamilyLook = {
  appName: DEFAULT_APP_NAME,
  themeColor: DEFAULT_THEME_COLOR,
  reward: DEFAULT_REWARD_WORDS,
  mascot: { on: true, name: DEFAULT_MASCOT_NAME },
  appIcon: "BUNNY",
};

/** The Household columns behind it, for a Prisma `select`. */
export const LOOK_SELECT = {
  appName: true,
  themeColor: true,
  rewardOne: true,
  rewardMany: true,
  rewardStore: true,
  mascotOn: true,
  mascotName: true,
  appIcon: true,
} as const;

type LookRow = {
  appName: string | null;
  themeColor: string | null;
  rewardOne: string | null;
  rewardMany: string | null;
  rewardStore: string | null;
  mascotOn: boolean;
  mascotName: string | null;
  appIcon: AppIconKind;
};

/** A mascot name made safe to keep, or null (Bunson) when nothing usable is left. */
export function cleanMascotName(raw: string | null | undefined): string | null {
  const name = cleanAppName(raw);
  return name && appNameLength(name) <= MASCOT_NAME_MAX ? name : null;
}

/**
 * The letter for the "first letter" icon, or null for the bunny instead. Plain A–Z and 0–9
 * only: the icon renderer bundles a basic Latin font and fetches any glyph it lacks
 * (accented letters, other scripts, other digits) from Google at request time, which would
 * send the family's letter out of the house.
 */
export function iconLetter(appName: string): string | null {
  const first = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(appName)][0]?.segment ?? "";
  return /^[A-Za-z0-9]$/.test(first) ? first.toUpperCase() : null;
}

export function familyLookOf(row: LookRow | null | undefined): FamilyLook {
  if (!row) return DEFAULT_LOOK;
  return {
    appName: appNameOrDefault(row.appName),
    themeColor: themeColorOf(row.themeColor).id,
    reward: rewardWordsOf(row),
    mascot: { on: row.mascotOn, name: cleanMascotName(row.mascotName) ?? DEFAULT_MASCOT_NAME },
    appIcon: row.appIcon,
  };
}
