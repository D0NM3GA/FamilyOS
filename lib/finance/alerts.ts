import { Prisma } from "@/app/generated/prisma/client";
import type { NotificationKind } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { getAppName } from "@/lib/household-settings";
import { householdWithAppOn } from "@/lib/app-switches";
import { deliverNotifications, storeLink } from "@/lib/alerts/dispatch";
import { teamsActivity, type TeamsCard } from "@/lib/alerts/teams";
import { familyTeamsAppId } from "@/lib/teams/family-app";
import { ensureInChat, sendToChat, TeamsError } from "@/lib/teams/microsoft";
import { eligibleMemberWhere } from "./access";
import { budgetMonth, monthRange, todayCivil } from "./budget";
import { daysBetween, findRecurring, isRegularBill, paidCheck, RECURRING_WINDOW_DAYS, type Recurring } from "./recurring";
import { nextDueOn, ownKeys, readManualBills, standsFor, type ManualBillInput } from "./manual-bills";
import { withCarry, type RolloverCategory } from "./envelope";
import { forecast, type Forecast } from "./forecast";
import { isHiddenFrom, isUnrevealed } from "./gifts";

/**
 * Phase 27: money alerts, run by the background jobs (lib/finance/jobs.ts). Each jar member
 * has their own switches (MoneyJarMember.alert*), and each is worked out with what THAT
 * member may see, so a surprise hidden from them never shows up in their alert. Only current
 * household adults with their own sign-in get them (the people who can open a
 * jar): someone removed from the family keeps no alerts.
 *
 * Titles go off the box (Teams, phone), so they carry no amounts and no raw bank text: the
 * jar's name, a category name, or a cleaned merchant name (the Privacy card's nickname, or
 * the normalized merchant key). Each alert is sent once per member (FinAlertSent).
 *
 * Phase 30: a jar can send its alerts to one Teams group chat (MoneyJar.teamsChatId). The chat
 * gets only what everyone in the jar can see: alerts worked out from charges that aren't a
 * surprise for anyone, every kind any member has switched on, once (JarChatAlertSent). Each
 * member still gets their bell and phone; an alert only they can see (it involves a surprise
 * they set up) still goes to their own Teams chat.
 *
 * Bills added by hand (lib/finance/manual-bills.ts) are bill alerts and part of the low-balance
 * check like found ones; a found bill one of them stands for is alerted once, as that one.
 */

export const MONEY_CARD: TeamsCard = { heading: "💰 Money", linkText: "Open Money" };

const DUE_WITHIN_DAYS = 3;
const SYNC_QUIET_HOURS = 24;
const HOUR = 3_600_000;

export type MoneyAlert = { kind: NotificationKind; key: string; title: string; href: string };

const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "netflix" → "Netflix", "blue bottle coffee" → "Blue Bottle Coffee". */
export function alertLabel(r: Pick<Recurring, "cardMemo" | "merchantKey">): string {
  const memo = r.cardMemo?.trim();
  if (memo) return memo.slice(0, 40);
  const key = r.merchantKey && r.merchantKey !== "-" ? r.merchantKey : "";
  if (!key) return "A regular charge";
  return key.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 40);
}

/** Bills worth a heads-up (lib/finance/recurring.ts isRegularBill). */
export const billIsAlertWorthy = isRegularBill;

/** How recent a price rise must be to tell people (an old one found on a first sync isn't news). */
const PRICE_NEWS_DAYS = 45;

/** Phase 31: a regular bill now costs more. Once per new price; never says how much. */
export function priceUpAlert(jar: { id: string; name: string }, r: Recurring, today: string): MoneyAlert | null {
  const p = r.priceChange;
  if (!p || p.toCents <= p.fromCents || !isRegularBill(r)) return null;
  // Aged from the charge that confirmed it: a quarterly bill confirms a rise ~3 months after it started.
  if (daysBetween(p.confirmedOn, today) > PRICE_NEWS_DAYS) return null;
  return {
    kind: "MONEY_PRICE_UP",
    key: `price:${r.key}:${p.sinceOn}`,
    title: `📈 ${alertLabel(r)} costs more than it used to (${jar.name})`,
    href: `/finances/${jar.id}/bills`,
  };
}

