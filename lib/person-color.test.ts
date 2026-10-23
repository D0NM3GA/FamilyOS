import { describe, expect, it } from "vitest";
import { INK, PERSON_COLORS, PERSON_COLOR_KEYS, personColor, personColorKey } from "./person-color";

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("person colors", () => {
  it.each(PERSON_COLOR_KEYS)("%s passes WCAG AA with ink text", (key) => {
    expect(contrast(PERSON_COLORS[key].bg, INK)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the stored color when set", () => {
    expect(personColorKey({ id: "abc", color: "TEAL" })).toBe("TEAL");
    expect(personColor({ id: "abc", color: "SUN" })).toEqual({ bg: "#FFD23F", fg: INK });
  });

  it("derives a stable default from the id", () => {
    const a = personColorKey({ id: "cmabc123", color: null });
    expect(personColorKey({ id: "cmabc123", color: null })).toBe(a);
    expect(PERSON_COLOR_KEYS).toContain(a);
  });

  it("spreads defaults across the palette", () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => personColorKey({ id: `person-${i}`, color: null })));
    expect(seen.size).toBeGreaterThan(4);
  });
});
