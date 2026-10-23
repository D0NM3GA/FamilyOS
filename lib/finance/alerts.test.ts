import { describe, expect, it } from "vitest";
import { alertLabel, billAlert, billIsAlertWorthy, MONEY_CARD, overBudgetAlert, parseTeamsChatLink, syncAlert } from "./alerts";
import { isHiddenFrom, isUnrevealed } from "./gifts";
import type { Recurring } from "./recurring";
import { teamsPayload } from "@/lib/alerts/teams";

const jar = { id: "j1", name: "Family" };
const bill = (over: Partial<Recurring> = {}): Recurring => ({
  key: "netflix",
  label: "PWP*NETFLIX.COM 866-579-7172 CA",
  merchantKey: "netflix",
  cadence: "MONTHLY",
  typicalCents: 1599,
  steady: true,
  lastOn: "2026-09-07",
  nextOn: "2026-10-07",
  count: 3,
  isSubscription: true,
  cardMemo: null,
  stopped: false,
  priceChange: null,
  recentCents: [],
  ...over,
});

describe("money alert text", () => {
  it("labels with the card nickname or a cleaned merchant, never the raw bank text", () => {
    expect(alertLabel(bill())).toBe("Netflix");
    expect(alertLabel(bill({ cardMemo: "Kids' Disney+" }))).toBe("Kids' Disney+");
    expect(alertLabel(bill({ merchantKey: "blue bottle coffee" }))).toBe("Blue Bottle Coffee");
    expect(alertLabel(bill({ merchantKey: "" }))).toBe("A regular charge");
  });

  it("a bill alerts 0-3 days ahead, once per due day, without an amount", () => {
    const a = billAlert(jar, bill(), "2026-10-04", false)!;
    expect(a).toMatchObject({ kind: "MONEY_BILL_DUE", key: "bill:netflix:2026-10-07", href: "/finances/j1/bills" });
    expect(a.title).toBe("🧾 Netflix is due about Oct 7 (Family)");
    expect(a.title).not.toMatch(/\$|15\.99|866/);
    expect(billAlert(jar, bill(), "2026-10-03", false)).toBeNull();
    expect(billAlert(jar, bill(), "2026-10-08", false)).toBeNull();
    expect(billAlert(jar, bill(), "2026-10-07", true)!.title).toContain("meant to cancel");
  });

  it("weekly shops and stopped bills don't alert", () => {
    expect(billIsAlertWorthy(bill({ cadence: "WEEKLY", isSubscription: false }))).toBe(false);
    expect(billIsAlertWorthy(bill({ cadence: "WEEKLY", isSubscription: true }))).toBe(true);
    expect(billIsAlertWorthy(bill({ cadence: "YEARLY", isSubscription: false }))).toBe(true);
    expect(billIsAlertWorthy(bill({ stopped: true }))).toBe(false);
    expect(billIsAlertWorthy(bill({ cadence: null }))).toBe(false);
  });

  it("a sync alert waits a day of failures and is keyed per failure streak", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    const c = { id: "c1", provider: "SIMPLEFIN" as const, lastError: "Reconnect it.", lastSuccessAt: new Date("2026-10-04T13:00:00Z"), createdAt: new Date("2026-01-01") };
    expect(syncAlert(jar, c, now)).toBeNull();
    const a = syncAlert(jar, { ...c, lastSuccessAt: new Date("2026-10-03T08:00:00Z") }, now)!;
    expect(a).toMatchObject({ kind: "MONEY_SYNC_BROKEN", key: "sync:c1:2026-10-03T08:00:00.000Z", href: "/finances/j1/settings" });
    expect(a.title).toBe("⚠️ The bank feed for Family hasn't synced since Oct 3. It may need reconnecting.");
    expect(syncAlert(jar, { ...c, lastError: null, lastSuccessAt: null }, now)).toBeNull();
    expect(syncAlert(jar, { ...c, provider: "PRIVACY", lastSuccessAt: null }, now)!.key).toBe("sync:c1:never");
  });

  it("over budget names the category, once a month", () => {
    expect(overBudgetAlert(jar, { id: "cat1", name: "Dining" }, "2026-10")).toEqual({
      kind: "MONEY_OVER_BUDGET",
      key: "over:cat1:2026-10",
      title: "📊 Dining is over budget this month (Family)",
      href: "/finances/j1/budget",
    });
  });

  it("the Teams card says Money, not the Store", () => {
    const body = JSON.stringify(teamsPayload("a@b.co", "t", "https://x/finances", MONEY_CARD));
    expect(body).toContain("💰 Money");
    expect(body).not.toContain("⭐ Store");
    expect(JSON.stringify(teamsPayload("a@b.co", "t", "l"))).toContain("⭐ Store");
  });
});

describe("surprise visibility", () => {
  const row = { giftHiddenFrom: ["mom"], giftRevealOn: new Date("2026-12-25T00:00:00Z") };
  it("hidden only from the named people, until the reveal day (which shows it)", () => {
    expect(isHiddenFrom(row, "mom", "2026-12-24")).toBe(true);
    expect(isHiddenFrom(row, "mom", "2026-12-25")).toBe(false);
    expect(isHiddenFrom(row, "dad", "2026-12-24")).toBe(false);
    expect(isHiddenFrom({ giftHiddenFrom: [], giftRevealOn: null }, "mom", "2026-12-24")).toBe(false);
    expect(isUnrevealed(row, "2026-12-24")).toBe(true);
    expect(isUnrevealed(row, "2026-12-25")).toBe(false);
  });
});

describe("Phase 30: a jar's Teams chat", () => {
  const ID = "19:4f1c2b3a9d8e7f6a5b4c3d2e1f0a9b8c@thread.v2";
  it("takes the chat id, a chat link or a message link", () => {
    expect(parseTeamsChatLink(ID)).toEqual({ ok: true, chatId: ID });
    expect(parseTeamsChatLink(` https://teams.microsoft.com/l/chat/${encodeURIComponent(ID)}/conversations?context=%7B%7D `)).toEqual({ ok: true, chatId: ID });
    expect(parseTeamsChatLink(`https://teams.microsoft.com/l/message/${encodeURIComponent(ID)}/1712345678901?tenantId=t&groupId=g`)).toEqual({ ok: true, chatId: ID });
  });
  it("refuses one-to-one chats and anything else", () => {
    const oneToOne = parseTeamsChatLink(`https://teams.microsoft.com/l/chat/${encodeURIComponent("19:aaa_bbb@unq.gbl.spaces")}/0`);
    expect(oneToOne.ok).toBe(false);
    expect(!oneToOne.ok && oneToOne.error).toMatch(/one-to-one/);
    for (const bad of ["", "hello", "19:abc@thread.v2", "https://evil.example/l/chat/%E0%A4%A/", "19:abc<script>@thread.v2", `${ID}x`]) {
      expect(parseTeamsChatLink(bad).ok).toBe(false);
    }
  });
  it("puts the chat id in the flow's payload only when there is one", () => {
    expect(teamsPayload("a@b.co", "t", "l", MONEY_CARD, ID)).toMatchObject({ recipient: "a@b.co", chatId: ID });
    expect(teamsPayload("a@b.co", "t", "l", MONEY_CARD)).not.toHaveProperty("chatId");
  });
});
