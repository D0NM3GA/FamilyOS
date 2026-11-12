/**
 * Who may do what to a chore (Phase 59.1a), shared by the actions, the card and the status pill so
 * they can't disagree. Pure and free of server imports, so the client card can use it too: the
 * caller says whether the viewer is a grown-up.
 */

import { addDays, atMidnight } from "./schedule";

type Viewer = { id: string; adult: boolean };

/**
 * A grown-up may do any chore; a kid their own, or an "Anyone" one when the board lets them grab
 * it (Chores does, owner's call 2026-10-09; Meds never does).
 */
export function canDoChore(viewer: Viewer, i: { assignedToId: string | null }, claimable: boolean): boolean {
  return viewer.adult || i.assignedToId === viewer.id || (claimable && i.assignedToId === null);
}

/**
 * How early a chore can be ticked (after the 2026-11-11 review): a grown-up any time, a kid from
 * the day before it's due, so tomorrow's can be done tonight but two weeks of stickers can't be
 * claimed (and spent) at once. On the household's clock, like the boards.
 */
export function canDoChoreYet(viewer: { adult: boolean }, dueDate: Date, now: Date = new Date()): boolean {
  return viewer.adult || dueDate < addDays(atMidnight(now), 2);
}

/** A grown-up may undo anyone's; a kid only what they did themselves. */
export function canUndoChore(viewer: Viewer, i: { completedById: string | null }): boolean {
  return viewer.adult || i.completedById === viewer.id;
}

/** Skipping (and putting a skipped one back) is a grown-up's: it's how a chore would quietly disappear. */
export function canSkipChore(viewer: Viewer): boolean {
  return viewer.adult;
}
