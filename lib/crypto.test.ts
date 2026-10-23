import { describe, expect, test } from "vitest";
import { decryptSecret, encryptSecret, fingerprint } from "./crypto";

describe("encryptSecret/decryptSecret", () => {
  test("round-trips plaintext", () => {
    const secret = encryptSecret("super-secret-token", "household1:simplefin");
    expect(decryptSecret(secret, "household1:simplefin")).toBe("super-secret-token");
  });

  test("fails to decrypt with the wrong AAD (row-swap protection)", () => {
    const secret = encryptSecret("super-secret-token", "household1:simplefin");
    expect(() => decryptSecret(secret, "household2:simplefin")).toThrow();
  });

  test("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-plaintext", "household1:simplefin");
    const b = encryptSecret("same-plaintext", "household1:simplefin");
    expect(a.encryptedValue.equals(b.encryptedValue)).toBe(false);
  });
});

describe("fingerprint", () => {
  test("is stable, depends on the label, and never shows the value", () => {
    const a = fingerprint("privacy", "key-123");
    expect(a).toBe(fingerprint("privacy", "key-123"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(fingerprint("privacy", "key-124"));
    expect(a).not.toBe(fingerprint("other", "key-123"));
    expect(a).not.toContain("key-123");
  });
});
