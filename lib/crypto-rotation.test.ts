import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * Phase 67c: changing INTEGRATION_ENCRYPTION_KEY. lib/crypto.ts reads its keys when it loads, so
 * each case loads it fresh with the keys it needs.
 */
const OLD = randomBytes(32).toString("base64");
const NEW = randomBytes(32).toString("base64");
const saved = { key: process.env.INTEGRATION_ENCRYPTION_KEY, previous: process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS };

async function load(key: string, previous?: string) {
  vi.resetModules();
  process.env.INTEGRATION_ENCRYPTION_KEY = key;
  if (previous === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
  else process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS = previous;
  return import("./crypto");
}

afterEach(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = saved.key;
  if (saved.previous === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
  else process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS = saved.previous;
  vi.resetModules();
});

describe("changing the encryption key", () => {
  test("old seals open with the previous key set, and re-seal onto the new one", async () => {
    const before = await load(OLD);
    const sealed = before.encryptSecret("bank-access-url", "jar:1:SIMPLEFIN");
    const bytes = before.encryptBytes(Buffer.from("money section"), "familyos-backup-money-v1");

    const during = await load(NEW, OLD);
    expect(during.hasPreviousKey()).toBe(true);
    expect(during.decryptSecret(sealed, "jar:1:SIMPLEFIN")).toBe("bank-access-url");
    expect(during.decryptBytes(bytes, "familyos-backup-money-v1").toString()).toBe("money section");
    const moved = during.resealIfPrevious(sealed, "jar:1:SIMPLEFIN");
    expect(moved?.plain).toBe("bank-access-url");
    // Already on the new key: nothing to do.
    expect(during.resealIfPrevious(moved!.sealed, "jar:1:SIMPLEFIN")).toBeNull();
    // The wrong row still fails with both keys.
    expect(() => during.decryptSecret(sealed, "jar:2:SIMPLEFIN")).toThrow();

    const after = await load(NEW);
    expect(after.hasPreviousKey()).toBe(false);
    expect(after.decryptSecret(moved!.sealed, "jar:1:SIMPLEFIN")).toBe("bank-access-url");
    expect(() => after.decryptSecret(sealed, "jar:1:SIMPLEFIN")).toThrow();
  });

  test("a previous key that's the current one, or the wrong size, stops the start", async () => {
    await expect(load(NEW, NEW)).rejects.toThrow(/same as INTEGRATION_ENCRYPTION_KEY/);
    await expect(load(NEW, Buffer.from("short").toString("base64"))).rejects.toThrow(/exactly 32 bytes/);
  });
});
