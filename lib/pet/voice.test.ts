import { describe, expect, it } from "vitest";
import { REWARD_PRESETS } from "@/lib/reward-words";
import { GAME_DEFS } from "./games/catalog";
import { ALL_HINTS } from "./gifts";
import { FOODS, TOYS } from "./personality";
import { rngFor } from "./random";
import { SPECIES } from "./state";
import * as voice from "./voice";

/** Every pool of lines in lib/pet/voice.ts, flattened. */
function allPools(): string[][] {
  const pools: string[][] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") pools.push([value]);
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) pools.push(value as string[]);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const [key, value] of Object.entries(voice)) if (/_LINES$|^HIDE_SEEK|^HATCH|^GOODBYE/.test(key)) walk(value);
  return pools;
}

const lines = [...allPools().flat(), ...ALL_HINTS, ...Object.values(GAME_DEFS).map((game) => game.blurb)];
const longestName = "Bartholomew Jnr";

describe("the pet's voice", () => {
  it("fills every placeholder, for every species, food and toy", () => {
    for (const line of lines)
      for (const species of SPECIES) {
        const filled = voice.fill(line, { name: longestName, species, food: FOODS[0], toy: TOYS[0], form: "Scruffy Thumper", trick: "Roll over" });
        expect(filled, line).not.toMatch(/[{}]/);
        expect(filled[0], filled).toMatch(/[A-Z"']/);
      }
  });

  it("keeps lines short enough for a 7-year-old to read in one go", () => {
    for (const line of lines) {
      const filled = voice.fill(line, { name: longestName, species: "critter", food: "rice-ball", toy: "bubbles", form: "Scruffy Splodge", trick: "Roll over" });
      expect(filled.length, filled).toBeLessThanOrEqual(90);
    }
  });

  it("sticks to the house style", () => {
    for (const line of lines) {
      expect(line, line).not.toMatch(/—|–| - /); // no dashes
      expect(line, line).not.toMatch(/\buh oh\b|\boops\b|\bawesome\b|\bsuper\b/i);
      expect((line.match(/!/g) ?? []).length, line).toBeLessThanOrEqual(1);
    }
  });

  it("never mentions chores or the reward word", () => {
    const banned = [/chore/i, /sticker/i, /\bpoints?\b/i, ...REWARD_PRESETS.flatMap((words) => [words.one, words.many]).map((word) => new RegExp(`\\b${word}\\b`, "i"))];
    for (const line of lines) for (const word of banned) expect(line, line).not.toMatch(word);
  });

  it("gives every pool more than one line, so nothing repeats twice in a row", () => {
    for (const pool of allPools()) if (pool.length > 1) {
      let last: string | null = null;
      for (let i = 0; i < 20; i++) {
        const next = voice.pickLine(pool, rngFor("s", i), last);
        expect(next).not.toBe(last);
        last = next;
      }
    }
  });

  it("serves its favorite food often enough to notice", () => {
    const rng = rngFor("meals");
    const favorites = Array.from({ length: 400 }, () => voice.serveFood("pancake", rng)).filter((food) => food === "pancake").length;
    expect(favorites).toBeGreaterThan(100);
  });
});
