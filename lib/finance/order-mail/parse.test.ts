import { describe, expect, it } from "vitest";
import { civilDay, classify, decodeSender, htmlToText, parseOrder, senderVerified } from "./parse";
import { AMAZON, APPLE, PUBLIX } from "./fixtures";
import { matchOrders } from "./orders";

/**
 * Phase 29. The fixtures are SYNTHETIC: made-up people, addresses and numbers laid out the
 * way the real retailers' mails are (tables, a hidden preheader, Amazon's right-to-left
 * mark around the order number, Apple's hidden mobile copy, Publix's relay sender).
 */

const RECEIVED = new Date("2026-10-05T18:14:31Z");

describe("who sent it", () => {
  it("decodes an addy.io relay to the real sender, and leaves other addresses alone", () => {
    expect(decodeSender("made-up.alias42+NoReply.Publix=publix.com@mailer.me")).toEqual({ address: "noreply.publix@publix.com", relay: "mailer.me" });
    expect(decodeSender("Auto-Confirm@Amazon.com")).toEqual({ address: "auto-confirm@amazon.com", relay: null });
    expect(decodeSender("someone@mailer.me")).toEqual({ address: "someone@mailer.me", relay: null });
  });

  it("only the allowlisted order mails are read; everything else is never opened", () => {
    expect(classify("auto-confirm@amazon.com", "Ordered 1 item: Floor Care")).toMatchObject({ retailer: "AMAZON" });
    expect(classify("auto-confirm@amazon.com", "Ordered: \"Desk Lamp\" and 2 more items")).toMatchObject({ retailer: "AMAZON" });
    expect(classify("shipment-tracking@amazon.com", "Shipped: Floor Care")).toBeNull();
    expect(classify("auto-confirm@amazon.com", "Your Amazon order has shipped")).toBeNull();
    expect(classify("no_reply@email.apple.com", "Your receipt from Apple.")).toMatchObject({ retailer: "APPLE" });
    expect(classify("no_reply@email.apple.com", "Your recent download with your Apple Account")).toBeNull();
    expect(classify("made-up.alias42+NoReply.Publix=publix.com@mailer.me", "Your Publix Order Confirmation")).toMatchObject({ retailer: "PUBLIX", relay: "mailer.me" });
    expect(classify("deals@publix.com", "Your Publix Order Confirmation")).toBeNull();
  });

  it("the mail server must have authenticated the sender's domain (or the relay's)", () => {
    const amazon = classify("auto-confirm@amazon.com", "Ordered 1 item: X")!;
    const pass = [{ name: "Authentication-Results", value: "spf=pass smtp.mailfrom=amazonses.com; dkim=pass header.d=amazon.com;dmarc=pass action=none header.from=amazon.com;compauth=pass reason=100" }];
    expect(senderVerified(pass, amazon)).toBe(true);
    expect(senderVerified([{ name: "Authentication-Results", value: "dmarc=fail action=quarantine header.from=amazon.com;compauth=fail" }], amazon)).toBe(false);
    expect(senderVerified([{ name: "Authentication-Results", value: "dmarc=pass header.from=evil-amazon.com" }], amazon)).toBe(false);
    expect(senderVerified([], amazon)).toBe(false);
    // Only the receiving server's own (topmost) header counts: a forged "pass" below it doesn't.
    const forged = { name: "Authentication-Results", value: "dmarc=pass header.from=amazon.com" };
    const real = { name: "Authentication-Results", value: "spf=fail; dmarc=fail action=quarantine header.from=amazon.com;compauth=fail reason=000" };
    expect(senderVerified([real, forged], amazon)).toBe(false);
    const apple = classify("no_reply@email.apple.com", "Your receipt from Apple.")!;
    expect(senderVerified([{ name: "authentication-results", value: "dmarc=pass header.from=email.apple.com" }], apple)).toBe(true);
    const publix = classify("a+NoReply.Publix=publix.com@mailer.me", "Your Publix Order Confirmation")!;
    expect(senderVerified([{ name: "Authentication-Results", value: "dmarc=pass header.from=mailer.me" }], publix)).toBe(true);
    expect(senderVerified([{ name: "Authentication-Results", value: "dmarc=pass header.from=publix.com" }], publix)).toBe(false);
  });
});

