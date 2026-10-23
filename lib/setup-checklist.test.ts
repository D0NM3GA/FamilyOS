import { describe, expect, test } from "vitest";
import { setupChecklist, isSetupReviewable, type SetupFacts } from "./setup-checklist";

const fresh: SetupFacts = {
  admin: true,
  adult: true,
  homeSet: false,
  reviewed: [],
  kids: 0,
  otherGrownUps: 0,
  pushReady: true,
  phones: 0,
  ownSignIn: true,
  passkeySignIn: true,
  hasPin: false,
  passkeys: 1,
};

const ids = (f: Partial<SetupFacts> = {}) => setupChecklist({ ...fresh, ...f }).map((i) => i.id);
const done = (f: Partial<SetupFacts>) => setupChecklist({ ...fresh, ...f }).filter((i) => i.done).map((i) => i.id);

describe("the Finish setting up checklist", () => {
  test("a brand-new admin has everything to do, household items first", () => {
    expect(ids()).toEqual(["home", "look", "kids", "grown-up", "apps", "phone", "pin", "spare"]);
    expect(done({})).toEqual([]);
  });

  test("worked out from data, except the two steps that can't be", () => {
    expect(
      done({ homeSet: true, kids: 2, otherGrownUps: 1, phones: 1, hasPin: true, passkeys: 2 }),
    ).toEqual(["home", "kids", "grown-up", "phone", "pin", "spare"]);
    expect(done({ reviewed: ["look", "apps"] })).toEqual(["look", "apps"]);
  });

  test("grown-ups who aren't admins see only their own items; kids see none", () => {
    expect(ids({ admin: false })).toEqual(["phone", "pin", "spare"]);
    expect(setupChecklist({ ...fresh, adult: false, admin: false })).toEqual([]);
  });

  test("items that can't apply aren't listed", () => {
    expect(ids({ pushReady: false })).not.toContain("phone");
    expect(ids({ ownSignIn: false })).not.toContain("pin");
    expect(ids({ passkeySignIn: false })).not.toContain("spare");
  });

  test("every item says why it matters, and links somewhere", () => {
    for (const item of setupChecklist(fresh)) {
      expect(item.why.length).toBeGreaterThan(15);
      expect(item.href).toMatch(/^\/settings\//);
    }
  });

  test("only the two uninferable steps are reviewable", () => {
    expect(isSetupReviewable("look")).toBe(true);
    expect(isSetupReviewable("apps")).toBe(true);
    expect(isSetupReviewable("home")).toBe(false);
  });
});
