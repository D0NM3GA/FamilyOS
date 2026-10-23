/**
 * Phase 35: the top bar color a family picks (Settings → Make it yours), as presets rather
 * than any hex, so every choice is checked: white text on the bar and on the main buttons is
 * at least 4.5:1, and dark mode's buttons stand at least 3:1 off the page. Ink is the
 * Sticker Book's own look and changes nothing (globals.css already holds it). Pure.
 */

type Tokens = { chrome: string; chromeHover: string; chromeActive: string; brand: string; brandHover: string };

export type ThemeColor = { id: string; name: string; swatch: string; light: Tokens; dark: Tokens };

export const DEFAULT_THEME_COLOR = "ink";

export const THEME_COLORS: readonly ThemeColor[] = [
  {
    id: "ink",
    name: "Ink",
    swatch: "#1f2933",
    light: { chrome: "#1f2933", chromeHover: "#34424f", chromeActive: "#3e4c59", brand: "#1f2933", brandHover: "#34424f" },
    dark: { chrome: "#0b1015", chromeHover: "#1f2a33", chromeActive: "#2a3742", brand: "#2b6cb0", brandHover: "#245a94" },
  },
  {
    id: "ocean",
    name: "Ocean",
    swatch: "#1d4f7a",
    light: { chrome: "#1d4f7a", chromeHover: "#275f8f", chromeActive: "#306b9d", brand: "#1d4f7a", brandHover: "#275f8f" },
    dark: { chrome: "#0c1d2e", chromeHover: "#16304a", chromeActive: "#1d3b59", brand: "#2b6cb0", brandHover: "#245a94" },
  },
  {
    id: "forest",
    name: "Forest",
    swatch: "#1f5a3d",
    light: { chrome: "#1f5a3d", chromeHover: "#286b4a", chromeActive: "#2f7754", brand: "#1f5a3d", brandHover: "#286b4a" },
    dark: { chrome: "#0b1f15", chromeHover: "#143225", chromeActive: "#1a3e2e", brand: "#2a8558", brandHover: "#23704a" },
  },
  {
    id: "berry",
    name: "Berry",
    swatch: "#8a1f4a",
    light: { chrome: "#8a1f4a", chromeHover: "#9c2a58", chromeActive: "#a83262", brand: "#8a1f4a", brandHover: "#9c2a58" },
    dark: { chrome: "#2a0a18", chromeHover: "#3f1226", chromeActive: "#4b1730", brand: "#c0336f", brandHover: "#a32a5e" },
  },
  {
    id: "plum",
    name: "Plum",
    swatch: "#4b2a7a",
    light: { chrome: "#4b2a7a", chromeHover: "#5a378c", chromeActive: "#653f9a", brand: "#4b2a7a", brandHover: "#5a378c" },
    dark: { chrome: "#170d26", chromeHover: "#251740", chromeActive: "#2e1d4d", brand: "#7a52c0", brandHover: "#6644a6" },
  },
  {
    id: "clay",
    name: "Clay",
    swatch: "#8a3b1e",
    light: { chrome: "#8a3b1e", chromeHover: "#9b4626", chromeActive: "#a8502c", brand: "#8a3b1e", brandHover: "#9b4626" },
    dark: { chrome: "#26100a", chromeHover: "#3b1a10", chromeActive: "#472116", brand: "#b9532a", brandHover: "#9c4523" },
  },
  {
    id: "teal",
    name: "Teal",
    swatch: "#115e67",
    light: { chrome: "#115e67", chromeHover: "#18707a", chromeActive: "#1d7c87", brand: "#115e67", brandHover: "#18707a" },
    dark: { chrome: "#06191d", chromeHover: "#0e2c33", chromeActive: "#13383f", brand: "#127a84", brandHover: "#106a74" },
  },
  {
    id: "slate",
    name: "Slate",
    swatch: "#3a4652",
    light: { chrome: "#3a4652", chromeHover: "#485664", chromeActive: "#52616f", brand: "#3a4652", brandHover: "#485664" },
    dark: { chrome: "#101418", chromeHover: "#1d252c", chromeActive: "#252f38", brand: "#5d7388", brandHover: "#4e6173" },
  },
];

/** The preset for a stored id; Ink for none or one that no longer exists. */
export function themeColorOf(id: string | null | undefined): ThemeColor {
  return THEME_COLORS.find((c) => c.id === id) ?? THEME_COLORS[0];
}

export function isThemeColorId(id: string): boolean {
  return THEME_COLORS.some((c) => c.id === id);
}

const vars = (t: Tokens) =>
  `--chrome:${t.chrome};--chrome-hover:${t.chromeHover};--chrome-active:${t.chromeActive};--brand:${t.brand};--brand-hover:${t.brandHover};`;

/**
 * The CSS that recolors the app for a preset, or "" for Ink. `html:root` / `html.dark` outrank
 * globals.css's `:root` / `.dark` whatever order the stylesheets land in. Only preset values
 * ever reach it, never typed text.
 */
export function themeColorCss(id: string | null | undefined): string {
  const color = themeColorOf(id);
  if (color.id === DEFAULT_THEME_COLOR) return "";
  return `html:root{${vars(color.light)}}html.dark{${vars(color.dark)}}`;
}
