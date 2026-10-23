import { clampMeter, type PetState } from "./state";
import { ITEMS } from "./items";
import { pickWeighted, rngFor } from "./random";

/**
 * Phase 47.4, the secret: finishing a chore quietly brings the pet a present. Never a cost and
 * never taken back; a present only adds. Nothing in the Chores app mentions it, and nothing
 * here mentions chores to the kid: the hints just get warmer until someone works it out.
 * Pure and client-safe.
 */

/** Presents a day, at most; chores past it that day just don't bring one. */
export const GIFTS_PER_DAY = 3;

/** Presents used up the moment they're opened, rather than kept as things. */
export const TREATS = ["feast", "charm", "sparkle"] as const;
export type Treat = (typeof TREATS)[number];

export const TREAT_NAMES: Record<Treat, string> = {
  feast: "a feast",
  charm: "a lucky charm",
  sparkle: "a sparkle treat",
};

const KEEPSAKES = ITEMS.filter((item) => item.giftOnly).map((item) => item.id);

export function isTreat(id: string): id is Treat {
  return (TREATS as readonly string[]).includes(id);
}

/** What one chore's present is: fixed by the pet and the chore, so it can't be re-rolled. */
export function pickGift(seed: string, instanceId: string, owned: readonly string[]): string {
  const rng = rngFor(seed, "gift", instanceId);
  const keepsakes = KEEPSAKES.filter((id) => !owned.includes(id));
  const kind = pickWeighted(rng, [
    ["feast", 40],
    ["charm", 20],
    ["sparkle", 10],
    ["keepsake", keepsakes.length > 0 ? 30 : 0],
  ] as const);
  return kind === "keepsake" ? keepsakes[Math.floor(rng() * keepsakes.length)] : kind;
}

/** Opening a treat: everything it does, ordinary care can do too; it just helps. */
export function openTreat(state: PetState, treat: Treat): PetState {
  switch (treat) {
    case "feast":
      return { ...state, hunger: clampMeter(state.hunger + 40), fun: clampMeter(state.fun + 40) };
    case "charm":
      return { ...state, charms: state.charms + 1 };
    case "sparkle":
      return { ...state, sparkles: state.sparkles + 1 };
  }
}

/**
 * The present's note, warmer each time: vague at first, then a hint, then nearly saying it.
 * Never the word "chore" or the reward word.
 */
const HINTS: readonly (readonly string[])[] = [
  ["A present appeared! Where did it come from?", "Another present! Someone must really like you."],
  [
    "A present! It smells like a freshly made bed…",
    "A present, with a little sock stuck to it…",
    "A present! It's suspiciously clean and shiny…",
  ],
  [
    "A present! Someone's been helping around the house…",
    "Every time things get tidied up, a present turns up. Funny, that.",
    "A present! The house looks nicer today, too…",
  ],
  ["A thank-you present for all that helping!", "Helping out again? Here's a little thank-you!"],
];

export function giftHint(openedBefore: number, seed: string): string {
  const level = openedBefore < 2 ? 0 : openedBefore < 4 ? 1 : openedBefore < 7 ? 2 : 3;
  const options = HINTS[level];
  return options[Math.floor(rngFor(seed, "hint", openedBefore)() * options.length)];
}

export const ALL_HINTS = HINTS.flat();

/** Which chores get a present: in order, up to the day's cap after what that day already had. */
export function withinDailyCap<T extends { day: string }>(chores: readonly T[], alreadyByDay: ReadonlyMap<string, number>): Set<T> {
  const used = new Map(alreadyByDay);
  const lucky = new Set<T>();
  for (const chore of chores) {
    const count = used.get(chore.day) ?? 0;
    if (count < GIFTS_PER_DAY) lucky.add(chore);
    used.set(chore.day, count + 1);
  }
  return lucky;
}
