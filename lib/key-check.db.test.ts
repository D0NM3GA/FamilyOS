import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * Phase 67c against a real database (`npm run test:db`): a change of encryption key end to end.
 * With the old key the app seals things; with the new key and the old one as previous, the
 * `keys` job re-seals every stored secret onto the new key (and a Privacy.com fingerprint with
 * it); with the new key alone everything still opens; with a wrong key the check fails. lib/crypto
 * reads its keys when it loads, so each step loads the modules fresh.
 */
const RUN = import.meta.env.MODE === "db";
const OLD = randomBytes(32).toString("base64");
const NEW = randomBytes(32).toString("base64");
const saved = { key: process.env.INTEGRATION_ENCRYPTION_KEY, previous: process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS };

async function withKeys(key: string, previous?: string) {
  vi.resetModules();
  process.env.INTEGRATION_ENCRYPTION_KEY = key;
  if (previous === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
  else process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS = previous;
  return {
    crypto: await import("@/lib/crypto"),
    keys: await import("@/lib/key-check"),
    finance: await import("@/lib/finance/reseal"),
    school: await import("@/lib/school/feeds/reseal"),
    sync: await import("@/lib/finance/sync"),
    refresh: await import("@/lib/school/feeds/refresh"),
    prisma: (await import("@/lib/prisma")).prisma,
  };
}

describe.skipIf(!RUN)("changing the encryption key (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", jar: "", conn: "", feed: "", user: "" };
  let priorCheck: { name: string; encryptedValue: Uint8Array; iv: Uint8Array; authTag: Uint8Array; createdAt: Date } | null = null;

  beforeAll(async () => {
    const { prisma } = await withKeys(saved.key!);
    priorCheck = await prisma.serverSecret.findUnique({ where: { name: "key-check" } });
    await prisma.serverSecret.deleteMany({ where: { name: "key-check" } });
  });

  afterAll(async () => {
    const { prisma } = await withKeys(saved.key!, saved.previous);
    await prisma.serverSecret.deleteMany({ where: { name: "key-check" } });
    if (priorCheck) {
      const { name, encryptedValue, iv, authTag, createdAt } = priorCheck;
      await prisma.serverSecret.create({ data: { name, encryptedValue: new Uint8Array(encryptedValue), iv: new Uint8Array(iv), authTag: new Uint8Array(authTag), createdAt } });
    }
    if (ids.h) await prisma.household.deleteMany({ where: { id: ids.h } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    process.env.INTEGRATION_ENCRYPTION_KEY = saved.key;
    if (saved.previous === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
    else process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS = saved.previous;
    vi.resetModules();
  });

  test("old key, both keys, new key, wrong key", async () => {
    // 1. The old key seals a Privacy.com connection, a school feed and the key check.
    const before = await withKeys(OLD);
    const h = await before.prisma.household.create({ data: { name: `e2e-keys-${t}` } });
    const user = await before.prisma.user.create({ data: { id: `e2e-keys-${t}`, name: "Dad" } });
    const dad = await before.prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true, authUserId: user.id } });
    const jar = await before.prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }] } } });
    const cardKey = "privacy-key-example";
    const sealedConn = before.crypto.encryptSecret(cardKey, before.sync.aad(jar.id, "PRIVACY"));
    const conn = await before.prisma.jarConnection.create({
      data: {
        jarId: jar.id,
        provider: "PRIVACY",
        encryptedValue: new Uint8Array(sealedConn.encryptedValue),
        iv: new Uint8Array(sealedConn.iv),
        authTag: new Uint8Array(sealedConn.authTag),
        fingerprint: before.crypto.fingerprint("privacy", cardKey),
        createdById: dad.id,
      },
    });
    const feed = await before.prisma.schoolFeed.create({
      data: { householdId: h.id, name: "School", encryptedValue: new Uint8Array(0), iv: new Uint8Array(0), authTag: new Uint8Array(0), urlHash: `hash-${t}`, host: "school.example.com" },
    });
    const sealedFeed = before.crypto.encryptSecret("https://school.example.com/cal.ics", before.refresh.feedAad(feed.id));
    await before.prisma.schoolFeed.update({ where: { id: feed.id }, data: { encryptedValue: new Uint8Array(sealedFeed.encryptedValue), iv: new Uint8Array(sealedFeed.iv), authTag: new Uint8Array(sealedFeed.authTag) } });
    await before.keys.checkKey();
    Object.assign(ids, { h: h.id, jar: jar.id, conn: conn.id, feed: feed.id, user: user.id });

    // 2. The new key with the old one as previous: the check passes and everything moves over.
    const during = await withKeys(NEW, OLD);
    await during.keys.checkKey();
    const s = await during.keys.resealServerSecrets();
    expect(s.resealed).toBeGreaterThanOrEqual(1);
    expect(await during.finance.resealJarConnections()).toMatchObject({ resealed: 1 });
    expect(await during.school.resealSchoolFeeds()).toMatchObject({ resealed: 1 });
    // A second run has nothing left of ours to move.
    expect((await during.finance.resealJarConnections()).resealed).toBe(0);

    // 3. The new key alone opens all of it, and the fingerprint is the new key's.
    const after = await withKeys(NEW);
    await after.keys.checkKey();
    const c = await after.prisma.jarConnection.findUniqueOrThrow({ where: { id: ids.conn } });
    expect(after.crypto.decryptSecret({ encryptedValue: Buffer.from(c.encryptedValue), iv: Buffer.from(c.iv), authTag: Buffer.from(c.authTag) }, after.sync.aad(ids.jar, "PRIVACY"))).toBe(cardKey);
    expect(c.fingerprint).toBe(after.crypto.fingerprint("privacy", cardKey));
    const f = await after.prisma.schoolFeed.findUniqueOrThrow({ where: { id: ids.feed } });
    expect(after.crypto.decryptSecret({ encryptedValue: Buffer.from(f.encryptedValue), iv: Buffer.from(f.iv), authTag: Buffer.from(f.authTag) }, after.refresh.feedAad(ids.feed))).toBe("https://school.example.com/cal.ics");

    // 4. A server started with some other key says so.
    const wrong = await withKeys(randomBytes(32).toString("base64"));
    await expect(wrong.keys.checkKey()).rejects.toThrow(wrong.keys.WrongKeyError);
  });

  test("what the System card says", async () => {
    const { keys } = await withKeys(saved.key!);
    expect(keys.keysDetail(false, 0, 0)).toBe("the key opens what's stored");
    expect(keys.keysDetail(true, 3, 0)).toBe("3 re-sealed");
    expect(keys.keysDetail(true, 0, 1)).toBe("all on the current key, 1 no key opens");
  });
});
