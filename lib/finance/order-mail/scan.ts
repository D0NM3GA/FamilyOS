import { createHash } from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getGraphToken, graphWithToken, type Graph } from "@/lib/graph/client";
import { captureError } from "@/lib/observability";
import { appOn } from "@/lib/app-switches";
import { classify, DIRECT_SENDERS, parseOrder, senderVerified } from "./parse";
import { matchJarOrders, recordOrder, seenHashes } from "./orders";

/**
 * Phase 29: reading one person's order emails into the jar they chose. Their own mailbox,
 * with their own Microsoft token, taken on their own visit to that jar (Graph tokens here are
 * self-only, lib/graph/client.ts), and the work done after the page is sent (after()), like
 * the calendar's automatic sync. Never in the background job and never for anyone else.
 *
 * What's read: only the allowlisted senders (lib/finance/order-mail/parse.ts), filtered by
 * Graph itself, plus a search for the relayed Publix confirmations. A message's body is
 * fetched only when it's an order email we haven't read, and only kept as the parsed order.
 * Nothing from a mail ever goes into a log, an error or Sentry: errors here are fixed text.
 */

const DAY = 86_400_000;
const FIRST_LOOK_BACK_DAYS = 90;
const EVERY_MS = 6 * 3_600_000;
const NOW_GAP_MS = 5 * 60_000;
const LEASE_MS = 5 * 60_000;
const MAX_PAGES = 4;
const MAX_BODIES = 30;
/** Mails read but not used (couldn't be verified or read), remembered so they aren't fetched again. */
const MAX_SKIPPED = 200;
const BUDGET_MS = 45_000;
const GRAPH = "https://graph.microsoft.com/v1.0";

const ERRORS = {
  expired: "Your Microsoft sign-in expired partway through. It'll carry on next time.",
  denied: "Microsoft said no to reading your mail. Sign out and back in, then try again.",
  throttled: "Outlook asked the app to slow down. It'll carry on next time.",
  failed: "Couldn't read your order emails just now. It'll try again next time.",
};

type Message = { id: string; internetMessageId?: string; subject?: string; receivedDateTime: string; from?: { emailAddress?: { address?: string } } };
type Page = { value?: Message[]; "@odata.nextLink"?: string };

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const SELECT = "id,internetMessageId,from,subject,receivedDateTime";

class Stop extends Error {
  constructor(
    readonly reason: keyof typeof ERRORS,
    readonly retryAfter: number | null = null,
  ) {
    super(reason);
  }
}

async function get<T>(graph: Graph, path: string): Promise<T> {
  const res = await graph("GET", path);
  if (res.status === 401) throw new Stop("expired");
  if (res.status === 403) throw new Stop("denied");
  if (res.status === 429 || res.status === 503) throw new Stop("throttled", res.retryAfter);
  if (res.status < 200 || res.status >= 300) throw new Stop("failed");
  return res.json as T;
}

/** A nextLink, back to a path for graphRequest; anything not on Graph itself is refused. */
function nextPath(link: string | undefined): string | null {
  if (!link || !link.startsWith(`${GRAPH}/`)) return null;
  return link.slice(GRAPH.length);
}

export type ScanResult = { found: number; skipped: number; error: string | null };

/**
 * One scan. Re-checks, before anything is written, that the person still has scanning on for
 * this jar and is still in it. The cursor moves past every allowlisted message looked at, so
 * a capped run carries on next time.
 */
