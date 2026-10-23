import { describe, expect, it } from "vitest";
import { DEFAULT_REWARD_WORDS, REWARD_PRESETS, capitalized, checkRewardWords, rewardCount, rewardPresetId, rewardWordsOf } from "./reward-words";

const stars = REWARD_PRESETS.find((p) => p.id === "stars")!;

describe("rewardWordsOf", () => {
  it("is stickers until all three are set", () => {
    expect(rewardWordsOf({ rewardOne: null, rewardMany: null, rewardStore: null })).toEqual(DEFAULT_REWARD_WORDS);
    expect(rewardWordsOf({ rewardOne: "star", rewardMany: null, rewardStore: "Star Shop" })).toEqual(DEFAULT_REWARD_WORDS);
    expect(rewardWordsOf({ rewardOne: "star", rewardMany: "stars", rewardStore: "Star Shop" })).toEqual({ one: "star", many: "stars", store: "Star Shop" });
  });
});

describe("rewardPresetId", () => {
  it("knows the presets and calls anything else custom", () => {
    expect(rewardPresetId(DEFAULT_REWARD_WORDS)).toBe("stickers");
    expect(rewardPresetId(stars)).toBe("stars");
    expect(rewardPresetId({ one: "acorn", many: "acorns", store: "Acorn Shop" })).toBe("custom");
  });
});

describe("checkRewardWords", () => {
  it("tidies a family's own words", () => {
    expect(checkRewardWords({ one: " acorn ", many: "acorns", store: "  Acorn   Shop " })).toEqual({
      ok: true,
      words: { one: "acorn", many: "acorns", store: "Acorn Shop" },
    });
  });

  it("wants all three, within the limits", () => {
    expect(checkRewardWords({ one: "acorn", many: "", store: "Shop" }).ok).toBe(false);
    expect(checkRewardWords({ one: "a".repeat(17), many: "b", store: "Shop" }).ok).toBe(false);
    expect(checkRewardWords({ one: "a", many: "b", store: "S".repeat(25) }).ok).toBe(false);
  });
});

describe("rewardCount / capitalized", () => {
  it("counts in the family's words", () => {
    expect(rewardCount(1, DEFAULT_REWARD_WORDS)).toBe("1 sticker");
    expect(rewardCount(5, stars)).toBe("5 stars");
    expect(rewardCount(-1, stars)).toBe("-1 star");
    expect(rewardCount(0, stars)).toBe("0 stars");
  });

  it("capitalizes the first letter only", () => {
    expect(capitalized("stickers")).toBe("Stickers");
    expect(capitalized("Acorns")).toBe("Acorns");
    expect(capitalized("")).toBe("");
  });
});