export function billAlert(jar: { id: string; name: string }, r: Recurring, today: string, cancelling: boolean): MoneyAlert | null {
  if (!billIsAlertWorthy(r)) return null;
  const until = daysBetween(today, r.nextOn!);
  if (until < 0 || until > DUE_WITHIN_DAYS) return null;
  const label = alertLabel(r);
  return {
    kind: "MONEY_BILL_DUE",
    key: `bill:${r.key}:${r.nextOn}`,
    title: cancelling
      ? `🛑 ${label} is due about ${shortDay(r.nextOn!)} and you meant to cancel it (${jar.name})`
      : `🧾 ${label} is due about ${shortDay(r.nextOn!)} (${jar.name})`,
    href: `/finances/${jar.id}/bills`,
  };
}

/** A bill added by hand (lib/finance/manual-bills.ts) is due within 3 days. Its name is the family's own words. */
export function manualBillAlert(jar: { id: string; name: string }, bill: Pick<ManualBillInput, "id" | "name">, due: string | null, today: string): MoneyAlert | null {
  if (!due) return null;
  const until = daysBetween(today, due);
  if (until < 0 || until > DUE_WITHIN_DAYS) return null;
  return {
    kind: "MONEY_BILL_DUE",
    key: `bill:manual:${bill.id}:${due}`,
    title: `🧾 ${bill.name.slice(0, 40)} is due ${shortDay(due)} (${jar.name})`,
    href: `/finances/${jar.id}/bills`,
  };
}

export function syncAlert(
  jar: { id: string; name: string },
  c: { id: string; provider: "SIMPLEFIN" | "PRIVACY"; lastError: string | null; lastSuccessAt: Date | null; createdAt: Date },
  now: Date,
): MoneyAlert | null {
  if (!c.lastError) return null;
  const since = c.lastSuccessAt ?? c.createdAt;
  if (now.getTime() - since.getTime() < SYNC_QUIET_HOURS * HOUR) return null;
  const what = c.provider === "PRIVACY" ? "Privacy.com" : "The bank feed";
  const when = c.lastSuccessAt ? `since ${shortDay(c.lastSuccessAt.toISOString().slice(0, 10))}` : "yet";
  return {
    kind: "MONEY_SYNC_BROKEN",
    // One alert per failure streak: a success moves lastSuccessAt, so the next streak is new.
    key: `sync:${c.id}:${c.lastSuccessAt?.toISOString() ?? "never"}`,
    title: `⚠️ ${what} for ${jar.name} hasn't synced ${when}. It may need reconnecting.`,
    href: `/finances/${jar.id}/settings`,
  };
}

export function overBudgetAlert(jar: { id: string; name: string }, category: { id: string; name: string }, month: string): MoneyAlert {
  return {
    kind: "MONEY_OVER_BUDGET",
    key: `over:${category.id}:${month}`,
    title: `📊 ${category.name} is over budget this month (${jar.name})`,
    href: `/finances/${jar.id}/budget`,
  };
}

/** A balance older than this (a broken feed) is too stale to warn about. */
const FRESH_BALANCE_HOURS = 48;

/**
 * Phase 32: Safe to spend dips under the cushion (or below zero) before payday. Only with a
 * payday (its day is the key, so once per pay period) and a fresh balance; never an amount.
 */
export function lowBalanceAlert(jar: { id: string; name: string }, f: Forecast, now: Date, feedBroken: boolean): MoneyAlert | null {
  if (!f.ready || !f.payday || feedBroken) return null;
  if (now.getTime() - f.asOf.getTime() > FRESH_BALANCE_HOURS * HOUR) return null;
  if (f.lowest.cents >= f.cushionCents) return null;
  return {
    kind: "MONEY_LOW_BALANCE",
    // The last paycheck names the pay period: a payday running a day or two late (nextOn moves
    // to today) is still the same period.
    key: `low:${f.payday.lastOn}`,
    title: `⚠️ ${jar.name} may run low before payday (around ${shortDay(f.lowest.on)})`,
    href: `/finances/${jar.id}/bills`,
  };
}

