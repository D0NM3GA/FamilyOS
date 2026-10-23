import { describe, expect, it } from "vitest";
import { canRemoveFromHousehold, isMembershipLocked } from "./household-members";

describe("Phase 38: who Settings → Household can remove", () => {
  it("removes people without a sign-in of their own", () => {
    expect(canRemoveFromHousehold({ authUserId: null, role: "KID", jarCount: 0 })).toBe(true);
    expect(canRemoveFromHousehold({ authUserId: null, role: "ADULT", jarCount: 0 })).toBe(true);
    expect(canRemoveFromHousehold({ authUserId: null, role: null, jarCount: 0 })).toBe(true);
  });

  it("leaves people who sign in with Microsoft to Entra", () => {
    expect(canRemoveFromHousehold({ authUserId: "user_1", role: "ADULT", jarCount: 0 })).toBe(false);
    expect(canRemoveFromHousehold({ authUserId: "user_1", role: "ADMIN", jarCount: 2 })).toBe(false);
  });

  it("leaves restored people who will sign in with Microsoft to Entra too", () => {
    // Only Entra grants Admin, and only Microsoft-linked adults are in money jars.
    expect(canRemoveFromHousehold({ authUserId: null, role: "ADMIN", jarCount: 0 })).toBe(false);
    expect(canRemoveFromHousehold({ authUserId: null, role: "ADULT", jarCount: 1 })).toBe(false);
  });
});

describe("Phase 38: whose membership and role the People form keeps as they are", () => {
  const person = { authUserId: null, role: "ADULT" as const, isHouseholdMember: true, jarCount: 0 };

  it("a Microsoft-linked person, member or not", () => {
    expect(isMembershipLocked({ ...person, authUserId: "user_1" })).toBe(true);
    expect(isMembershipLocked({ ...person, authUserId: "user_1", isHouseholdMember: false, role: null })).toBe(true);
  });

  it("a restored Admin or jar member who hasn't signed in yet", () => {
    expect(isMembershipLocked({ ...person, role: "ADMIN" })).toBe(true);
    expect(isMembershipLocked({ ...person, jarCount: 1 })).toBe(true);
  });

  it("not kids, grown-ups on a PIN, or contacts", () => {
    expect(isMembershipLocked(person)).toBe(false);
    expect(isMembershipLocked({ ...person, role: "KID" })).toBe(false);
    expect(isMembershipLocked({ ...person, role: null, isHouseholdMember: false })).toBe(false);
  });
});
