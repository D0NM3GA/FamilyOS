/**
 * Who may do what to a chore (Phase 59.1a), shared by the actions, the card and the status pill so
 * they can't disagree. Pure and free of server imports, so the client card can use it too: the
 * caller says whether the viewer is a grown-up.
 */

type Viewer = { id: string; adult: boolean };

/**
 * A grown-up may do any chore; a kid their own, or an "Anyone" one when the board lets them grab
 * it (Chores does, owner's call 2026-10-09; Meds never does).
 */
export function canDoChore(viewer: Viewer, i: { assignedToId: string | null }, claimable: boolean): boolean {
  return viewer.adult || i.assignedToId === viewer.id || (claimable && i.assignedToId === null);
}

/** A grown-up may undo anyone's; a kid only what they did themselves. */
export function canUndoChore(viewer: Viewer, i: { completedById: string | null }): boolean {
  return viewer.adult || i.completedById === viewer.id;
}

/** Skipping (and putting a skipped one back) is a grown-up's: it's how a chore would quietly disappear. */
export function canSkipChore(viewer: Viewer): boolean {
  return viewer.adult;
}
