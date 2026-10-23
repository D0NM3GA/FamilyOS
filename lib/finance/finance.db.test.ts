import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 25 against a real database: `npm run test:db`. Jar isolation (an admin who isn't a
 * member gets nothing), the bank-feed sync with a fake SimpleFIN, statement import folding
 * into feed rows, Privacy.com enrichment, remembered answers, and the two PIN holes closed.
 */
const RUN = import.meta.env.MODE === "db";

// Actions revalidate pages; outside a request that's a no-op here.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The signed-in profile, swapped per test. Everything else is real.
const who = { profile: null as null | Record<string, unknown>, own: true };
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return {
    ...real,
    requireActiveProfile: async () => who.profile,
    getAuthPerson: async () => who.profile,
    isOwnSignIn: async () => who.own,
    isSessionOwner: async () => who.own,
  };
});

describe.skipIf(!RUN)("money jars (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", mom: "", grandma: "", pinAdult: "", jar: "", grandmaJar: "" };
  const users: string[] = [];

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-money-${Date.now()}` } });
    const t = Date.now();
    const mk = async (firstName: string, role: "ADMIN" | "ADULT", linked: boolean) => {
      const user = linked ? await prisma.user.create({ data: { id: `e2e-${firstName}-${t}`, name: firstName } }) : null;
      users.push(...(user ? [user.id] : []));
      return prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true, authUserId: user?.id ?? null } });
    };
    const [dad, mom, grandma, pinAdult] = await Promise.all([mk("Dad", "ADMIN", true), mk("Mom", "ADMIN", true), mk("Grandma", "ADULT", true), mk("Sitter", "ADULT", false)]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id }] } } });
    const grandmaJar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Grandma's", members: { create: [{ personId: grandma.id }] } } });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, grandma: grandma.id, pinAdult: pinAdult.id, jar: jar.id, grandmaJar: grandmaJar.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const as = async (personId: string, own = true) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: personId }, omit: { photo: true } });
    who.own = own;
  };
  beforeEach(() => {
    who.profile = null;
    who.own = true;
  });

  test("a jar opens only for its members, on their own sign-in; admin status grants nothing", async () => {
    const { requireJar, moneyViewer } = await import("./access");
    await as(ids.dad);
    expect((await requireJar(ids.jar)).jar.name).toBe("Family");
    // Dad is an admin, and still can't open Grandma's jar.
    await expect(requireJar(ids.grandmaJar)).rejects.toThrow();
    await as(ids.grandma);
    expect((await requireJar(ids.grandmaJar)).jar.name).toBe("Grandma's");
    await expect(requireJar(ids.jar)).rejects.toThrow();
    // A switched profile (not their own sign-in) gets nothing at all.
    await as(ids.grandma, false);
    expect(await moneyViewer()).toBeNull();
    await expect(requireJar(ids.grandmaJar)).rejects.toThrow();
  });

  test("bank feed sync: accounts and rows land once, pending rows that vanish are superseded", async () => {
    const { saveConnection, syncConnection } = await import("./sync");
    const conn = await saveConnection(ids.jar, "SIMPLEFIN", "https://u:p@bridge.simplefin.org/simplefin", ids.dad);
    const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;
    let txns = [
      { id: "T1", posted: day("2025-10-04"), amount: "-54.99", description: "PWP*NETFLIX.COM PRIVACY.COM" },
      { id: "T2", posted: day("2025-10-03"), amount: "-12.00", description: "GROCERY" },
      { id: "P1", posted: 0, transacted_at: day("2025-10-05"), amount: "-4.50", description: "COFFEE", pending: true },
    ];
    let balance = "90.00";
    const fetchFn = vi.fn(async () =>
      Response.json({ errors: [], accounts: [{ id: "A1", name: "Checking", currency: "USD", balance, org: { name: "Bank" }, transactions: txns }] }),
    ) as unknown as typeof fetch;
    const now = new Date("2025-10-06T12:00:00Z");
    await syncConnection(conn.id, { fetchFn, now });
    balance = "100.00";
    await syncConnection(conn.id, { fetchFn, now }); // idempotent
    expect(await prisma.finTransaction.count({ where: { jarId: ids.jar } })).toBe(3);

    txns = txns.filter((t) => t.id !== "P1").concat({ id: "T3", posted: day("2025-10-05"), amount: "-4.75", description: "COFFEE" });
    await syncConnection(conn.id, { fetchFn, now: new Date("2025-10-07T12:00:00Z") });
    expect((await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "P1" } })).state).toBe("SUPERSEDED");
    expect((await prisma.finAccount.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "A1" } })).balanceCents).toBe(10000);
    // Phase 34: one balance per account per sync day; a second sync that day replaced the first.
    const days = await prisma.finBalanceDay.findMany({ where: { account: { jarId: ids.jar } }, orderBy: { day: "asc" }, select: { day: true, balanceCents: true } });
    expect(days.map((d) => [d.day.toISOString().slice(0, 10), d.balanceCents])).toEqual([
      ["2025-10-06", 10000],
      ["2025-10-07", 10000],
    ]);
  });

  test("a statement file folds into feed rows: same day is a duplicate, near days a question", async () => {
    const { importRows, resolveIssue } = await import("./sync");
    const account = await prisma.finAccount.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "A1" } });
    const rows = [
      { externalId: "ofx:1", postedOn: "2025-10-04", amountCents: -5499, description: "NETFLIX", memo: null },
      { externalId: "ofx:2", postedOn: "2025-10-01", amountCents: -1200, description: "GROCERY", memo: null },
      { externalId: "ofx:3", postedOn: "2025-09-01", amountCents: -999, description: "OLD", memo: null },
    ];
    expect(await importRows(ids.jar, account.id, rows)).toEqual({ added: 3, already: 0 });
    expect(await importRows(ids.jar, account.id, rows)).toEqual({ added: 0, already: 3 });
    expect((await prisma.finTransaction.findFirstOrThrow({ where: { accountId: account.id, externalId: "ofx:1" } })).state).toBe("DUPLICATE");

    const issue = await prisma.reconcileIssue.findFirstOrThrow({ where: { jarId: ids.jar, kind: "POSSIBLE_DUPLICATE" } });
    expect(await resolveIssue(ids.jar, issue.id, "DIFFERENT")).toBe(true);
    // Asked once: re-importing doesn't ask again.
    await importRows(ids.jar, account.id, rows);
    expect(await prisma.reconcileIssue.count({ where: { jarId: ids.jar, kind: "POSSIBLE_DUPLICATE", resolvedAt: null } })).toBe(0);
    // Another jar can't answer this jar's questions.
    expect(await resolveIssue(ids.grandmaJar, issue.id, "SAME")).toBe(false);
  });

  test("Privacy.com charges name the real merchant on the bank row", async () => {
    const { enrichPrivacy } = await import("./sync");
    await prisma.privacyCharge.create({
      data: { jarId: ids.jar, token: "pv1", merchant: "NETFLIX.COM", cardMemo: "Netflix", amountCents: 5499, status: "SETTLED", occurredAt: new Date("2025-10-03T20:00:00Z") },
    });
    await enrichPrivacy(prisma, ids.jar, new Date("2025-10-06T12:00:00Z"));
    expect(await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "T1" } })).toMatchObject({ merchantName: "NETFLIX.COM", privacyCardMemo: "Netflix" });
  });

  test("a sync that fails doesn't move the window: after an outage nothing is skipped", async () => {
    const { syncConnection } = await import("./sync");
    const conn = await prisma.jarConnection.findFirstOrThrow({ where: { jarId: ids.jar, provider: "SIMPLEFIN" } });
    const before = conn.lastSuccessAt!;
    const down = vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await syncConnection(conn.id, { fetchFn: down, now: new Date("2025-11-01T12:00:00Z") });
    const after = await prisma.jarConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(after.lastSuccessAt).toEqual(before);
    expect(after.lastError).toMatch(/slow down/);
    expect(await prisma.reconcileIssue.count({ where: { jarId: ids.jar, key: `sync:${conn.id}`, resolvedAt: null } })).toBe(1);

    let asked = "";
    const up = vi.fn(async (url: URL | string) => {
      asked = new URL(String(url)).searchParams.get("start-date")!;
      return Response.json({ errors: [], accounts: [] });
    }) as unknown as typeof fetch;
    await prisma.jarConnection.update({ where: { id: conn.id }, data: { retryAfterUntil: null } });
    await syncConnection(conn.id, { fetchFn: up, now: new Date("2025-11-02T12:00:00Z") });
    expect(Number(asked) * 1000).toBe(before.getTime() - 10 * 86_400_000);
    expect(await prisma.reconcileIssue.count({ where: { jarId: ids.jar, key: `sync:${conn.id}`, resolvedAt: null } })).toBe(0);
  });

  test("members: only linked adults can join, a jar keeps someone who can open it, delete needs the name", async () => {
    const { addMember, removeMember, deleteJar } = await import("@/app/(app)/finances/actions");
    await as(ids.grandma);
    const add = new FormData();
    add.set("personId", ids.pinAdult);
    await addMember(ids.grandmaJar, add);
    expect(await prisma.moneyJarMember.count({ where: { jarId: ids.grandmaJar } })).toBe(1);
    expect(await removeMember(ids.grandmaJar, ids.grandma)).toMatchObject({ error: expect.stringMatching(/at least one/) });
    const wrong = new FormData();
    wrong.set("confirm", "nope");
    expect(await deleteJar(ids.grandmaJar, {}, wrong)).toMatchObject({ error: expect.any(String) });
    expect(await prisma.moneyJar.count({ where: { id: ids.grandmaJar } })).toBe(1);
  });

  test("Microsoft-linked adults can't be reached by a PIN, and admins can't give them one", async () => {
    const { verifyPinAndSelect } = await import("@/app/profiles/actions");
    const { setMemberPin } = await import("@/app/(app)/settings/household/actions");
    await as(ids.dad);
    const pinForm = new FormData();
    pinForm.set("pin", "4321");
    expect(await setMemberPin(ids.grandma, {}, pinForm)).toEqual({ error: "That household member wasn't found, or signs in with Microsoft." });
    // Even with a hash planted directly, the switch is refused.
    await prisma.person.update({ where: { id: ids.grandma }, data: { pinHash: "$argon2id$v=19$m=65536,t=3,p=4$abc$def" } });
    const select = new FormData();
    select.set("personId", ids.grandma);
    select.set("pin", "4321");
    expect(await verifyPinAndSelect({}, select)).toEqual({ error: "That profile isn't available." });
  });

  test("Phase 42: a restored admin with no sign-in can't be given a PIN; a grown-up on a PIN still can", async () => {
    const { setMemberPin } = await import("@/app/(app)/settings/household/actions");
    await as(ids.dad);
    const restoredAdmin = await prisma.person.create({ data: { householdId: ids.h, firstName: "Grandpa", role: "ADMIN", isHouseholdMember: true } });
    const pinForm = new FormData();
    pinForm.set("pin", "135792");
    expect(await setMemberPin(restoredAdmin.id, {}, pinForm)).toEqual({ error: "Admins don't get a PIN. Send them an invite to make their own passkey." });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: restoredAdmin.id }, select: { pinHash: true } })).pinHash).toBeNull();
    expect(await setMemberPin(ids.pinAdult, {}, pinForm)).toEqual({ success: true });
  });
});