type Deliver = typeof deliverNotifications;

export type PostChat = (teamsAppId: string, chatId: string, title: string, link: string) => Promise<void>;

/**
 * Phase 50: posts in the jar's group chat through the family's Teams app. When Teams says the app
 * isn't in the chat anymore (someone removed it), it's added back and the post tried once more.
 */
const defaultPostChat: PostChat = async (teamsAppId, chatId, title, link) => {
  const activity = teamsActivity(title, link, MONEY_CARD);
  try {
    await sendToChat(chatId, activity);
  } catch (err) {
    if (!(err instanceof TeamsError) || err.kind !== "gone") throw err;
    await ensureInChat(chatId, teamsAppId);
    await sendToChat(chatId, activity);
  }
};

/**
 * Works out and sends every jar's alerts. Never throws; returns how many were sent. Not for
 * a family with Money turned off (Phase 36): nothing is sent, and nothing is marked sent, so
 * what's still true when it's back on is said then.
 */
export async function evaluateMoneyAlerts(now: Date = new Date(), deliver: Deliver = deliverNotifications, postChat: PostChat = defaultPostChat): Promise<number> {
  let sent = 0;
  const jars = await prisma.moneyJar.findMany({
    where: { household: householdWithAppOn("money") },
    select: { id: true, name: true, householdId: true, teamsChatId: true, cushionCents: true },
  });
  for (const jar of jars) {
    try {
      sent += await evaluateJar(jar, now, deliver, postChat);
    } catch (err) {
      // The jar id and the error's type only: never amounts or names.
      captureError(new Error(`money alerts failed (jar ${jar.id}): ${err instanceof Error ? err.constructor.name : "unknown"}`));
    }
  }
  return sent;
}

type Switches = { alertBills: boolean; alertSync: boolean; alertOverBudget: boolean; alertLowBalance: boolean };

