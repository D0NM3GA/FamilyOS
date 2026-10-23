import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { householdWithAppOn } from "@/lib/app-switches";
import { fetchFeed, type FetchResult } from "./fetch";
import { expandFeed } from "./parse";
import { normalizeFeedUrl } from "./url";

/**
 * Refreshing school calendar feeds (Phase 18.5). A feed is refreshed when someone opens
 * /school or Home and it's over 6 hours old (no background jobs in this app), or when an
 * admin taps Refresh. A lease keeps two visits from refreshing one feed at once. The
 * events cache covers a week back to four months ahead and is replaced wholesale.
 */

const STALE_MS = 6 * 60 * 60_000;
const LEASE_MS = 2 * 60_000;
const PAST_DAYS = 7;
const FUTURE_DAYS = 120;
const CHUNK = 1000;

export const feedAad = (feedId: string) => `schoolfeed:${feedId}`;

const PARSE_ERROR = "The feed couldn't be read as a calendar.";
const TRUNCATED = "The feed is very large; only part of it is shown.";
const UNREADABLE = "The saved feed address can't be read any more. Remove it and add it again.";
const FAILED = "The feed couldn't be updated. It'll try again later.";

type Fetcher = (url: URL, conditional: { etag?: string | null; lastModified?: string | null }) => Promise<FetchResult>;

/**
 * Claims every stale feed of a household (atomically, per feed). Returns the ids won. None
 * while the family has School turned off (Phase 36): the feeds pause until it's back on.
 */
export async function claimStaleFeeds(householdId: string, now = new Date()): Promise<string[]> {
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const candidates = await prisma.schoolFeed.findMany({
    where: {
      householdId,
      household: householdWithAppOn("school"),
      active: true,
      OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: staleBefore } }],
      AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }],
    },
    select: { id: true },
  });
  const won: string[] = [];
  for (const { id } of candidates) {
    const { count } = await prisma.schoolFeed.updateMany({
      where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (count === 1) won.push(id);
  }
  return won;
}

export type RefreshResult = { ok: true; events: number | null } | { ok: false; error: string };

/**
 * Fetches, parses and stores one feed. Expects the caller to hold the lease (or to be an
 * admin's explicit Refresh), and always releases it. Never throws for a feed's own
 * problems: they become fixed-text `lastError`.
 */
export async function refreshFeed(feedId: string, deps: { fetcher?: Fetcher; now?: Date } = {}): Promise<RefreshResult> {
  const now = deps.now ?? new Date();
  const fetcher = deps.fetcher ?? ((url, conditional) => fetchFeed(url, conditional));
  const feed = await prisma.schoolFeed.findUnique({ where: { id: feedId }, include: { household: { select: { timezone: true } } } });
  if (!feed) return { ok: false, error: "Feed not found." };

  const finish = async (data: { lastError: string | null; success: boolean; etag?: string | null; lastModified?: string | null }) => {
    await prisma.schoolFeed.update({
      where: { id: feedId },
      data: {
        leaseUntil: null,
        lastFetchedAt: now,
        lastError: data.lastError,
        ...(data.success ? { lastSuccessAt: now } : {}),
        ...(data.etag !== undefined ? { etag: data.etag, lastModified: data.lastModified ?? null } : {}),
      },
    });
  };

  try {
    let plain: string;
    try {
      plain = decryptSecret(
        { encryptedValue: Buffer.from(feed.encryptedValue), iv: Buffer.from(feed.iv), authTag: Buffer.from(feed.authTag) },
        feedAad(feed.id),
      );
    } catch {
      // A changed encryption key, or a row that was tampered with.
      await finish({ lastError: UNREADABLE, success: false });
      return { ok: false, error: UNREADABLE };
    }
    const url = normalizeFeedUrl(plain);
    if (!url.ok) {
      await finish({ lastError: url.error, success: false });
      return { ok: false, error: url.error };
    }
    // Conditional ("has it changed?") only if the last full fetch is recent: the cache is a
    // window around today, so it has to be rebuilt daily even when the feed hasn't changed.
    const fresh = feed.lastSuccessAt != null && now.getTime() - feed.lastSuccessAt.getTime() < 24 * 60 * 60_000 && feed.lastError == null;
    const fetched = await fetcher(url.url, fresh ? { etag: feed.etag, lastModified: feed.lastModified } : {});
    if (fetched.status === "error") {
      await finish({ lastError: fetched.reason, success: false });
      return { ok: false, error: fetched.reason };
    }
    if (fetched.status === "unchanged") {
      // lastSuccessAt stays at the last full fetch, so tomorrow rebuilds the window.
      await finish({ lastError: null, success: false });
      return { ok: true, events: null };
    }

    let parsed: ReturnType<typeof expandFeed>;
    try {
      parsed = expandFeed(fetched.body, {
        from: new Date(now.getTime() - PAST_DAYS * 86_400_000),
        to: new Date(now.getTime() + FUTURE_DAYS * 86_400_000),
        fallbackZone: feed.household.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch {
      await finish({ lastError: PARSE_ERROR, success: false });
      return { ok: false, error: PARSE_ERROR };
    }

    await prisma.$transaction(async (tx) => {
      await tx.schoolFeedEvent.deleteMany({ where: { feedId } });
      for (let i = 0; i < parsed.events.length; i += CHUNK) {
        await tx.schoolFeedEvent.createMany({ data: parsed.events.slice(i, i + CHUNK).map((e) => ({ feedId, ...e })) });
      }
    });
    await finish({ lastError: parsed.truncated ? TRUNCATED : null, success: true, etag: fetched.etag, lastModified: fetched.lastModified });
    return { ok: true, events: parsed.events.length };
  } catch (err) {
    // Anything unexpected (a database error mid-replace) still counts as this attempt, so
    // the 6-hour wait applies instead of a retry on every page load. Rethrown for Sentry.
    await finish({ lastError: FAILED, success: false }).catch(() => {});
    throw err;
  } finally {
    // Whatever happened above, don't leave the feed locked for the lease's full length.
    await prisma.schoolFeed.updateMany({ where: { id: feedId, leaseUntil: { not: null } }, data: { leaseUntil: null } }).catch(() => {});
  }
}
