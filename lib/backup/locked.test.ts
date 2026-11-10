import { describe, expect, test } from "vitest";
import { isLockedBackup, LOCKED_FORMAT, lockBackup, passphraseProblem, unlockBackup } from "./locked";

const PASS = "correct horse battery";
const plain = JSON.stringify({ format: "familyos-household-backup", people: [{ firstName: "Ivy" }] });

describe("locked backups", () => {
  test("round-trips, and the locked file doesn't contain the data", async () => {
    const locked = await lockBackup(plain, PASS);
    expect(locked).not.toContain("Ivy");
    expect(isLockedBackup(JSON.parse(locked))).toBe(true);
    expect(JSON.parse(locked).format).toBe(LOCKED_FORMAT);
    expect(await unlockBackup(locked, PASS)).toEqual({ ok: true, text: plain });
  });

  test("each lock is different (fresh salt and IV)", async () => {
    const [a, b] = [await lockBackup(plain, PASS), await lockBackup(plain, PASS)];
    expect(JSON.parse(a).kdf.salt).not.toBe(JSON.parse(b).kdf.salt);
    expect(JSON.parse(a).cipher.iv).not.toBe(JSON.parse(b).cipher.iv);
  });

  test("a wrong passphrase doesn't open it", async () => {
    const result = await unlockBackup(await lockBackup(plain, PASS), "correct horse battery!");
    expect(result.ok).toBe(false);
  });

  test("a changed file doesn't open, data or header", async () => {
    const file = JSON.parse(await lockBackup(plain, PASS));
    const flipped = { ...file, data: (file.data[0] === "A" ? "B" : "A") + file.data.slice(1) };
    expect((await unlockBackup(JSON.stringify(flipped), PASS)).ok).toBe(false);
    // Fewer rounds asked for: refused outright, or the header no longer matches.
    const weaker = { ...file, kdf: { ...file.kdf, rounds: 1000 } };
    expect(await unlockBackup(JSON.stringify(weaker), PASS)).toEqual({ ok: false, error: expect.stringMatching(/damaged/) });
    const moreRounds = { ...file, kdf: { ...file.kdf, rounds: 600_001 } };
    expect((await unlockBackup(JSON.stringify(moreRounds), PASS)).ok).toBe(false);
  });

  test("refuses what isn't a locked backup, or a newer one", async () => {
    expect((await unlockBackup("not json", PASS)).ok).toBe(false);
    expect((await unlockBackup(plain, PASS)).ok).toBe(false);
    const newer = { ...JSON.parse(await lockBackup(plain, PASS)), version: 2 };
    expect(await unlockBackup(JSON.stringify(newer), PASS)).toEqual({ ok: false, error: expect.stringMatching(/newer/) });
  });

  test("the same passphrase in another Unicode form opens it", async () => {
    const composed = "café is twelve+";
    const decomposed = composed.normalize("NFD");
    expect((await unlockBackup(await lockBackup(plain, composed), decomposed)).ok).toBe(true);
  });

  test("passphrases need some length", async () => {
    expect(passphraseProblem("short")).toMatch(/12/);
    expect(passphraseProblem(PASS)).toBeNull();
    expect(passphraseProblem("x".repeat(201))).toMatch(/200/);
    await expect(lockBackup(plain, "short")).rejects.toThrow();
  });

  test("a large file survives", async () => {
    const big = JSON.stringify({ rows: "é".repeat(300_000) });
    const out = await unlockBackup(await lockBackup(big, PASS), PASS);
    expect(out.ok && out.text === big).toBe(true);
  });
});
