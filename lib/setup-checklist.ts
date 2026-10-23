/**
 * Phase 45.4: the "Finish setting up" checklist, worked out from what the app already knows
 * wherever it can (home set, kids added, phones turned on…). Only two steps can't be inferred,
 * since their defaults may be exactly what a family wants: the household keeps which of those
 * an admin has been through (`Household.setupReviewed`). Pure, so it's unit-tested.
 *
 * Household items are for admins; personal ones for every grown-up. Each says why it matters.
 */

export const SETUP_REVIEWABLE = ["look", "apps"] as const;
export type SetupReviewable = (typeof SETUP_REVIEWABLE)[number];
export const isSetupReviewable = (id: string): id is SetupReviewable => (SETUP_REVIEWABLE as readonly string[]).includes(id);

export type SetupItem = { id: string; label: string; why: string; href: string; done: boolean };

export type SetupFacts = {
  admin: boolean;
  adult: boolean;
  homeSet: boolean;
  reviewed: readonly string[];
  kids: number;
  /** Another grown-up who signs in on their own, or an invite waiting for one. */
  otherGrownUps: number;
  /** Phone alerts can work on this install (the server has keys). */
  pushReady: boolean;
  phones: number;
  ownSignIn: boolean;
  passkeySignIn: boolean;
  hasPin: boolean;
  passkeys: number;
};

export const SETUP_PATH = "/settings/get-started";

export function setupChecklist(f: SetupFacts): SetupItem[] {
  if (!f.adult) return [];
  const items: SetupItem[] = [];
  if (f.admin) {
    items.push(
      { id: "home", label: "Set where home is", why: "so outdoor chores can warn about rain", href: `${SETUP_PATH}?step=home`, done: f.homeSet },
      { id: "look", label: "Make it yours", why: "your family's name and colors on every screen", href: `${SETUP_PATH}?step=look`, done: f.reviewed.includes("look") },
      { id: "kids", label: "Add the kids", why: "so they get their own tile, chores and rewards", href: `${SETUP_PATH}?step=people`, done: f.kids > 0 },
      { id: "grown-up", label: "Invite another grown-up", why: "so the family isn't run from one phone", href: `${SETUP_PATH}?step=people`, done: f.otherGrownUps > 0 },
      { id: "apps", label: "Pick your apps", why: "short menus, with only what you use", href: `${SETUP_PATH}?step=apps`, done: f.reviewed.includes("apps") },
    );
  }
  if (f.pushReady) {
    items.push({ id: "phone", label: "Get alerts on your phone", why: "reminders that reach you without opening the app", href: "/settings/notifications", done: f.phones > 0 });
  }
  if (f.ownSignIn) {
    items.push({ id: "pin", label: "Lock your tile", why: "keeps the kids out of your profile on a shared tablet", href: "/settings/lock-my-tile", done: f.hasPin });
  }
  if (f.ownSignIn && f.passkeySignIn) {
    items.push({ id: "spare", label: "Add a spare passkey", why: "so a lost phone doesn't lock you out", href: "/settings/passkeys", done: f.passkeys > 1 });
  }
  return items;
}
