import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, cleanMascotName, familyLookOf, iconLetter } from "./family-look";

const row = {
  appName: null,
  themeColor: null,
  rewardOne: null,
  rewardMany: null,
  rewardStore: null,
  mascotOn: true,
  mascotName: null,
  appIcon: "BUNNY" as const,
};

describe("familyLookOf", () => {
  it("is the app's own look for an untouched household, or none at all", () => {
    expect(familyLookOf(row)).toEqual(DEFAULT_LOOK);
    expect(familyLookOf(null)).toEqual(DEFAULT_LOOK);
  });

  it("reads a family's choices, and falls back on anything it can't use", () => {
    expect(
      familyLookOf({ ...row, appName: "SmithOS", themeColor: "plum", rewardOne: "gem", rewardMany: "gems", rewardStore: "Gem Shop", mascotOn: false, mascotName: "Clover", appIcon: "LETTER" }),
    ).toEqual({
      appName: "SmithOS",
      themeColor: "plum",
      reward: { one: "gem", many: "gems", store: "Gem Shop" },
      mascot: { on: false, name: "Clover" },
      appIcon: "LETTER",
    });
    expect(familyLookOf({ ...row, themeColor: "neon", mascotName: "  " })).toMatchObject({ themeColor: "ink", mascot: { name: "Bunson" } });
  });
});

describe("cleanMascotName", () => {
  it("tidies a name and refuses an empty or too-long one", () => {
    expect(cleanMascotName("  Clover ")).toBe("Clover");
    expect(cleanMascotName("")).toBeNull();
    expect(cleanMascotName("x".repeat(21))).toBeNull();
  });
});

describe("iconLetter", () => {
  it("is the first letter or digit, capitalized", () => {
    expect(iconLetter("SmithOS")).toBe("S");
    expect(iconLetter("7 SeasOS")).toBe("7");
  });

  it("is null for a name starting with an emoji or symbol", () => {
    expect(iconLetter("👨‍👩‍👧 LeeOS")).toBeNull();
    expect(iconLetter("#1OS")).toBeNull();
  });

  it("is null for anything but plain A–Z and 0–9, whose fonts the renderer would fetch from outside", () => {
    expect(iconLetter("ИвановOS")).toBeNull();
    expect(iconLetter("田中OS")).toBeNull();
    expect(iconLetter("élanOS")).toBeNull();
    expect(iconLetter("\u0663OS")).toBeNull();
  });
});
