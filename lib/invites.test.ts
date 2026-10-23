import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { inviteSchema } = await import("@/lib/invites");

describe("inviteSchema", () => {
  test("tidies the email and keeps a household member's id", () => {
    expect(inviteSchema.parse({ who: "member", personId: "p1", email: "  Grandma@Example.COM ", role: "ADULT", firstName: "" })).toEqual({
      who: "member",
      personId: "p1",
      email: "grandma@example.com",
      role: "ADULT",
    });
  });

  test("someone new needs a first name; a last name is optional", () => {
    expect(inviteSchema.safeParse({ who: "new", firstName: " ", email: "a@example.com", role: "ADULT" }).success).toBe(false);
    expect(inviteSchema.parse({ who: "new", firstName: " Grandpa ", lastName: "", email: "a@example.com", role: "ADMIN" })).toMatchObject({
      firstName: "Grandpa",
      role: "ADMIN",
    });
  });

  test("never a kid, never a bad email, and a member must be picked", () => {
    expect(inviteSchema.safeParse({ who: "new", firstName: "Ivy", email: "ivy@example.com", role: "KID" }).success).toBe(false);
    expect(inviteSchema.safeParse({ who: "new", firstName: "Max", email: "not-an-email", role: "ADULT" }).success).toBe(false);
    expect(inviteSchema.safeParse({ who: "member", personId: "", email: "a@example.com", role: "ADULT" }).success).toBe(false);
    expect(inviteSchema.safeParse({ who: "someone", email: "a@example.com", role: "ADULT" }).success).toBe(false);
  });
});
