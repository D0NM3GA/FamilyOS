import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { describeLastPrice, getLastPrices, matchStore, prepareReceipt, saveReceiptPrices } from "./receipts";
import { receiptTextKey } from "./receipt-match";

/**
 * Phase 24 against a real database: `npm run test:db`. A reviewed receipt saves prices and
 * learns matches; the next receipt matches on its own; a wrong match can be corrected or
 * forgotten; nothing crosses households.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("receipt prices (database)", () => {
  const ids = { h: "", other: "", dog: "", ban: "", theirs: "", target: "", purchase: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-receipt-${Date.now()}` } });
    const other = await prisma.household.create({ data: { name: `e2e-receipt-other-${Date.now()}` } });
    const dog = await prisma.product.create({ data: { householdId: h.id, name: "Dog food", nameKey: "dog food", brand: "Purina" } });
    const ban = await prisma.product.create({ data: { householdId: h.id, name: "Bananas", nameKey: "banana" } });
    const theirs = await prisma.product.create({ data: { householdId: other.id, name: "Dog food", nameKey: "dog food" } });
    const target = await prisma.store.create({ data: { householdId: h.id, name: "Target" } });
    const purchase = await prisma.purchase.create({
      data: {
        householdId: h.id,
        purchasedAt: new Date(),
        items: { create: [{ productId: dog.id, description: "Dog food" }, { productId: ban.id, description: "Bananas" }] },
      },
    });
    Object.assign(ids, { h: h.id, other: other.id, dog: dog.id, ban: ban.id, theirs: theirs.id, target: target.id, purchase: purchase.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  const receipt = {
    merchant: "TARGET T-1234",
    date: "2026-10-04",
    totalCents: 5637,
    lines: [
      { text: "PURINA DOG FD 31.1LB", quantity: null, unitCents: null, totalCents: 5499 },
      { text: "BANANAS", quantity: 2.34, unitCents: 59, totalCents: 138 },
    ],
  };

  test("a recent trip and the store are found; trip items are suggested", async () => {
    const prepared = await prepareReceipt(ids.h, receipt, { purchaseId: null });
    expect(prepared.purchaseId).toBe(ids.purchase);
    expect(prepared.storeId).toBe(ids.target);
    expect(prepared.lines.map((l) => [l.match.productId, l.match.how])).toEqual([
      [ids.dog, "suggested"],
      [ids.ban, "suggested"],
    ]);
    // Another household's trip id is just ignored.
    expect((await prepareReceipt(ids.other, receipt, { purchaseId: ids.purchase })).purchaseId).toBeNull();
  });

  test("saving prices learns the matches; the next receipt matches on its own", async () => {
    const saved = await saveReceiptPrices(ids.h, {
      purchaseId: ids.purchase,
      storeId: ids.target,
      date: receipt.date,
      lines: [
        { key: receiptTextKey("PURINA DOG FD 31.1LB"), productId: ids.dog, quantity: null, unitCents: null, totalCents: 5499, initialProductId: ids.dog, initialHow: "suggested" },
        { key: receiptTextKey("BANANAS"), productId: ids.ban, quantity: 2.34, unitCents: 59, totalCents: 138, initialProductId: ids.ban, initialHow: "suggested" },
        // Someone else's product id is ignored, not priced, not learned.
        { key: "stolen", productId: ids.theirs, quantity: null, unitCents: null, totalCents: 100, initialProductId: null, initialHow: "none" },
      ],
    });
    expect(saved).toBe(2);

    const prices = await getLastPrices(ids.h);
    expect(prices.get(ids.dog)).toMatchObject({ unitCents: 5499, totalCents: 5499, storeName: "Target" });
    // Weighed: no per-one price, the total and the weight instead.
    expect(prices.get(ids.ban)).toMatchObject({ unitCents: null, totalCents: 138, quantity: 2.34 });
    expect(describeLastPrice(prices.get(ids.ban)!)).toMatch(/^\$1\.38 for 2\.34 at Target · /);
    expect(await prisma.receiptAlias.count({ where: { householdId: ids.h } })).toBe(2);
    expect(await prisma.receiptAlias.count({ where: { textKey: "stolen" } })).toBe(0);

    const next = await prepareReceipt(ids.h, receipt, { purchaseId: null });
    expect(next.lines.map((l) => l.match.how)).toEqual(["learned", "learned"]);
  });

  test("saving the same receipt twice doesn't double its prices", async () => {
    const line = { key: "dup line", productId: ids.dog, quantity: null, unitCents: null, totalCents: 777, initialProductId: null, initialHow: "none" as const };
    const review = { purchaseId: ids.purchase, storeId: ids.target, date: null, lines: [line] };
    expect(await saveReceiptPrices(ids.h, review)).toBe(1);
    expect(await saveReceiptPrices(ids.h, review)).toBe(0);
    expect(await prisma.itemPrice.count({ where: { productId: ids.dog, totalCents: 777 } })).toBe(1);
  });

  test("a line printed twice: kept once and skipped once keeps what it learned", async () => {
    const key = receiptTextKey("PURINA DOG FD 31.1LB");
    const learned = { key, quantity: null, unitCents: null, totalCents: 100, initialProductId: ids.dog, initialHow: "learned" as const };
    await saveReceiptPrices(ids.h, { purchaseId: null, storeId: null, date: null, lines: [{ ...learned, productId: ids.dog }, { ...learned, productId: null }] });
    expect(await prisma.receiptAlias.count({ where: { householdId: ids.h, textKey: key } })).toBe(1);
  });

  test("changing a learned line re-teaches it; skipping it forgets it", async () => {
    const key = receiptTextKey("BANANAS");
    await saveReceiptPrices(ids.h, {
      purchaseId: null,
      storeId: null,
      date: null,
      lines: [{ key, productId: ids.dog, quantity: null, unitCents: null, totalCents: 100, initialProductId: ids.ban, initialHow: "learned" }],
    });
    expect((await prisma.receiptAlias.findUniqueOrThrow({ where: { householdId_textKey: { householdId: ids.h, textKey: key } } })).productId).toBe(ids.dog);

    await saveReceiptPrices(ids.h, {
      purchaseId: null,
      storeId: null,
      date: null,
      lines: [{ key, productId: null, quantity: null, unitCents: null, totalCents: 100, initialProductId: ids.dog, initialHow: "learned" }],
    });
    expect(await prisma.receiptAlias.findUnique({ where: { householdId_textKey: { householdId: ids.h, textKey: key } } })).toBeNull();
  });

  test("the newest price wins, and asking for some items gets only those", async () => {
    await prisma.itemPrice.createMany({
      data: [
        { householdId: ids.h, productId: ids.ban, totalCents: 1, observedAt: new Date(2001, 0, 1) },
        { householdId: ids.h, productId: ids.ban, totalCents: 2, observedAt: new Date(2099, 0, 1) },
      ],
    });
    const prices = await getLastPrices(ids.h, [ids.ban]);
    expect([...prices.keys()]).toEqual([ids.ban]);
    expect(prices.get(ids.ban)).toMatchObject({ totalCents: 2, quantity: 1, storeName: null });
    expect((await getLastPrices(ids.h)).has(ids.dog)).toBe(true);
    expect((await getLastPrices(ids.h, [])).size).toBe(0);
  });

  test("store names match merchant text either way round", () => {
    const stores = [
      { id: "t", name: "Target" },
      { id: "w", name: "Walmart Supercenter" },
      { id: "x", name: "QT" },
    ];
    expect(matchStore("TARGET T-1234", stores)).toBe("t");
    expect(matchStore("Walmart", stores)).toBe("w");
    expect(matchStore("QT 114", stores)).toBeNull();
    expect(matchStore(null, stores)).toBeNull();
  });
});
