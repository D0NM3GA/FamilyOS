import { describe, expect, it } from "vitest";
import { bathScore, bubbleSchedule, BUBBLE_LIFE_MS, isShowing, pop } from "./bubble-bath";
import { effectOf, GAME_DEFS, GAMES, scoreShare } from "./catalog";
import { copyMove, danceMoves, MAX_ROUNDS, roundMoves, START as DANCE_START, type DanceState } from "./copy-dance";
import { markerAt, SWEET_SPOT, throwDistance } from "./fetch";
import { guess, hidingPlaces, ROUNDS, START as HIDE_START, TRIES } from "./hide-seek";
import { BOWL_Y, dropY, snackSchedule, START as SNACK_START, step } from "./snack-catch";

describe("the game catalog", () => {
  it("caps every game's effect, however big the posted score", () => {
    for (const game of GAMES) {
      const best = effectOf(game, GAME_DEFS[game].maxScore);
      expect(effectOf(game, 1e9)).toEqual(best);
      expect(effectOf(game, Number.NaN)).toEqual(effectOf(game, 0));
      expect(effectOf(game, -50)).toEqual(effectOf(game, 0));
    }
  });

  it("gives a little fun even for a score of zero", () => {
    for (const game of GAMES) expect(effectOf(game, 0).fun).toBeGreaterThan(0);
  });

  it("only ever adds to the pet", () => {
    for (const game of GAMES) {
      const effect = effectOf(game, GAME_DEFS[game].maxScore);
      expect(effect.fun).toBeGreaterThan(0);
      expect(effect.hunger ?? 0).toBeGreaterThanOrEqual(0);
      expect(effect.discipline ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it("measures a score as a share of the game's best", () => {
    expect(scoreShare("hide-seek", 3)).toBe(1);
    expect(scoreShare("fetch", 150)).toBe(0.5);
  });
});

describe("Snack Catch", () => {
  const drops = snackSchedule("seed");

  it("is the same round for the same seed", () => {
    expect(snackSchedule("seed")).toEqual(drops);
    expect(snackSchedule("other")).not.toEqual(drops);
  });

  it("counts a treat caught under the bowl and ignores one missed", () => {
    const treat = drops.find((drop) => !drop.broccoli)!;
    const landing = treat.spawnAt + (BOWL_Y / treat.speed) * 1000 + 1;
    expect(step(SNACK_START, [treat], treat.x, landing).score).toBe(1);
    expect(step(SNACK_START, [treat], treat.x > 0.5 ? 0 : 1, landing).score).toBe(0);
  });

  it("settles each drop once, and doesn't settle one still falling", () => {
    const treat = drops.find((drop) => !drop.broccoli)!;
    const landing = treat.spawnAt + (BOWL_Y / treat.speed) * 1000 + 1;
    const once = step(SNACK_START, [treat], treat.x, landing);
    expect(step(once, [treat], treat.x, landing + 500).score).toBe(1);
    expect(step(SNACK_START, [treat], treat.x, treat.spawnAt).resolved.size).toBe(0);
    expect(dropY(treat, treat.spawnAt - 100)).toBeLessThan(0);
  });

  it("takes a point off for catching broccoli, never below zero", () => {
    const broccoli = { ...drops[0], broccoli: true };
    const landing = broccoli.spawnAt + (BOWL_Y / broccoli.speed) * 1000 + 1;
    expect(step(SNACK_START, [broccoli], broccoli.x, landing).score).toBe(0);
  });

  it("has enough treats to reach the best score", () => {
    expect(drops.filter((drop) => !drop.broccoli).length).toBeGreaterThanOrEqual(GAME_DEFS["snack-catch"].maxScore);
  });
});

describe("Bubble Bath", () => {
  const bubbles = bubbleSchedule("seed");

  it("pops a bubble only while it's showing", () => {
    const first = bubbles[0];
    expect(pop(bubbles, new Set(), first.id, first.at + 10).has(first.id)).toBe(true);
    expect(pop(bubbles, new Set(), first.id, first.at + BUBBLE_LIFE_MS + 10).size).toBe(0);
    expect(isShowing(first, first.at - 1, new Set())).toBe(false);
  });

  it("scores one a bubble and three a duck, up to the game's best", () => {
    const all = new Set(bubbles.map((bubble) => bubble.id));
    expect(bathScore(bubbles, all)).toBe(GAME_DEFS["bubble-bath"].maxScore);
  });
});

describe("Hide and Seek", () => {
  const spots = ["bed", "toybox", "rug", "plant"];

  it("never hides in the same place twice in a row", () => {
    for (let i = 0; i < 30; i++) {
      const places = hidingPlaces(`s-${i}`, spots);
      expect(places).toHaveLength(ROUNDS);
      for (let r = 1; r < places.length; r++) expect(places[r]).not.toBe(places[r - 1]);
    }
  });

  it("ends a round on a find or after the last try", () => {
    const places = hidingPlaces("s", spots);
    const found = guess(HIDE_START, places, places[0]);
    expect(found).toMatchObject({ found: true, state: { round: 1, found: 1 } });
    const wrong = spots.find((spot) => spot !== places[0])!;
    let state = HIDE_START;
    for (let i = 0; i < TRIES; i++) state = guess(state, places, wrong).state;
    expect(state).toMatchObject({ round: 1, found: 0, tries: 0 });
  });

  it("is done after the last round", () => {
    const places = hidingPlaces("s", spots);
    let state = HIDE_START;
    for (const place of places) state = guess(state, places, place).state;
    expect(state).toMatchObject({ done: true, found: ROUNDS });
  });
});

describe("Copy Dance", () => {
  const moves = danceMoves("seed");

  it("grows one move a round", () => {
    expect(roundMoves(moves, 0)).toHaveLength(3);
    expect(roundMoves(moves, 2)).toHaveLength(5);
  });

  it("clears a round copied right and ends on a wrong move", () => {
    let state: DanceState = DANCE_START;
    const round = roundMoves(moves, 0);
    let result = "";
    for (const move of round) ({ state, result } = copyMove(state, moves, move));
    expect(result).toBe("round");
    expect(state.round).toBe(1);
    const wrong = (["left", "right", "up", "down"] as const).find((move) => move !== roundMoves(moves, 1)[0])!;
    expect(copyMove(state, moves, wrong)).toMatchObject({ result: "miss", state: { over: true } });
  });

  it("is won after the last round", () => {
    let state: DanceState = DANCE_START;
    let result = "";
    for (let r = 0; r < MAX_ROUNDS; r++) for (const move of roundMoves(moves, r)) ({ state, result } = copyMove(state, moves, move));
    expect(result).toBe("won");
    expect(state).toMatchObject({ round: MAX_ROUNDS, over: true });
  });
});

describe("Fetch Far", () => {
  it("sweeps the marker there and back", () => {
    expect(markerAt(0, 0)).toBe(0);
    expect(markerAt(900, 0)).toBeCloseTo(1);
    expect(markerAt(1800, 0)).toBeCloseTo(0);
  });

  it("throws furthest from the sweet spot and less the further off", () => {
    expect(throwDistance(SWEET_SPOT)).toBe(100);
    expect(throwDistance(0.5)).toBeLessThan(100);
    expect(throwDistance(0)).toBeLessThan(throwDistance(0.5));
    expect(throwDistance(0)).toBeGreaterThanOrEqual(0);
  });
});