describe("reading it", () => {
  it("HTML to lines: hidden marks gone, Apple's hidden copy cut, entities decoded", () => {
    const lines = htmlToText(AMAZON);
    expect(lines).toContain("Order # 111-1234567-7654321");
    expect(lines.join("\n")).not.toMatch(/[\u202B\u034F\u00AD\u200C]/);
    expect(htmlToText(APPLE).filter((l) => l === "MX9EXAMPLE")).toHaveLength(1);
    expect(htmlToText("<p>Tom &amp; Jerry&#39;s &copy;</p>")).toEqual(["Tom & Jerry's ©"]);
  });

  it("civil days from the retailers' date styles", () => {
    expect(civilDay("Aug 25, 2026")).toBe("2026-08-25");
    expect(civilDay("October 5, 2025 at 1:45 PM")).toBe("2025-10-05");
    expect(civilDay("soon")).toBeNull();
  });

  it("Amazon: order number, category, Grand Total (no item names any more)", () => {
    const o = parseOrder(classify("auto-confirm@amazon.com", "Ordered 1 item: Floor Care")!, "Ordered 1 item: Floor Care", AMAZON, RECEIVED);
    expect(o).toEqual({ retailer: "AMAZON", orderNumber: "111-1234567-7654321", orderedOn: "2026-10-05", totalCents: 1573, label: "Floor Care", items: [] });
  });

  it("Apple: order id, date, each item with its price, total, once", () => {
    const o = parseOrder(classify("no_reply@email.apple.com", "Your receipt from Apple.")!, "Your receipt from Apple.", APPLE, RECEIVED);
    expect(o).toEqual({
      retailer: "APPLE",
      orderNumber: "MX9EXAMPLE",
      orderedOn: "2026-08-25",
      totalCents: 1496,
      label: "Block Game",
      items: [
        { name: "Block Game — SEASON PASS", qty: 1, priceCents: 899 },
        { name: "Block Game — PASS PLUS UPGRADE", qty: 1, priceCents: 499 },
      ],
    });
  });

  it("Publix: order number, pickup day, items with quantities, estimated total", () => {
    const c = classify("made-up.alias42+NoReply.Publix=publix.com@mailer.me", "Your Publix Order Confirmation")!;
    expect(parseOrder(c, "Your Publix Order Confirmation", PUBLIX, RECEIVED)).toEqual({
      retailer: "PUBLIX",
      orderNumber: "1234-P0001",
      orderedOn: "2025-10-25",
      totalCents: 3097,
      label: null,
      items: [
        { name: "Example® Chicken Sub Whole Hot", qty: 1, priceCents: 1099 },
        { name: "Example® Italian Whole Sub", qty: 2, priceCents: 1998 },
      ],
    });
  });

  it("Amazon's other subject style gives a clean label", () => {
    const subject = "Ordered: \"Desk Lamp, Brass\" and 2 more items";
    expect(parseOrder(classify("auto-confirm@amazon.com", subject)!, subject, AMAZON, RECEIVED)?.label).toBe("Desk Lamp, Brass");
  });

  it("anything unexpected reads as nothing, never an error", () => {
    const c = classify("auto-confirm@amazon.com", "Ordered 1 item: X")!;
    expect(parseOrder(c, "Ordered 1 item: X", "<p>hello</p>", RECEIVED)).toBeNull();
    expect(parseOrder(c, "Ordered 1 item: X", "<".repeat(600_000), RECEIVED)).toBeNull();
  });
});

describe("matching orders to charges", () => {
  const order = (id: string, retailer: "AMAZON" | "APPLE" | "PUBLIX", orderedOn: string, totalCents: number | null) => ({ id, retailer, orderedOn, totalCents });
  const txn = (id: string, postedOn: string, amountCents: number, text: string) => ({ id, postedOn, amountCents, text });

  it("exact total, the retailer's name, inside its window; one-to-one", () => {
    expect(matchOrders([order("o1", "AMAZON", "2026-10-05", 1573)], [txn("t1", "2026-10-07", -1573, "amazon AMZN Mktp US")])).toEqual([["o1", "t1"]]);
    // Wrong amount, wrong merchant, too late: no.
    expect(matchOrders([order("o1", "AMAZON", "2026-10-05", 1573)], [txn("t1", "2026-10-07", -1574, "amazon")])).toEqual([]);
    expect(matchOrders([order("o1", "AMAZON", "2026-10-05", 1573)], [txn("t1", "2026-10-07", -1573, "target")])).toEqual([]);
    expect(matchOrders([order("o1", "APPLE", "2026-08-25", 1398)], [txn("t1", "2026-09-02", -1398, "apple.com/bill")])).toEqual([]);
    // Amazon ships (and charges) up to three weeks later.
    expect(matchOrders([order("o1", "AMAZON", "2026-10-05", 999)], [txn("t1", "2026-10-25", -999, "amzn mktp")])).toEqual([["o1", "t1"]]);
  });

  it("Publix is paid at the register: within 15%, pickup day or the next", () => {
    expect(matchOrders([order("o1", "PUBLIX", "2025-10-25", 3097)], [txn("t1", "2025-10-25", -3350, "PUBLIX #1234")])).toEqual([["o1", "t1"]]);
    expect(matchOrders([order("o1", "PUBLIX", "2025-10-25", 3097)], [txn("t1", "2025-10-25", -3700, "PUBLIX #1234")])).toEqual([]);
  });

  it("ties and contested charges are left for a person; no total, no match", () => {
    expect(matchOrders([order("o1", "AMAZON", "2026-10-05", 500)], [txn("t1", "2026-10-06", -500, "amazon"), txn("t2", "2026-10-04", -500, "amazon")])).toEqual([]);
    expect(matchOrders([order("o1", "AMAZON", "2026-10-05", 500), order("o2", "AMAZON", "2026-10-05", 500)], [txn("t1", "2026-10-06", -500, "amazon")])).toEqual([]);
    expect(matchOrders([order("o1", "AMAZON", "2026-10-05", null)], [txn("t1", "2026-10-06", -500, "amazon")])).toEqual([]);
  });
});
