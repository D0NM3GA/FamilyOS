/**
 * The app's display name. Each family picks its own in Settings → Make it yours (stored on
 * Household.appName, e.g. "SmithOS"); a new install is FamilyOS until they do. Code never
 * spells out a family's or product's name itself: pages read it with getAppName
 * (lib/household-settings.ts), client components with useAppName (components/family-look.tsx).
 * Pure, so the client can use it too.
 */

/**
 * The software's own name, for anything that leaves the house: User-Agent headers, Sentry's
 * server name, ids in files. Outside services never see a family's chosen name.
 */
export const PRODUCT_NAME = "FamilyOS";

export const DEFAULT_APP_NAME = PRODUCT_NAME;

/** Every name ends in this: a family types "Smith" and the app is SmithOS. */
export const APP_NAME_SUFFIX = "OS";

/** Long enough for most family names plus OS, short enough for a phone's top bar and Home Screen label. */
export const APP_NAME_MAX = 24;

/** The part a family types, so the whole name stays within APP_NAME_MAX. */
export const FAMILY_NAME_MAX = APP_NAME_MAX - APP_NAME_SUFFIX.length;

// Control characters and every invisible format character (zero-width spaces, bidi overrides
// and isolates, soft hyphens, BOM, tag characters), plus the combining grapheme joiner, any
// of which could make the name render as something else. The zero-width joiner stays:
// emoji like 👨‍👩‍👧 need it.
const UNSAFE = /(?!\u200D)[\p{Cc}\p{Cf}\u034F]/gu;

const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((g) => g.segment);

/** A typed name made safe to keep: one line, single-spaced, no invisible characters. null when nothing is left. */
export function cleanAppName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Whitespace (tabs, newlines) becomes a space before the unsafe sweep, which would
  // otherwise delete it and glue words together.
  const name = raw.normalize("NFC").replace(/\s/g, " ").replace(UNSAFE, "").replace(/ +/g, " ").trim();
  return name || null;
}

/**
 * The name to keep for what a family typed: their name plus OS. A capital OS they typed
 * themselves isn't doubled ("SmithOS" stays SmithOS), but a name that merely ends in those
 * letters keeps them ("Amos" is AmosOS). null, meaning FamilyOS, when nothing is left.
 */
export function appNameFromFamilyName(raw: string | null | undefined): string | null {
  const typed = cleanAppName(raw);
  if (!typed) return null;
  const family = typed.endsWith(APP_NAME_SUFFIX) ? typed.slice(0, -APP_NAME_SUFFIX.length).trimEnd() : typed;
  return family ? family + APP_NAME_SUFFIX : null;
}

/** The part of a kept name the family typed, for the settings form: SmithOS is "Smith". */
export function familyNameOf(appName: string | null | undefined): string {
  const name = cleanAppName(appName);
  if (!name) return "";
  return name.endsWith(APP_NAME_SUFFIX) ? name.slice(0, -APP_NAME_SUFFIX.length) : name;
}

/** Length as people count it (an emoji is one), for the APP_NAME_MAX check. */
export function appNameLength(name: string): number {
  return graphemes(name).length;
}

/** What to show for a stored name: the cleaned name, cut to APP_NAME_MAX, or FamilyOS. */
export function appNameOrDefault(stored: string | null | undefined): string {
  const name = cleanAppName(stored);
  return name ? graphemes(name).slice(0, APP_NAME_MAX).join("").trim() : DEFAULT_APP_NAME;
}

/**
 * The wordmark colors the trailing "OS" ("Family" + "OS"), the way the app has always looked.
 * A name without one (only possible from an edited backup file) is shown whole.
 */
export function wordmarkParts(name: string): { lead: string; accent: string } {
  const match = /^(.+?)(OS)$/.exec(name);
  return match ? { lead: match[1], accent: match[2] } : { lead: name, accent: "" };
}
