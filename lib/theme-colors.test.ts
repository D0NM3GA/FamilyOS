import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_COLOR, THEME_COLORS, isThemeColorId, themeColorCss, themeColorOf } from "./theme-colors";

// WCAG 2 relative luminance and contrast ratio.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const WHITE = "#ffffff";
const DARK_PAGE = "#10161c"; // globals.css .dark --background

describe("THEME_COLORS", () => {
  it.each(THEME_COLORS.map((c) => [c.id, c] as const))("%s keeps white text readable and buttons visible", (_id, color) => {
    for (const t of [color.light, color.dark]) {
      for (const bg of [t.chrome, t.chromeHover, t.chromeActive, t.brand, t.brandHover]) {
        expect(contrast(WHITE, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(color.dark.brand, DARK_PAGE)).toBeGreaterThanOrEqual(3);
  });

  it("has unique ids, with Ink first", () => {
    expect(new Set(THEME_COLORS.map((c) => c.id)).size).toBe(THEME_COLORS.length);
    expect(THEME_COLORS[0].id).toBe(DEFAULT_THEME_COLOR);
  });
});

describe("themeColorOf / isThemeColorId", () => {
  it("falls back to Ink", () => {
    expect(themeColorOf(null).id).toBe("ink");
    expect(themeColorOf("neon").id).toBe("ink");
    expect(themeColorOf("forest").id).toBe("forest");
    expect(isThemeColorId("forest")).toBe(true);
    expect(isThemeColorId("neon")).toBe(false);
  });
});

describe("themeColorCss", () => {
  it("adds nothing for Ink, the stylesheet's own look", () => {
    expect(themeColorCss(null)).toBe("");
    expect(themeColorCss("ink")).toBe("");
  });

  it("overrides the bar and buttons in both themes, with nothing but preset values", () => {
    const css = themeColorCss("berry");
    expect(css).toContain("html:root{--chrome:#8a1f4a;");
    expect(css).toContain("html.dark{--chrome:#2a0a18;");
    expect(css).toMatch(/^[\w\s:;{}#.,()-]+$/);
  });
});