async function evaluateJar(
  jar: { id: string; name: string; householdId: string; teamsChatId: string | null; cushionCents: number | null },
  now: Date,
  deliver: Deliver,
  postChat: PostChat,
): Promise<number> {
  const members = await prisma.moneyJarMember.findMany({
    where: { jarId: jar.id, person: eligibleMemberWhere(jar.householdId), OR: [{ alertBills: true }, { alertSync: true }, { alertOverBudget: true }, { alertLowBalance: true }] },
    select: { personId: true, alertBills: true, alertSync: true, alertOverBudget: true, alertLowBalance: true, person: { select: { authUser: { select: { email: true } } } } },
    orderBy: { personId: "asc" },
  });
  if (members.length === 0) return 0;
  const today = todayCivil(now);
  const month = today.slice(0, 7);
  const wantsRows = members.some((m) => m.alertBills || m.alertOverBudget || m.alertLowBalance);

  const [connections, rows, marks, categories, accounts, manual] = await Promise.all([
    prisma.jarConnection.findMany({ where: { jarId: jar.id }, select: { id: true, provider: true, lastError: true, lastSuccessAt: true, createdAt: true } }),
    wantsRows
      ? prisma.finTransaction.findMany({
          where: {
            jarId: jar.id,
            state: "ACTIVE",
            account: { currency: "USD" },
            postedOn: { gte: new Date(Date.parse(`${today}T00:00:00Z`) - RECURRING_WINDOW_DAYS * 86_400_000), lt: monthRange(month).lt },
          },
          orderBy: { postedOn: "asc" },
          select: {
            merchantKey: true,
            merchantName: true,
            payee: true,
            description: true,
            postedOn: true,
            amountCents: true,
            pending: true,
            accountId: true,
            privacyCardMemo: true,
            categoryId: true,
            giftHiddenFrom: true,
            giftRevealOn: true,
            category: { select: { key: true, absorbedKeys: true, kind: true } },
            privacyCharges: { select: { cardToken: true }, take: 1 },
          },
        })
      : Promise.resolve([]),
    prisma.recurringMark.findMany({ where: { jarId: jar.id }, select: { key: true, status: true } }),
    prisma.finCategory.findMany({ where: { jarId: jar.id }, select: { id: true, key: true, name: true, emoji: true, kind: true, budgetCents: true, rollover: true, rolloverFrom: true } }),
    prisma.finAccount.findMany({
      where: { jarId: jar.id, currency: "USD" },
      select: { id: true, name: true, spending: true, balanceCents: true, availableCents: true, balanceAt: true },
    }),
    readManualBills(prisma, jar.id),
  ]);
  const markOf = new Map(marks.map((m) => [m.key, m.status]));
  const feedBroken = connections.some((c) => c.provider === "SIMPLEFIN" && c.lastError);
  const recurringRow = (r: (typeof rows)[number]) => ({
    key: r.merchantKey === "-" ? "" : r.merchantKey,
    label: r.merchantName ?? r.payee ?? r.description,
    postedOn: r.postedOn.toISOString().slice(0, 10),
    amountCents: r.amountCents,
    privacyCardToken: r.privacyCharges[0]?.cardToken ?? null,
    privacyCardMemo: r.privacyCardMemo,
    category: r.category,
    pending: r.pending,
  });

  /** The alerts these switches ask for, worked out from these rows. */
  const alertsFrom = (visible: typeof rows, m: Switches): MoneyAlert[] => {
    const alerts: MoneyAlert[] = [];
    if (m.alertSync) {
      for (const c of connections) {
        const a = syncAlert(jar, c, now);
        if (a) alerts.push(a);
      }
    }
    if (m.alertBills) {
      const outRows = visible.filter((r) => r.amountCents < 0).map(recurringRow);
      const found = findRecurring(outRows, today);
      // A found bill a hand-added one stands for is due-alerted once, as the hand-added one.
      const replaced = standsFor(manual, found);
      for (const f of found) {
        const status = markOf.get(f.key);
        if (status === "HIDDEN") continue;
        const a = replaced.has(f.key) ? null : billAlert(jar, f, today, status === "CANCEL");
        if (a) alerts.push(a);
        const up = priceUpAlert(jar, f, today);
        if (up) alerts.push(up);
      }
      const paid = paidCheck(outRows, new Set(found.map((f) => f.key)), today);
      for (const b of manual) {
        const a = manualBillAlert(jar, b, nextDueOn(b, today, (d) => paid(ownKeys(b, found), d, b.amountCents, true)), today);
        if (a) alerts.push(a);
      }
    }
    if (m.alertLowBalance && accounts.some((a) => a.spending)) {
      const f = forecast({
        accounts,
        rows: visible.map((r) => ({ ...recurringRow(r), accountId: r.accountId })),
        statusOf: markOf,
        today,
        cushionCents: jar.cushionCents,
        manualBills: manual,
      });
      const a = lowBalanceAlert(jar, f, now, feedBroken);
      if (a) alerts.push(a);
    }
    if (m.alertOverBudget) {
      const budgetRows = visible.map((r) => ({ amountCents: r.amountCents, postedOn: r.postedOn.toISOString().slice(0, 10), pending: r.pending, categoryId: r.categoryId }));
      // Phase 31: a rollover category is over only past budget + what earlier months left.
      const summary = budgetMonth(budgetRows, withCarry(categories as RolloverCategory[], budgetRows, month), month, today);
      for (const line of summary.lines) if (line.status === "OVER") alerts.push(overBudgetAlert(jar, line.category, month));
    }
    return alerts;
  };

  // Phase 30: the shared chat, when the jar has one and the family's Teams app is published.
  let teamsAppId: string | null = null;
  if (jar.teamsChatId) {
    teamsAppId = await familyTeamsAppId(jar.householdId);
    // Without the family's Teams app the chat can't be reached: everyone gets their own Teams as before.
    if (!teamsAppId) await prisma.moneyJar.update({ where: { id: jar.id }, data: { teamsChatError: "The family's Teams app isn't set up (Settings → Alerts)." } });
  }
  const shared =
    jar.teamsChatId && teamsAppId
      ? alertsFrom(
          rows.filter((r) => !isUnrevealed(r, today)),
          {
            alertBills: members.some((m) => m.alertBills),
            alertSync: members.some((m) => m.alertSync),
            alertOverBudget: members.some((m) => m.alertOverBudget),
            alertLowBalance: members.some((m) => m.alertLowBalance),
          },
        )
      : [];
  const sharedKeys = new Set(shared.map((a) => a.key));

  const personal: string[] = [];
  const quiet: string[] = [];
  for (const m of members) {
    for (const a of alertsFrom(rows.filter((r) => !isHiddenFrom(r, m.personId, today)), m)) {
      const id = await claimAndRecord(jar, m.personId, a);
      if (id) (sharedKeys.has(a.key) ? quiet : personal).push(id);
    }
  }
  if (personal.length) await deliver({ id: { in: personal } }, { channels: "teams-first", card: MONEY_CARD });
  if (quiet.length) await deliver({ id: { in: quiet } }, { channels: "push-only", card: MONEY_CARD });

  let posted = 0;
  if (shared.length && jar.teamsChatId && teamsAppId) {
    let error: string | null = null;
    let tried = 0;
    for (const a of shared) {
      if (!(await claimChat(jar.id, a.key))) continue;
      tried++;
      try {
        await postChat(teamsAppId, jar.teamsChatId, a.title, storeLink(a.href));
        posted++;
      } catch (err) {
        // The Teams calls throw fixed text only. Let the claim go so the next run tries again: a
        // late alert in the chat beats none (everyone's own copy already went push-only).
        error = err instanceof Error ? err.message : "Couldn't reach Teams.";
        await prisma.jarChatAlertSent.deleteMany({ where: { jarId: jar.id, key: a.key } });
      }
    }
    if (tried) await prisma.moneyJar.update({ where: { id: jar.id }, data: { teamsChatError: error } });
  }
  return personal.length + quiet.length + posted;
}

