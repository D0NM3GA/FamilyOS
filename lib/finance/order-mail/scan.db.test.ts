import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Graph, GraphResponse } from "@/lib/graph/client";
import { todayCivil } from "../budget";
import { visibleToWhere } from "../gifts";
import { AMAZON, APPLE } from "./fixtures";
import { ordersOnCharges, unmatchedOrders } from "./orders";
import { runOrderScan } from "./scan";

/**
 * Phase 29 against a real database: `npm run test:db`. Graph is a fake: nothing leaves the
 * machine. A scan reads only verified order mails, keeps only the order, matches it to its
 * charge, never reads an email twice, and stops for someone who left the jar; the jar sees
 * an order only through its charge, two days after the match, and never one that's a
 * surprise for them.
 */
const RUN = import.meta.env.MODE === "db";
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const who = { profile: null as null | Record<string, unknown> };
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isOwnSignIn: async () => true };
});

const PASS = [{ name: "Authentication-Results", value: "dmarc=pass action=none header.from=amazon.com;compauth=pass reason=100" }];

describe.skipIf(!RUN)("order emails (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", mom: "", jar: "", charge: "" };
  const users: string[] = [];
  const today = todayCivil();
  const dayFrom = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000);

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-mail-${t}` } });
    const person = async (firstName: string) => {
      const user = await prisma.user.create({ data: { id: `e2e-om-${firstName}-${t}`, name: firstName, email: `${firstName}-${t}@example.com` } });
      users.push(user.id);
      return prisma.person.create({ data: { householdId: h.id, firstName, role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    };
    const [dad, mom] = await Promise.all([person("Dad"), person("Mom")]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id }] } } });
    const account = await prisma.finAccount.create({ data: { jarId: jar.id, source: "SIMPLEFIN", externalId: `a-${t}`, name: "Checking" } });
    const charge = await prisma.finTransaction.create({
      data: { jarId: jar.id, accountId: account.id, source: "SIMPLEFIN", externalId: "amz1", postedOn: dayFrom(-1), amountCents: -1573, description: "AMAZON MKTPL*AB12CD", merchantKey: "amazon mktpl" },
    });
    await prisma.mailOrderScan.create({ data: { personId: dad.id, jarId: jar.id, enabled: true } });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, jar: jar.id, charge: charge.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const received = dayFrom(-2).toISOString();
  const messages = [
    { id: "m-amazon", internetMessageId: `<amz-${t}@example.test>`, subject: "Ordered 1 item: Floor Care", receivedDateTime: received, from: { emailAddress: { address: "auto-confirm@amazon.com" } } },
    { id: "m-spoof", internetMessageId: `<spoof-${t}@example.test>`, subject: "Your receipt from Apple.", receivedDateTime: received, from: { emailAddress: { address: "no_reply@email.apple.com" } } },
    { id: "m-news", internetMessageId: `<news-${t}@example.test>`, subject: "Deals for you", receivedDateTime: received, from: { emailAddress: { address: "auto-confirm@amazon.com" } } },
  ];
  const fakeGraph = () => {
    const calls: string[] = [];
    const graph: Graph = async (_method, path): Promise<GraphResponse> => {
      calls.push(path);
      if (path.startsWith("/me/messages?")) return { status: 200, json: path.includes("%24search") ? { value: [] } : { value: messages }, retryAfter: null };
      if (path.startsWith("/me/messages/m-amazon")) return { status: 200, json: { body: { content: AMAZON }, internetMessageHeaders: PASS }, retryAfter: null };
      // Claims to be Apple, but the mail server didn't vouch for it.
      if (path.startsWith("/me/messages/m-spoof")) return { status: 200, json: { body: { content: APPLE }, internetMessageHeaders: [{ name: "Authentication-Results", value: "dmarc=fail header.from=email.apple.com" }] }, retryAfter: null };
      return { status: 404, json: null, retryAfter: null };
    };
    return { graph, calls };
  };

  test("reads verified order mail only, keeps only the order, matches it, and never reads twice", async () => {
    const g = fakeGraph();
    expect(await runOrderScan({ personId: ids.dad, jarId: ids.jar, graph: g.graph })).toEqual({ found: 1, skipped: 1, error: null });
    // The newsletter was never opened.
    expect(g.calls.some((c) => c.startsWith("/me/messages/m-news"))).toBe(false);
    const list = new URLSearchParams(g.calls.find((c) => c.startsWith("/me/messages?") && !c.includes("search"))!.split("?")[1]);
    expect(list.get("$filter")).toContain("from/emailAddress/address eq 'auto-confirm@amazon.com'");
    expect(list.get("$orderby")).toBe("receivedDateTime asc");
    const orders = await prisma.mailOrder.findMany({ where: { jarId: ids.jar } });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ retailer: "AMAZON", orderNumber: "111-1234567-7654321", totalCents: 1573, label: "Floor Care", matchedTxnId: ids.charge, matchedBy: "AUTO", personId: ids.dad });
    expect(JSON.stringify(orders[0])).not.toMatch(/Pat|SPRINGFIELD|Terry Avenue/);

    // Read again: nothing is fetched twice, not even the mail that didn't check out.
    const again = fakeGraph();
    expect(await runOrderScan({ personId: ids.dad, jarId: ids.jar, graph: again.graph })).toEqual({ found: 0, skipped: 0, error: null });
    expect(again.calls.filter((c) => c.startsWith("/me/messages/"))).toEqual([]);
  });

  test("the whole jar sees orders right away; a surprise hides its order from the person it's for", async () => {
    const seenBy = async (personId: string) => {
      const rows = await prisma.finTransaction.findMany({ where: { jarId: ids.jar, ...visibleToWhere(personId, today) }, select: { id: true } });
      return ordersOnCharges(ids.jar, rows.map((r) => r.id), personId, today);
    };
    expect(await seenBy(ids.dad)).toHaveLength(1);
    expect(await seenBy(ids.mom)).toHaveLength(1);

    // A surprise for Mom: the charge isn't among the rows she can see, so neither is its order.
    await prisma.finTransaction.update({ where: { id: ids.charge }, data: { giftById: ids.dad, giftHiddenFrom: [ids.mom], giftRevealOn: dayFrom(20) } });
    expect(await seenBy(ids.mom)).toHaveLength(0);
    expect(await seenBy(ids.dad)).toHaveLength(1);

    // Mom can't take the order off a charge she can't see (which would show it to her).
    const { unlinkOrder } = await import("@/app/(app)/finances/actions");
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: ids.mom }, omit: { photo: true } });
    const order = await prisma.mailOrder.findFirstOrThrow({ where: { jarId: ids.jar } });
    await unlinkOrder(ids.jar, order.id);
    expect((await prisma.mailOrder.findUniqueOrThrow({ where: { id: order.id } })).matchedTxnId).toBe(ids.charge);
    await prisma.finTransaction.update({ where: { id: ids.charge }, data: { giftById: null, giftHiddenFrom: [], giftRevealOn: null } });

    // Unmatched orders are the jar's too.
    await prisma.mailOrder.updateMany({ where: { jarId: ids.jar }, data: { matchedTxnId: null, matchedBy: "PERSON", matchedAt: null } });
    expect(await unmatchedOrders(ids.jar, ids.mom, today)).toHaveLength(1);
  });

  test("an order email can be a surprise before its charge arrives, and its charge takes the mark", async () => {
    const { markOrderGift, revealOrderGift, linkOrder } = await import("@/app/(app)/finances/actions");
    const { carryOrderGift } = await import("./orders");
    const asWho = async (id: string) => (who.profile = await prisma.person.findUniqueOrThrow({ where: { id }, omit: { photo: true } }));
    const form = (entries: [string, string][]) => {
      const fd = new FormData();
      for (const [k, v] of entries) fd.append(k, v);
      return fd;
    };
    const reveal = dayFrom(20).toISOString().slice(0, 10);
    const order = await prisma.mailOrder.findFirstOrThrow({ where: { jarId: ids.jar, matchedTxnId: null } });

    // Dad marks it for Mom: gone from her list, still in his.
    await asWho(ids.dad);
    expect(await markOrderGift(ids.jar, order.id, {}, form([["hiddenFrom", ids.mom], ["revealOn", reveal]]))).toEqual({ ok: "🤫 Shh. It's a surprise." });
    expect(await unmatchedOrders(ids.jar, ids.mom, today)).toHaveLength(0);
    expect(await unmatchedOrders(ids.jar, ids.dad, today)).toHaveLength(1);
    // Hidden from yourself or past a year: refused.
    expect(await markOrderGift(ids.jar, order.id, {}, form([["hiddenFrom", ids.dad], ["revealOn", reveal]]))).toEqual({ error: "Pick who it's a surprise for." });
    expect(await markOrderGift(ids.jar, order.id, {}, form([["hiddenFrom", ids.mom], ["revealOn", dayFrom(400).toISOString().slice(0, 10)]]))).toEqual({ error: "Pick a day within a year." });

    // Mom can't see it, so she can't mark it, reveal it, or link it to a charge.
    await asWho(ids.mom);
    expect(await markOrderGift(ids.jar, order.id, {}, form([["hiddenFrom", ids.dad], ["revealOn", reveal]]))).toEqual({ error: "That order isn't waiting here anymore." });
    await revealOrderGift(ids.jar, order.id);
    await linkOrder(ids.jar, order.id, form([["txnId", ids.charge]]));
    expect(await prisma.mailOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ matchedTxnId: null, giftHiddenFrom: [ids.mom] });

    // Dad links it: the charge becomes the same surprise, so Mom sees neither.
    await asWho(ids.dad);
    await linkOrder(ids.jar, order.id, form([["txnId", ids.charge]]));
    expect(await prisma.finTransaction.findUniqueOrThrow({ where: { id: ids.charge } })).toMatchObject({ giftById: ids.dad, giftHiddenFrom: [ids.mom] });
    const momRows = await prisma.finTransaction.findMany({ where: { jarId: ids.jar, ...visibleToWhere(ids.mom, today) }, select: { id: true } });
    expect(momRows.map((r) => r.id)).not.toContain(ids.charge);
    expect(await ordersOnCharges(ids.jar, [ids.charge], ids.mom, today)).toHaveLength(0);

    // A charge with its own live mark keeps it.
    await prisma.finTransaction.update({ where: { id: ids.charge }, data: { giftById: ids.mom, giftHiddenFrom: [ids.dad] } });
    expect(await carryOrderGift(prisma, ids.jar, order.id, ids.charge)).toBe(false);
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: ids.charge } })).giftHiddenFrom).toEqual([ids.dad]);

    // Only the marker shows it early.
    await revealOrderGift(ids.jar, order.id);
    expect((await prisma.mailOrder.findUniqueOrThrow({ where: { id: order.id } })).giftHiddenFrom).toEqual([]);

    await prisma.finTransaction.update({ where: { id: ids.charge }, data: { giftById: null, giftHiddenFrom: [], giftRevealOn: null } });
  });

  test("a 🎁 order matched by itself hands its mark to the charge, keeps it through a merge, and the charge's Show it now shows both", async () => {
    const { recordOrder, matchJarOrders } = await import("./orders");
    const { revealGift } = await import("@/app/(app)/finances/actions");
    const base = { retailer: "APPLE" as const, orderNumber: "MXGIFT1", orderedOn: today, label: null, items: [{ name: "Gift Card", qty: 1, priceCents: 2500 }] };
    await recordOrder(prisma, ids.jar, ids.dad, { ...base, totalCents: 2500 }, "g1");
    const order = await prisma.mailOrder.findFirstOrThrow({ where: { jarId: ids.jar, orderNumber: "MXGIFT1" } });
    await prisma.mailOrder.update({ where: { id: order.id }, data: { giftById: ids.dad, giftHiddenFrom: [ids.mom], giftRevealOn: dayFrom(30) } });

    // Another email about the same order: merged, the mark stays.
    await recordOrder(prisma, ids.jar, ids.dad, { ...base, totalCents: 2500, items: [] }, "g2");
    expect(await prisma.mailOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ giftHiddenFrom: [ids.mom], sourceHashes: ["g1", "g2"] });

    // Its charge arrives and matches by itself: the charge is the same surprise.
    const account = await prisma.finAccount.findFirstOrThrow({ where: { jarId: ids.jar } });
    const charge = await prisma.finTransaction.create({ data: { jarId: ids.jar, accountId: account.id, source: "SIMPLEFIN", externalId: "app-gift", postedOn: dayFrom(1), amountCents: -2500, description: "APPLE.COM/BILL", merchantKey: "apple.com bill" } });
    await matchJarOrders(prisma, ids.jar);
    expect((await prisma.mailOrder.findUniqueOrThrow({ where: { id: order.id } })).matchedTxnId).toBe(charge.id);
    expect(await prisma.finTransaction.findUniqueOrThrow({ where: { id: charge.id } })).toMatchObject({ giftById: ids.dad, giftHiddenFrom: [ids.mom] });

    // Dad shows the charge now: the order on it shows too.
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: ids.dad }, omit: { photo: true } });
    await revealGift(ids.jar, charge.id);
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: charge.id } })).giftHiddenFrom).toEqual([]);
    expect((await prisma.mailOrder.findUniqueOrThrow({ where: { id: order.id } })).giftHiddenFrom).toEqual([]);
    expect(await ordersOnCharges(ids.jar, [charge.id], ids.mom, today)).toHaveLength(1);
  });

  test("someone who left the jar: nothing is read or written", async () => {
    await prisma.moneyJarMember.delete({ where: { jarId_personId: { jarId: ids.jar, personId: ids.dad } } });
    const g = fakeGraph();
    expect(await runOrderScan({ personId: ids.dad, jarId: ids.jar, graph: g.graph })).toEqual({ found: 0, skipped: 0, error: null });
    expect(g.calls).toEqual([]);
  });

  test("Graph throttling and expired tokens are fixed text, and back off", async () => {
    await prisma.moneyJarMember.create({ data: { jarId: ids.jar, personId: ids.dad } });
    const throttled: Graph = async () => ({ status: 429, json: null, retryAfter: 120 });
    const r = await runOrderScan({ personId: ids.dad, jarId: ids.jar, graph: throttled });
    expect(r.error).toBe("Outlook asked the app to slow down. It'll carry on next time.");
    const scan = await prisma.mailOrderScan.findUniqueOrThrow({ where: { personId: ids.dad } });
    expect(scan.retryAfterUntil!.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  test("emails about one order merge; a replaced charge lets its order match again", async () => {
    const { recordOrder, matchJarOrders } = await import("./orders");
    const base = { retailer: "APPLE" as const, orderNumber: "MXMERGE1", orderedOn: today, label: null };
    await recordOrder(prisma, ids.jar, ids.dad, { ...base, totalCents: null, items: [{ name: "Game — Pass", qty: 1, priceCents: 899 }] }, "h1");
    await recordOrder(prisma, ids.jar, ids.dad, { ...base, totalCents: 899, items: [] }, "h2");
    const merged = await prisma.mailOrder.findFirstOrThrow({ where: { jarId: ids.jar, orderNumber: "MXMERGE1" } });
    expect(merged).toMatchObject({ totalCents: 899, sourceHashes: ["h1", "h2"] });
    expect(merged.items).toEqual([{ name: "Game — Pass", qty: 1, priceCents: 899 }]);

    // Matched to a pending charge that then posts under a new id: let go, then matched to the new row.
    const account = await prisma.finAccount.findFirstOrThrow({ where: { jarId: ids.jar } });
    const pend = await prisma.finTransaction.create({ data: { jarId: ids.jar, accountId: account.id, source: "SIMPLEFIN", externalId: "app-p", postedOn: dayFrom(0), amountCents: -899, description: "APPLE.COM/BILL", merchantKey: "apple.com bill", pending: true } });
    await matchJarOrders(prisma, ids.jar);
    expect((await prisma.mailOrder.findUniqueOrThrow({ where: { id: merged.id } })).matchedTxnId).toBe(pend.id);
    await prisma.finTransaction.update({ where: { id: pend.id }, data: { state: "SUPERSEDED" } });
    const posted = await prisma.finTransaction.create({ data: { jarId: ids.jar, accountId: account.id, source: "SIMPLEFIN", externalId: "app-1", postedOn: dayFrom(1), amountCents: -899, description: "APPLE.COM/BILL", merchantKey: "apple.com bill" } });
    await matchJarOrders(prisma, ids.jar);
    expect((await prisma.mailOrder.findUniqueOrThrow({ where: { id: merged.id } })).matchedTxnId).toBe(posted.id);
  });
});
