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
  /** The look's own variables for this color, day and night. Preset values only. */
  vars?: { light: Record<string, string>; dark: Record<string, string> };
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

const gothColor = (id: string, name: string, swatch: string, day: string, night: string, nightHover: string, glow: string, line: string): LookColor => {
  const shared = { "--sun": glow, "--goth-frame-line": line };
  return {
    id,
    name,
    swatch,
    light: { chrome: "#16120e", chromeHover: "#2a241c", chromeActive: "#352e24", brand: day, brandHover: day },
    dark: { chrome: "#000000", chromeHover: "#1a1218", chromeActive: "#241a22", brand: night, brandHover: nightHover },
    onChrome: "#eee6da",
    vars: {
      light: { ...shared, "--goth-title": day, "--brand-text": day, "--goth-frame": "url(/looks/goth-frame-day.webp)" },
      dark: { ...shared, "--goth-title": glow, "--brand-text": glow, "--goth-frame": `url(/looks/goth-frame-${id}.webp)` },
    },
  };
};

const synthColor = (id: string, name: string, night: string, nightHover: string, glow: string, link: string, day: string, dayHover: string): LookColor => ({
  id,
  name,
  swatch: night,
  light: { chrome: "#7f1a3f", chromeHover: "#8f2048", chromeActive: "#9b2650", brand: day, brandHover: dayHover },
  dark: { chrome: "#0c0620", chromeHover: "#1e1142", chromeActive: "#2a1a58", brand: night, brandHover: nightHover },
  vars: {
    light: { "--on-brand": "#ffffff", "--on-chrome": "#fff3dc", "--brand-text": day, "--sun": "#ffc15e", "--synth-glow": "#f28a3a" },
    dark: { "--on-brand": "#15062b", "--on-chrome": "#f6eeff", "--brand-text": link, "--sun": link, "--synth-glow": glow },
  },
});

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
  {
    id: "goth",
    name: "Goth",
    blurb: "A cathedral, then a grimoire.",
    colors: [
      gothColor("oxblood", "Oxblood", "#b3121f", "#9c1319", "#b3121f", "#c4182b", "#ff6a70", "#6b1a24"),
      gothColor("absinthe", "Absinthe", "#2f7a2a", "#2c5e1e", "#2f7a2a", "#276a23", "#8fdc5a", "#2f5a24"),
      gothColor("amethyst", "Amethyst", "#6d2fb8", "#54258f", "#6d2fb8", "#7a3bc6", "#c39bff", "#4a2a78"),
      gothColor("rosewater", "Rosewater", "#b0386f", "#8f2a58", "#b0386f", "#bf467c", "#ff9ad0", "#6e2a50"),
    ],
    hello: (firstName) => `Good morrow, ${firstName}`,
  },
  {
    id: "synth",
    name: "Synthwave",
    blurb: "The arcade at the end of the highway.",
    colors: [
      synthColor("outrun", "Outrun", "#ff4fb0", "#ff7cc6", "#ff2fa0", "#27e8ff", "#b3204a", "#a01c42"),
      synthColor("miami", "Miami", "#27e8ff", "#6ff0ff", "#27e8ff", "#ff8fd0", "#0f6e7a", "#0c5f6a"),
      synthColor("sunset", "Sunset", "#ffa23c", "#ffb868", "#ff7a1f", "#ffd23f", "#a8430e", "#953b0c"),
      synthColor("laser", "Laser", "#a78bff", "#bda6ff", "#7a3cff", "#7fe9ff", "#5a2bb0", "#4e249c"),
    ],
    hello: (firstName) => `Welcome back, ${firstName}`,
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
      const own = (v?: Record<string, string>) => Object.entries(v ?? {}).map(([k, x]) => `${k}:${x};`).join("");
      return `${on}{${colorVars(c.light)}${text}${own(c.vars?.light)}}.dark ${on}{${colorVars(c.dark)}${text}${own(c.vars?.dark)}}`;
    }),
  ).join("");
}
