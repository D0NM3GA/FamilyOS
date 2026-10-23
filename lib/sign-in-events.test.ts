import { describe, expect, test } from "vitest";
import { describeSignInEvent, type SignInEventRow } from "@/lib/sign-in-events";

const row = (r: Partial<SignInEventRow>): SignInEventRow => ({
  id: "e",
  kind: "PASSKEY_ADDED",
  actorId: "dad",
  actorName: "Dad",
  subjectId: "dad",
  subjectName: "Dad",
  detail: null,
  createdAt: new Date(0),
  ...r,
});

describe("describeSignInEvent", () => {
  test("reads from the reader's side", () => {
    expect(describeSignInEvent(row({ detail: "Laptop" }), "dad")).toBe("You added a passkey (Laptop)");
    expect(describeSignInEvent(row({ kind: "PASSKEY_REMOVED" }), "dad")).toBe("You removed a passkey");
    expect(describeSignInEvent(row({ kind: "PASSKEY_REMOVED" }), "mom")).toBe("Dad removed a passkey");
    expect(describeSignInEvent(row({ kind: "PASSKEY_REMOVED", subjectId: "mom", subjectName: "Mom" }), "mom")).toBe("Dad removed your passkey");
  });

  test("names the other person when an admin acts on someone", () => {
    const reset = row({ kind: "PASSKEYS_RESET", subjectId: "mom", subjectName: "Mom" });
    expect(describeSignInEvent(reset, "mom")).toBe("Dad reset your passkeys");
    expect(describeSignInEvent(reset, "dad")).toBe("You reset Mom's passkeys");
    expect(describeSignInEvent(row({ kind: "ROLE_CHANGED", subjectId: "mom", subjectName: "Mom", detail: "Admin" }), "grandma")).toBe(
      "Dad changed Mom's role to Admin",
    );
  });

  test("invites say who, and the role they give", () => {
    const made = row({ kind: "INVITE_MADE", subjectId: null, subjectName: "Grandpa", detail: "Admin" });
    expect(describeSignInEvent(made, "dad")).toBe("You made an invite for Grandpa, as Admin");
    expect(describeSignInEvent(made, "mom")).toBe("Dad made an invite for Grandpa, as Admin");
    expect(describeSignInEvent(row({ kind: "INVITE_CANCELLED", subjectId: "grandma", subjectName: "Grandma" }), "dad")).toBe(
      "You cancelled the invite for Grandma",
    );
    const used = row({ kind: "INVITE_ACCEPTED", actorId: "grandma", actorName: "Grandma", subjectId: "grandma", subjectName: "Grandma", detail: "Adult" });
    expect(describeSignInEvent(used, "grandma")).toBe("You used an invite to sign in, as Adult");
    expect(describeSignInEvent(used, "dad")).toBe("Grandma used an invite to sign in, as Adult");
    // A reset's link reads as one.
    expect(describeSignInEvent({ ...used, detail: "recovery" }, "dad")).toBe("Grandma used a new sign-in link to get back in");
    expect(describeSignInEvent(row({ kind: "INVITE_CANCELLED", subjectId: "grandma", subjectName: "Grandma", detail: "recovery" }), "dad")).toBe(
      "You cancelled the new sign-in link for Grandma",
    );
  });

  test("Entra's changes, with no person behind them (40.4)", () => {
    const entra = { actorId: null, actorName: "Entra", subjectId: "mom", subjectName: "Mom" };
    expect(describeSignInEvent(row({ ...entra, kind: "ENTRA_ACCESS_ENDED" }), "mom")).toBe("Entra ended your access");
    expect(describeSignInEvent(row({ ...entra, kind: "ENTRA_ACCESS_ENDED" }), "dad")).toBe("Entra ended Mom's access");
    expect(describeSignInEvent(row({ ...entra, kind: "ENTRA_ACCESS_RESTORED" }), "dad")).toBe("Mom got access again from Entra");
    expect(describeSignInEvent(row({ ...entra, kind: "ROLE_CHANGED", detail: "Admin" }), "dad")).toBe("Entra changed Mom's role to Admin");
  });

  test("someone's own change still reads as theirs once they're gone", () => {
    expect(describeSignInEvent(row({ actorId: null, subjectId: null, actorName: "Mom", subjectName: "Mom" }), "dad")).toBe("Mom added a passkey");
  });

  test("an actor who's since been removed keeps their name", () => {
    expect(describeSignInEvent(row({ actorId: null, subjectId: "mom", subjectName: "Mom", kind: "SIGN_IN_REMOVED" }), "mom")).toBe("Dad removed your sign-in");
  });
});
