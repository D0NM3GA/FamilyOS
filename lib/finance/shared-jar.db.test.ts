import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { encryptSecret, fingerprint } from "@/lib/crypto";
import { householdTeamsAad } from "@/lib/alerts/teams";
import { todayCivil } from "./budget";

/**
 * Phase 30 against a real database: `npm run test:db`. A shared jar's history shows each person
 * what the others changed, except what's about a surprise for them; the same Privacy.com account
 * or bank account can't land in two of your jars (without naming jars you aren't in); and a jar's
 * Teams chat gets each shared alert once, never one about a surprise.
 */
const RUN = import.meta.env.MODE === "db";

const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isOwnSignIn: async () => true };
});
vi.mock("@/lib/finance/privacy", async (orig) => {
  const real = await orig<typeof import("@/lib/finance/privacy")>();
  return { ...real, verifyKey: async () => {} };
});
vi.mock("@/lib/finance/schedule", () => ({ scheduleJarSync: async () => {} }));

const DAY = 86_400_000;
const today = todayCivil();
const dayFrom = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const CHAT = "19:abcDEF123_family-chat@thread.v2";
const PRIVACY_KEY = "11111111-2222-3333-4444-555555555555";

describe.skipIf(!RUN)("shared jars (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", mom: "", grandma: "", jar: "", other: "", gJar: "", feed: "" };
  const users: string[] = [];
  const t = Date.now();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-shared-${t}` } });
    const person = async (firstName: string) => {
      const user = await prisma.user.create({ data: { id: `e2e-s-${firstName}-${t}`, name: firstName, email: `${firstName}-${t}@example.com` } });
      users.push(user.id);
      return prisma.person.create({ data: { householdId: h.id, firstName, role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    };
    const [dad, mom, grandma] = await Promise.all([person("Dad"), person("Mom"), person("Grandma")]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id }] } } });
    const other = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Side Hustle", members: { create: [{ personId: dad.id }] } } });
    const gJar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Grandma's", members: { create: [{ personId: grandma.id }] } } });
    const feed = await prisma.finAccount.create({ data: { jarId: jar.id, source: "SIMPLEFIN", externalId: `f-${t}`, name: "Checking" } });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, grandma: grandma.id, jar: jar.id, other: other.id, gJar: gJar.id, feed: feed.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const as = async (personId: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: personId }, omit: { photo: true } });
  };
  const feedRow = (externalId: string, postedOn: string, amountCents: number, description: string, extra: object = {}) =>
    prisma.finTransaction.create({
      data: { jarId: ids.jar, accountId: ids.feed, source: "SIMPLEFIN", externalId, postedOn: asDate(postedOn), amountCents, description, merchantKey: description.toLowerCase(), ...extra },
    });
  const form = (entries: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };
  const historyOf = async (personId: string) => {
    const { jarHistory } = await import("./history");
    return (await jarHistory(ids.jar, personId, today, 50)).map((l) => l.text);
  };

  test("history: each sees what the other changed, but not what's about a surprise for them", async () => {
    const { setBudget, markGift, markRecurring, setCategory } = await import("@/app/(app)/finances/actions");
    const dining = await prisma.finCategory.create({ data: { jarId: ids.jar, key: "dining-s", name: "Dining", kind: "SPEND" } });
    await as(ids.mom);
    expect((await setBudget(ids.jar, dining.id, {}, form([["amount", "400"]]))).ok).toBeTruthy();

    const lego = await feedRow("lego", dayFrom(-2), -12999, "LEGO STORE");
    await as(ids.dad);
    expect((await markGift(ids.jar, lego.id, {}, form([["hiddenFrom", ids.mom], ["revealOn", dayFrom(30)]]))).ok).toBeTruthy();
    await setCategory(ids.jar, lego.id, dining.id, "always");
    await markRecurring(ids.jar, "lego store", "KEEP");

    const mom = await historyOf(ids.mom);
    const dad = await historyOf(ids.dad);
    expect(dad).toContain("Mom set Dining's budget to $400.00");
    expect(mom).toContain("Mom set Dining's budget to $400.00");
    expect(dad.some((x) => x.startsWith("Dad marked a charge 🎁 for Mom"))).toBe(true);
    expect(dad).toContain("Dad set Lego Store to always be Dining");
    expect(dad).toContain("Dad is still using Lego Store");
    // Tied to the charge, or to its merchant: both hidden from Mom.
    expect(mom.some((x) => x.includes("🎁") || x.includes("Lego"))).toBe(false);

    // Once it's revealed, the events come back.
    const { revealGift } = await import("@/app/(app)/finances/actions");
    await revealGift(ids.jar, lego.id);
    expect((await historyOf(ids.mom)).some((x) => x.includes("Lego Store"))).toBe(true);
  });

  test("Privacy.com: refused in a second jar you're in, allowed (and not named) in one you're not", async () => {
    const { saveConnection } = await import("./sync");
    const { connectPrivacy } = await import("@/app/(app)/finances/actions");
    await saveConnection(ids.other, "PRIVACY", PRIVACY_KEY, ids.dad);
    expect((await prisma.jarConnection.findFirstOrThrow({ where: { jarId: ids.other } })).fingerprint).toBe(fingerprint("privacy", PRIVACY_KEY));

    await as(ids.dad);
    expect(await connectPrivacy(ids.jar, {}, form([["key", PRIVACY_KEY]]))).toEqual({ error: "That Privacy.com account is already in Side Hustle. Open that jar instead." });
    expect(await prisma.jarConnection.count({ where: { jarId: ids.jar, provider: "PRIVACY" } })).toBe(0);

    // Grandma isn't in Side Hustle: nothing tells her it exists.
    await as(ids.grandma);
    expect(await connectPrivacy(ids.gJar, {}, form([["key", PRIVACY_KEY]]))).toEqual({ ok: "Privacy.com connected." });
  });

  test("SimpleFIN: an account already in another of the connector's jars is left out", async () => {
    const { saveConnection, syncConnection } = await import("./sync");
    await prisma.finAccount.create({ data: { jarId: ids.other, source: "SIMPLEFIN", externalId: "SHARED-ACCT", name: "Joint" } });
    const conn = await saveConnection(ids.jar, "SIMPLEFIN", "https://u:p@bridge.simplefin.org/simplefin", ids.dad);
    const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;
    const fetchFn = vi.fn(async () =>
      Response.json({
        errors: [],
        accounts: [
          { id: "SHARED-ACCT", name: "Joint", currency: "USD", balance: "10.00", org: { name: "Bank" }, transactions: [{ id: "J1", posted: day(dayFrom(-1)), amount: "-5.00", description: "COFFEE" }] },
          { id: "NEW-ACCT", name: "Savings", currency: "USD", balance: "20.00", org: { name: "Bank" }, transactions: [] },
        ],
      }),
    ) as unknown as typeof fetch;
    await syncConnection(conn.id, { fetchFn, now: new Date() });
    const accounts = await prisma.finAccount.findMany({ where: { jarId: ids.jar, source: "SIMPLEFIN" }, select: { externalId: true } });
    expect(accounts.map((a) => a.externalId)).toContain("NEW-ACCT");
    expect(accounts.map((a) => a.externalId)).not.toContain("SHARED-ACCT");
    expect(await prisma.jarConnection.findUniqueOrThrow({ where: { id: conn.id } })).toMatchObject({ skippedAccounts: 1, skippedJarId: ids.other });
  });

  test("the jar's Teams chat gets each shared alert once and never one about a surprise; people get bell and phone only", async () => {
    const { evaluateMoneyAlerts } = await import("./alerts");
    for (const [i, d] of [-91, -60, -29].entries()) {
      await feedRow(`net${i}`, dayFrom(d), -1599, "NETFLIX");
      await feedRow(`box${i}`, dayFrom(d), -4500, "TOY BOX CLUB", { giftById: ids.dad, giftHiddenFrom: [ids.mom], giftRevealOn: asDate(dayFrom(60)) });
    }
    const enc = encryptSecret("https://prod-00.example.logic.azure.com/workflows/x", householdTeamsAad(ids.h));
    await prisma.householdAlerts.create({
      data: {
        householdId: ids.h,
        teamsWebhookEnc: new Uint8Array(enc.encryptedValue),
        teamsWebhookIv: new Uint8Array(enc.iv),
        teamsWebhookTag: new Uint8Array(enc.authTag),
        teamsWebhookHost: "prod-00.example.logic.azure.com",
        updatedByPersonId: ids.dad,
      },
    });
    await prisma.moneyJar.update({ where: { id: ids.jar }, data: { teamsChatId: CHAT } });

    const deliver = vi.fn(async () => {});
    const posted: string[] = [];
    const postChat = vi.fn(async (_url: string, chatId: string, _r: string, title: string) => {
      expect(chatId).toBe(CHAT);
      posted.push(title);
    });
    await evaluateMoneyAlerts(new Date(), deliver, postChat);
    expect(posted.some((x) => x.startsWith("🧾 Netflix is due"))).toBe(true);
    expect(posted.some((x) => x.includes("Toy Box"))).toBe(false);

    // Netflix: bell and phone for both, no personal Teams. Toy Box: Dad's own Teams as before.
    const notes = await prisma.notification.findMany({ where: { householdId: ids.h }, select: { id: true, recipientId: true, title: true } });
    const quiet = deliver.mock.calls.find((c) => (c as unknown[])[1] && ((c as unknown[])[1] as { channels: string }).channels === "push-only");
    const loud = deliver.mock.calls.find((c) => (c as unknown[])[1] && ((c as unknown[])[1] as { channels: string }).channels === "teams-first");
    const idsIn = (call: unknown) => ((call as [{ id: { in: string[] } }])[0].id.in as string[]).map((id) => notes.find((n) => n.id === id)!);
    expect(idsIn(quiet).every((n) => n.title.startsWith("🧾 Netflix"))).toBe(true);
    expect(idsIn(quiet).map((n) => n.recipientId).sort()).toEqual([ids.dad, ids.mom].sort());
    expect(idsIn(loud).map((n) => [n.recipientId, n.title.includes("Toy Box")])).toEqual([[ids.dad, true]]);

    // A second run posts nothing again.
    posted.length = 0;
    await evaluateMoneyAlerts(new Date(), deliver, postChat);
    expect(posted).toEqual([]);
    expect((await prisma.moneyJar.findUniqueOrThrow({ where: { id: ids.jar } })).teamsChatError).toBeNull();
  });

  test("a chat post that fails is tried again next run, and the error shows until one goes", async () => {
    const { evaluateMoneyAlerts } = await import("./alerts");
    await prisma.jarChatAlertSent.deleteMany({ where: { jarId: ids.jar } });
    const down = vi.fn(async () => {
      throw new Error("Couldn't reach Teams.");
    });
    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}), down);
    expect(down).toHaveBeenCalled();
    expect(await prisma.jarChatAlertSent.count({ where: { jarId: ids.jar } })).toBe(0);
    expect((await prisma.moneyJar.findUniqueOrThrow({ where: { id: ids.jar } })).teamsChatError).toBe("Couldn't reach Teams.");

    const up = vi.fn(async () => {});
    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}), up);
    expect(up).toHaveBeenCalled();
    expect((await prisma.moneyJar.findUniqueOrThrow({ where: { id: ids.jar } })).teamsChatError).toBeNull();
  });

  test("push-only skips Teams even for people who switched Teams on", async () => {
    const { deliverNotifications } = await import("@/lib/alerts/dispatch");
    await prisma.alertPrefs.upsert({ where: { personId: ids.dad }, create: { personId: ids.dad, teamsEnabled: true }, update: { teamsEnabled: true } });
    const n = await prisma.notification.create({ data: { householdId: ids.h, recipientId: ids.dad, kind: "MONEY_BILL_DUE", title: "x", href: "/finances" } });
    const teams = vi.fn(async () => {});
    await deliverNotifications({ id: n.id }, { channels: "push-only" }, { teams, email: vi.fn(async () => {}), push: vi.fn(async () => 0) } as never);
    expect(teams).not.toHaveBeenCalled();
  });
});
