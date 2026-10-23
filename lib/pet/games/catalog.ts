import type { PlayEffect } from "../care";

/**
 * Phase 47.3: the mini-games and what a round does for the pet. Each game's rules live in its
 * own module here (pure, seeded, tested); the view is in app/(app)/pet/games. A round pays out
 * at most once per game per hour (`PetPlay`), and its effect is capped by `effectOf` whatever
 * score is posted, so a made-up score gets nothing extra. Playing badly still gives a little
 * fun: nobody loses anything by playing. Pure and client-safe.
 */

export const GAMES = ["snack-catch", "bubble-bath", "hide-seek", "copy-dance", "fetch"] as const;
export type GameId = (typeof GAMES)[number];

export type GameDef = { id: GameId; name: string; emoji: string; blurb: string; maxScore: number };

export const GAME_DEFS: Record<GameId, GameDef> = {
  "snack-catch": { id: "snack-catch", name: "Snack Catch", emoji: "🍓", blurb: "Snacks are falling. Catch them in the bowl, and leave the broccoli.", maxScore: 20 },
  "bubble-bath": { id: "bubble-bath", name: "Bubble Bath", emoji: "🫧", blurb: "Bath time. Pop the bubbles before they float away. Ducks count extra.", maxScore: 40 },
  "hide-seek": { id: "hide-seek", name: "Hide and Seek", emoji: "👀", blurb: "Your pet hides somewhere in the room. Can you find it in three tries?", maxScore: 3 },
  "copy-dance": { id: "copy-dance", name: "Copy Dance", emoji: "💃", blurb: "Your pet does a dance. You do it back, move for move.", maxScore: 8 },
  fetch: { id: "fetch", name: "Fetch Far", emoji: "🥏", blurb: "Tap Throw when the line is in the green. Closer means farther.", maxScore: 300 },
};

/** A round pays out once per game per this many minutes. */
export const PAYOUT_MINUTES = 60;

/** How well a round went, 0 to 1, from a posted score (clamped, so nonsense counts as nothing). */
export function scoreShare(game: GameId, score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score / GAME_DEFS[game].maxScore));
}

/** What a round does: a little for trying, more for playing well. */
export function effectOf(game: GameId, score: number): PlayEffect {
  const share = scoreShare(game, score);
  const fun = Math.round(8 + 22 * share);
  switch (game) {
    case "snack-catch":
      return { fun: 10, hunger: Math.round(5 + 25 * share), energy: 10 };
    case "bubble-bath":
      return { fun: Math.round(5 + 15 * share), clean: true, energy: 6 };
    case "copy-dance":
      return { fun, discipline: Math.round(5 + 15 * share), energy: 12 };
    case "hide-seek":
    case "fetch":
      return { fun, energy: 12 };
  }
}

export function isGame(id: string): id is GameId {
  return (GAMES as readonly string[]).includes(id);
}