export async function runOrderScan(opts: { personId: string; jarId: string; graph: Graph; now?: Date; budgetMs?: number }): Promise<ScanResult> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.budgetMs ?? BUDGET_MS;
  const scan = await prisma.mailOrderScan.findUnique({ where: { personId: opts.personId } });
  const member = await prisma.moneyJarMember.findUnique({ where: { jarId_personId: { jarId: opts.jarId, personId: opts.personId } } });
  if (!scan?.enabled || scan.jarId !== opts.jarId || !member) {
    await prisma.mailOrderScan.updateMany({ where: { personId: opts.personId }, data: { leaseUntil: null } });
    return { found: 0, skipped: 0, error: null };
  }

  const lookBack = new Date(now.getTime() - FIRST_LOOK_BACK_DAYS * DAY);
  const since = scan.cursor ?? lookBack;
  let cursor = scan.cursor;
  const skippedSeen = new Set(scan.skippedHashes);
  const skippedNew: string[] = [];
  let found = 0;
  let skipped = 0;
  let bodies = 0;
  let stop: Stop | null = null;
  const renew = () => prisma.mailOrderScan.updateMany({ where: { personId: opts.personId }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } });

  /** Reads one message if it's an unread order email. False when the run must stop. */
  const read = async (m: Message): Promise<boolean> => {
    const c = classify(m.from?.emailAddress?.address ?? "", m.subject ?? "");
    if (!c) return true;
    const hash = sha(m.internetMessageId || m.id);
    if (skippedSeen.has(hash) || (await seenHashes(prisma, opts.jarId, [hash])).size) return true;
    if (bodies >= MAX_BODIES || Date.now() - started > budget) return false;
    bodies++;
    await renew();
    const full = await get<{ body?: { content?: string }; internetMessageHeaders?: { name: string; value: string }[] }>(
      opts.graph,
      `/me/messages/${encodeURIComponent(m.id)}?$select=body,internetMessageHeaders`,
    );
    const order = senderVerified(full.internetMessageHeaders ?? [], c) ? parseOrder(c, m.subject ?? "", full.body?.content ?? "", new Date(m.receivedDateTime)) : null;
    if (!order) {
      skipped++;
      skippedSeen.add(hash);
      skippedNew.push(hash);
      return true;
    }
    await recordOrder(prisma, opts.jarId, opts.personId, order, hash);
    found++;
    return true;
  };

  try {
    // 1. The direct senders, filtered by Graph, oldest first, from the cursor.
    const filter = `receivedDateTime ge ${since.toISOString()} and (${DIRECT_SENDERS.map((s) => `from/emailAddress/address eq '${s}'`).join(" or ")})`;
    let path: string | null = `/me/messages?${new URLSearchParams({ $filter: filter, $orderby: "receivedDateTime asc", $select: SELECT, $top: "50" })}`;
    let pages = 0;
    outer: while (path && pages < MAX_PAGES) {
      pages++;
      await renew();
      const page: Page = await get<Page>(opts.graph, path);
      for (const m of page.value ?? []) {
        if (!(await read(m))) break outer;
        const at = new Date(m.receivedDateTime);
        if (!cursor || at > cursor) cursor = at;
      }
      path = nextPath(page["@odata.nextLink"]);
    }
    // 2. Relayed senders can't be filtered by address: a short search (by relevance) over
    //    the whole look-back window, not the cursor, so a run capped by step 1 can't skip
    //    past them; the hashes keep it from reading anything twice.
    if (bodies < MAX_BODIES) {
      await renew();
      const page = await get<Page>(opts.graph, `/me/messages?${new URLSearchParams({ $search: '"Publix Order Confirmation"', $select: SELECT, $top: "25" })}`);
      for (const m of page.value ?? []) {
        if (new Date(m.receivedDateTime) < lookBack) continue;
        if (!(await read(m))) break;
      }
    }
  } catch (err) {
    if (err instanceof Stop) stop = err;
    else {
      stop = new Stop("failed");
      // The error's type only: a database or parse error could quote mail text.
      captureError(new Error(`order mail scan failed (person ${opts.personId}): ${err instanceof Error ? err.constructor.name : "unknown"}`));
    }
  }

  await matchJarOrders(prisma, opts.jarId, now).catch(() => captureError(new Error(`order mail matching failed (jar ${opts.jarId})`)));
  const error = stop ? ERRORS[stop.reason] : null;
  await prisma.mailOrderScan.updateMany({
    where: { personId: opts.personId },
    data: {
      cursor,
      lastScanAt: now,
      lastFound: found,
      lastSkipped: skipped,
      lastError: error,
      skippedHashes: [...scan.skippedHashes, ...skippedNew].slice(-MAX_SKIPPED),
      leaseUntil: null,
      retryAfterUntil: stop?.reason === "throttled" ? new Date(now.getTime() + (stop.retryAfter ?? 300) * 1000) : null,
    },
  });
  return { found, skipped, error };
}

/**
 * Starts a scan after the page is sent, when it's this person's own jar scan, it's due (every
 * 6 hours, or "Scan now" after 5 minutes), nothing asked it to back off, and their token
 * won't expire mid-run. The lease and the token are taken here, in the request.
 */
export async function scheduleOrderScan(personId: string, jarId: string, opts: { force: boolean }): Promise<boolean> {
  const now = new Date();
  const scan = await prisma.mailOrderScan.findUnique({ where: { personId }, include: { person: { select: { id: true, authUserId: true, householdId: true } } } });
  if (!scan?.enabled || scan.jarId !== jarId || !scan.person.authUserId) return false;
  // Phase 36: order emails pause while the family has Money turned off.
  if (!(await appOn(scan.person.householdId, "money"))) return false;
  const person = scan.person as { id: string; authUserId: string };
  if (scan.retryAfterUntil && scan.retryAfterUntil > now) return false;
  if (scan.lastScanAt && now.getTime() - scan.lastScanAt.getTime() < (opts.force ? NOW_GAP_MS : EVERY_MS)) return false;
  const account = await prisma.account.findFirst({ where: { userId: person.authUserId, providerId: "microsoft" }, select: { accessTokenExpiresAt: true } });
  // Phase 40.1b: order emails come from a Microsoft mailbox; a passkey sign-in has none.
  if (!account) return false;
  if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() - now.getTime() < 5 * 60_000) return false;
  const { count } = await prisma.mailOrderScan.updateMany({
    where: { personId: person.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (count !== 1) return false;
  let token: string;
  try {
    token = await getGraphToken();
  } catch {
    await prisma.mailOrderScan.updateMany({ where: { personId: person.id }, data: { leaseUntil: null } });
    return false;
  }
  after(async () => {
    try {
      await runOrderScan({ personId: person.id, jarId, graph: graphWithToken(token) });
    } catch {
      captureError(new Error(`order mail scan crashed (person ${person.id})`));
      await prisma.mailOrderScan.updateMany({ where: { personId: person.id }, data: { leaseUntil: null } }).catch(() => {});
    }
  });
  return true;
}
