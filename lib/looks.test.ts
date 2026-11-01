import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, LOOKS, lookColorOf, lookColorsCss, lookOf, wornLook } from "./looks";

describe("wornLook", () => {
  it("is Sticker Book in the family's color for someone who hasn't chosen", () => {
    expect(wornLook({ look: null, lookColor: null }, "ocean")).toEqual({ look: DEFAULT_LOOK, color: "ocean" });
  });
  it("keeps a person's own color over the family's", () => {
    expect(wornLook({ look: null, lookColor: "berry" }, "ocean")).toEqual({ look: DEFAULT_LOOK, color: "berry" });
  });
  it("falls back for ids that no longer exist", () => {
    expect(wornLook({ look: "gone", lookColor: "gone" }, "ink")).toEqual({ look: DEFAULT_LOOK, color: LOOKS[0].colors[0].id });
    expect(lookOf("gone").id).toBe(DEFAULT_LOOK);
    expect(lookColorOf(LOOKS[0], "gone").id).toBe(LOOKS[0].colors[0].id);
  });
});

describe("lookColorsCss", () => {
  it("covers every color of every look, for day and night", () => {
    const css = lookColorsCss();
    for (const look of LOOKS) {
      for (const c of look.colors) {
        expect(css).toContain(`[data-look="${look.id}"][data-color="${c.id}"]{--chrome:${c.light.chrome};`);
        expect(css).toContain(`.dark [data-app-root][data-look="${look.id}"][data-color="${c.id}"]{--chrome:${c.dark.chrome};`);
      }
    }
  });
});

// WCAG 2 contrast, as in lib/theme-colors.test.ts.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("every color of every look", () => {
  const all = LOOKS.flatMap((l) => l.colors.flatMap((c) => (["light", "dark"] as const).map((mode) => [`${l.id}/${c.id} ${mode}`, c[mode], c.vars?.[mode]["--on-brand"] ?? c.onBrand ?? "#ffffff", c.vars?.[mode]["--on-chrome"] ?? c.onChrome ?? "#ffffff"] as const)));
  it.each(all)("%s keeps text on the bar and main buttons readable", (_name, tokens, onBrand, onChrome) => {
    expect(contrast(tokens.brand, onBrand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.brandHover, onBrand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.chrome, onChrome)).toBeGreaterThanOrEqual(4.5);
  });

  // Synthwave's links on its cards and pages, and ink on the accent fill.
  it.each(LOOKS.find((l) => l.id === "synth")!.colors.map((c) => [c.id, c] as const))("synth/%s keeps links readable", (_id, c) => {
    for (const surface of ["#fff3dc", "#fbdcae"]) expect(contrast(c.vars!.light["--brand-text"], surface)).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["#1e1142", "#120a2b"]) expect(contrast(c.vars!.dark["--brand-text"], surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.vars!.dark["--sun"], "#1a0b2e")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.vars!.light["--sun"], "#1a0b2e")).toBeGreaterThanOrEqual(4.5);
  });

  it.each(LOOKS.find((l) => l.id === "kawaii")!.colors.map((c) => [c.id, c] as const))("kawaii/%s keeps links readable", (_id, c) => {
    for (const surface of ["#fffdfb", "#ffe8f1"]) expect(contrast(c.vars!.light["--brand-text"], surface)).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["#30254f", "#221a3a"]) expect(contrast(c.vars!.dark["--brand-text"], surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(LOOKS.find((l) => l.id === "acanthus")!.colors.map((c) => [c.id, c] as const))("acanthus/%s keeps links readable", (_id, c) => {
    for (const surface of ["#fbf7ec", "#efe8d8"]) expect(contrast(c.vars!.light["--brand-text"], surface)).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["#1b2840", "#121b2c", "#0c1321"]) expect(contrast(c.vars!.dark["--brand-text"], surface)).toBeGreaterThanOrEqual(4.5);
  });

  // Goth's accents, on the page and card each mode draws them on, and the ink on top of --sun.
  it.each(LOOKS.find((l) => l.id === "goth")!.colors.map((c) => [c.id, c] as const))("goth/%s keeps its titles and links readable", (_id, c) => {
    expect(contrast(c.vars!.light["--goth-title"], "#e8e1cf")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.vars!.light["--goth-title"], "#cfc6b2")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.vars!.dark["--goth-title"], "#15121a")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.vars!.dark["--sun"], "#16120e")).toBeGreaterThanOrEqual(4.5);
  });
});