/** Claims one alert for the jar's chat: false when it was already posted. */
async function claimChat(jarId: string, key: string): Promise<boolean> {
  try {
    await prisma.jarChatAlertSent.create({ data: { jarId, key } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

/** "Send a test" to the jar's chat. Returns fixed text on failure, null when Teams took it. */
export async function sendJarChatTest(jarId: string, post: PostChat = defaultPostChat): Promise<string | null> {
  const jar = await prisma.moneyJar.findUnique({ where: { id: jarId }, select: { name: true, householdId: true, teamsChatId: true } });
  if (!jar?.teamsChatId) return "Choose the chat first.";
  const teamsAppId = await familyTeamsAppId(jar.householdId);
  if (!teamsAppId) return "Teams isn't set up for the family yet (Settings → Alerts).";
  const appName = await getAppName(jar.householdId);
  try {
    await post(teamsAppId, jar.teamsChatId, `Test from ${appName}: money alerts for ${jar.name} will show up here. 💰`, storeLink(`/finances/${jarId}`));
    await prisma.moneyJar.update({ where: { id: jarId }, data: { teamsChatError: null } });
    return null;
  } catch (err) {
    const error = err instanceof Error ? err.message : "Couldn't reach Teams.";
    await prisma.moneyJar.update({ where: { id: jarId }, data: { teamsChatError: error } });
    return error;
  }
}

/** The sent-marker and the bell notification together, so a crash can't lose or double one. */
async function claimAndRecord(jar: { id: string; householdId: string }, personId: string, a: MoneyAlert): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.finAlertSent.create({ data: { jarId: jar.id, personId, key: a.key } });
      const n = await tx.notification.create({
        data: { householdId: jar.householdId, recipientId: personId, kind: a.kind, title: a.title, href: a.href },
        select: { id: true },
      });
      return n.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}
