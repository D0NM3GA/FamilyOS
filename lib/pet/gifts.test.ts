import { describe, expect, it } from "vitest";
import { DEFAULT_REWARD_WORDS, REWARD_PRESETS } from "@/lib/reward-words";
import { ALL_HINTS, giftHint, GIFTS_PER_DAY, isTreat, openTreat, pickGift, withinDailyCap } from "./gifts";
import { itemDef } from "./items";
import { newEgg } from "./state";

describe("chore presents", () => {
  it("are fixed for a pet and a chore", () => {
    expect(pickGift("pet", "chore-1", [])).toBe(pickGift("pet", "chore-1", []));
  });

  it("are a treat or a keepsake only presents bring, never one already owned", () => {
    const owned = ["fairy-lights", "rocket"];
    for (let i = 0; i < 200; i++) {
      const gift = pickGift("pet", `chore-${i}`, owned);
      expect(isTreat(gift) || itemDef(gift)?.giftOnly).toBeTruthy();
      expect(owned).not.toContain(gift);
    }
  });

  it("only ever add to the pet", () => {
    const pet = { ...newEgg("blob", 0), stage: "child" as const, hunger: 10, fun: 10 };
    for (const treat of ["feast", "charm", "sparkle"] as const) {
      const after = openTreat(pet, treat);
      expect(after.hunger).toBeGreaterThanOrEqual(pet.hunger);
      expect(after.fun).toBeGreaterThanOrEqual(pet.fun);
      expect(after.charms).toBeGreaterThanOrEqual(pet.charms);
      expect(after.sparkles).toBeGreaterThanOrEqual(pet.sparkles);
      expect(after.weight).toBe(pet.weight);
    }
  });

  it("stop at the day's cap and start again the next day", () => {
    const chores = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, day: i < 4 ? "2026-10-20" : "2026-10-21" }));
    const lucky = withinDailyCap(chores, new Map([["2026-10-20", 1]]));
    expect([...lucky].map((chore) => chore.id)).toEqual(["a", "b", "e"]);
    expect(GIFTS_PER_DAY).toBe(3);
  });

  it("come with hints that get warmer and never give the game away", () => {
    expect(giftHint(0, "s")).not.toBe(giftHint(9, "s"));
    const banned = [/chore/i, /sticker/i, /point/i, ...REWARD_PRESETS.flatMap((words) => [words.one, words.many]).map((word) => new RegExp(`\\b${word}\\b`, "i"))];
    for (const hint of ALL_HINTS) for (const word of banned) expect(hint).not.toMatch(word);
    expect(DEFAULT_REWARD_WORDS.one).toBe("sticker");
  });
});
