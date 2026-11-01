import { THEME_COLORS, colorVars, type Tokens } from "@/lib/theme-colors";

/**
 * Phase 58: the looks a person can wear (each has day and night) and the colors each offers. A
 * look belongs to the person, not the family. Pure, so the client can use it too. Stored ids are
 * checked here: an unknown one falls back rather than breaking the page.
 */

export type LookColor = {
  id: string;
  name: string;
  swatch: string;
  light: Tokens;
  dark: Tokens;
  /** Text on main buttons and the bar, where it isn't white. */
  onBrand?: string;
  onChrome?: string;
};
export type Look = {
  id: string;
  name: string;
  blurb: string;
  colors: readonly LookColor[];
  /** Home's scene, a little of the look's voice. Sticker Book has the mascot instead. */
  hello?: (firstName: string) => string;
};

const brutColor = (id: string, name: string, chrome: string, brand: string): LookColor => {
  const tokens = { chrome, chromeHover: chrome, chromeActive: chrome, brand, brandHover: brand };
  return { id, name, swatch: chrome, light: tokens, dark: tokens, onBrand: "#000000", onChrome: "#000000" };
};

export const DEFAULT_LOOK = "sticker";

export const LOOKS: readonly Look[] = [
  { id: DEFAULT_LOOK, name: "Sticker Book", blurb: "Warm paper, ink and sunshine.", colors: THEME_COLORS },
  {
    id: "brut",
    name: "Neo-brutal",
    blurb: "A gig poster with opinions.",
    colors: [
      brutColor("banana", "Banana", "#ffd400", "#ff5cad"),
      brutColor("gum", "Bubblegum", "#ff5cad", "#ffd400"),
      brutColor("electric", "Electric", "#7fdcff", "#a7f070"),
      brutColor("tangerine", "Tangerine", "#ff9a3c", "#b9a5ff"),
    ],
    // No time of day: the banner stays up all day.
    hello: (firstName) => `Hey, ${firstName}.`,
  },
];

/** Once there's a real choice, new people are asked (Settings' setup step, the welcome). */
export const LOOKS_TO_CHOOSE = LOOKS.length > 1;

export const lookOf = (id: string | null | undefined): Look => LOOKS.find((l) => l.id === id) ?? LOOKS[0];

export const lookColorOf = (look: Look, id: string | null | undefined): LookColor => look.colors.find((c) => c.id === id) ?? look.colors[0];

export type Worn = { look: string; color: string };

/** What a person wears: their own pick, or Sticker Book in the family's color. */
export function wornLook(person: { look: string | null; lookColor: string | null }, familyColor: string): Worn {
  const look = lookOf(person.look);
  const fallback = look.id === DEFAULT_LOOK ? familyColor : null;
  return { look: look.id, color: lookColorOf(look, person.lookColor ?? fallback).id };
}

/** Every look's colors as CSS on the app's root. Preset values only, never typed text. */
export function lookColorsCss(): string {
  return LOOKS.flatMap((look) =>
    look.colors.map((c) => {
      const on = `[data-app-root][data-look="${look.id}"][data-color="${c.id}"]`;
      const text = (c.onBrand ? `--on-brand:${c.onBrand};` : "") + (c.onChrome ? `--on-chrome:${c.onChrome};` : "");
      return `${on}{${colorVars(c.light)}${text}}.dark ${on}{${colorVars(c.dark)}${text}}`;
    }),
  ).join("");
}
