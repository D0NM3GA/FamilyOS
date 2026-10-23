import { pickWeighted, rngFor } from "../random";

/**
 * Phase 47.3, Copy Dance: the pet shows a dance, the kid copies it with the arrows. Each round
 * is one move longer; a wrong move ends the game. Pure.
 */

export const MOVES = ["left", "right", "up", "down"] as const;
export type Move = (typeof MOVES)[number];
export const MAX_ROUNDS = 8;
const FIRST_LENGTH = 3;

export function danceMoves(seed: string): Move[] {
  const rng = rngFor(seed, "copy-dance");
  return Array.from({ length: FIRST_LENGTH + MAX_ROUNDS - 1 }, () => pickWeighted(rng, MOVES.map((move) => [move, 1] as const)));
}

export function roundMoves(moves: readonly Move[], round: number): Move[] {
  return moves.slice(0, FIRST_LENGTH + round);
}

export type DanceState = { round: number; position: number; over: boolean };
export const START: DanceState = { round: 0, position: 0, over: false };

/** One move from the kid: on to the next, a round cleared, or the end. */
export function copyMove(state: DanceState, moves: readonly Move[], move: Move): { state: DanceState; result: "ok" | "round" | "miss" | "won" } {
  if (state.over) return { state, result: "miss" };
  const expected = roundMoves(moves, state.round);
  if (expected[state.position] !== move) return { state: { ...state, over: true }, result: "miss" };
  if (state.position + 1 < expected.length) return { state: { ...state, position: state.position + 1 }, result: "ok" };
  const round = state.round + 1;
  if (round >= MAX_ROUNDS) return { state: { round, position: 0, over: true }, result: "won" };
  return { state: { round, position: 0, over: false }, result: "round" };
}
