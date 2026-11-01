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
