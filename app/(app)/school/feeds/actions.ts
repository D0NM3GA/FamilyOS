"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { requireAdmin } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { fetchFeed } from "@/lib/school/feeds/fetch";
import { expandFeed } from "@/lib/school/feeds/parse";
import { feedAad, refreshFeed } from "@/lib/school/feeds/refresh";
import { feedUrlHash, normalizeFeedUrl } from "@/lib/school/feeds/url";
import { findCalendars, FINDER_ERRORS, schoolSiteUrl } from "@/lib/school/feeds/find/finder";
import { openFound, sealFound } from "@/lib/school/feeds/find/bundle";

/**
 * School calendar feeds (Phase 18.5). Admin-only, every action: adding a feed makes the
 * server fetch an address, so it's an admin's call (Fable's scope review).
 */
export type FeedFormState = { error?: string; notice?: string };

function revalidateFeeds() {
  revalidatePath("/school");
  revalidatePath("/school/feeds");
  revalidatePath("/");
}

const nameSchema = z.string().trim().min(1, "Give the feed a name, like \"Lincoln Elementary\"").max(80);

export async function addFeed(_prev: FeedFormState, fd: FormData): Promise<FeedFormState> {
  const admin = await requireAdmin();
  return saveFeed(admin, String(fd.get("name") ?? ""), String(fd.get("url") ?? ""), String(fd.get("kidPersonId") ?? "") || null);
}

/** Adding a feed, pasted or found (Phase 51): checked, tried, stored encrypted with its events. */
async function saveFeed(admin: { householdId: string }, rawName: string, rawUrl: string, kidPersonId: string | null): Promise<FeedFormState> {
  const name = nameSchema.safeParse(rawName);
  if (!name.success) return { error: name.error.issues[0]?.message ?? "Invalid name" };
  const url = normalizeFeedUrl(rawUrl);
  if (!url.ok) return { error: url.error };
  if (kidPersonId) {
    const kid = await prisma.person.findFirst({ where: { id: kidPersonId, householdId: admin.householdId, isHouseholdMember: true }, select: { id: true } });
    if (!kid) return { error: "That family member wasn't found." };
  }
  const urlHash = feedUrlHash(url.url);
  if (await prisma.schoolFeed.findUnique({ where: { householdId_urlHash: { householdId: admin.householdId, urlHash } } })) {
    return { error: "That feed is already added." };
  }

  // Try it before saving, so a wrong link fails here, not silently later.
  const fetched = await fetchFeed(url.url);
  if (fetched.status !== "ok") return { error: fetched.status === "error" ? fetched.reason : "The feed didn't send anything." };
  const household = await prisma.household.findUniqueOrThrow({ where: { id: admin.householdId }, select: { timezone: true } });
  let parsed: ReturnType<typeof expandFeed>;
  const now = new Date();
  try {
    parsed = expandFeed(fetched.body, {
      from: new Date(now.getTime() - 7 * 86_400_000),
      to: new Date(now.getTime() + 120 * 86_400_000),
      fallbackZone: household.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  } catch {
    return { error: "That address didn't return a calendar the app can read." };
  }

  // The id is made here so the URL can be encrypted bound to this very row.
  const id = randomUUID();
  const secret = encryptSecret(url.url.toString(), feedAad(id));
  await prisma.$transaction(async (tx) => {
    await tx.schoolFeed.create({
      data: {
        id,
        householdId: admin.householdId,
        name: name.data,
        kidPersonId,
        encryptedValue: new Uint8Array(secret.encryptedValue),
        iv: new Uint8Array(secret.iv),
        authTag: new Uint8Array(secret.authTag),
        urlHash,
        host: url.url.hostname,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        lastFetchedAt: now,
        lastSuccessAt: now,
      },
    });
    if (parsed.events.length > 0) await tx.schoolFeedEvent.createMany({ data: parsed.events.map((e) => ({ feedId: id, ...e })) });
  });
  revalidateFeeds();
  return { notice: `Added "${name.data}": ${parsed.events.length} event${parsed.events.length === 1 ? "" : "s"} in the next four months.` };
}

export async function refreshFeedNow(feedId: string): Promise<FeedFormState> {
  const admin = await requireAdmin();
  const { count } = await prisma.schoolFeed.updateMany({
    where: { id: feedId, householdId: admin.householdId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    data: { leaseUntil: new Date(Date.now() + 2 * 60_000) },
  });
  if (count === 0) return { notice: "Already refreshing. Check back in a minute." };
  const result = await refreshFeed(feedId).catch(() => ({ ok: false as const, error: "The feed couldn't be updated." }));
  revalidateFeeds();
  if (!result.ok) return { error: result.error };
  return { notice: result.events === null ? "No changes." : `Updated: ${result.events} upcoming.` };
}

export async function removeFeed(feedId: string) {
  const admin = await requireAdmin();
  await prisma.schoolFeed.deleteMany({ where: { id: feedId, householdId: admin.householdId } });
  revalidateFeeds();
}

// ---------- Phase 51: find the calendar from the school's website ----------

export type FindState = {
  error?: string;
  /** "none" and "blocked" say why nothing is listed. */
  outcome?: "found" | "none" | "blocked";
  calendars?: { name: string; host: string; upcoming: number; next: string[] }[];
  /** The found addresses, sealed for this admin (lib/school/feeds/find/bundle.ts). */
  sealed?: string;
};

/**
 * Reads the school's site for calendar feeds and tries each (lib/school/feeds/find). Admin-only,
 * like adding a feed: it makes the server fetch addresses. One search at a time per household (a
 * database lock held for the search, so a second app instance waits its turn too).
 */
export async function findSchoolCalendars(_prev: FindState, fd: FormData): Promise<FindState> {
  const admin = await requireAdmin();
  const site = schoolSiteUrl(String(fd.get("site") ?? ""));
  if (!site) return { error: FINDER_ERRORS.address };
  const household = await prisma.household.findUniqueOrThrow({ where: { id: admin.householdId }, select: { timezone: true } });
  const zone = household.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const result = await prisma
    .$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`schoolfinder:${admin.householdId}`})) AS locked`;
        if (!locked) return "busy" as const;
        return findCalendars(site, { zone });
      },
      { timeout: 45_000, maxWait: 5_000 },
    )
    .catch((err: unknown) => {
      captureError(err);
      return null;
    });
  if (result === "busy") return { error: "A search is already running. Try again in a moment." };
  if (!result) return { error: "The search didn't finish. Try again." };
  if (result.status === "error") return { error: result.reason };
  if (result.status !== "found") return { outcome: result.status };
  return {
    outcome: "found",
    calendars: result.calendars.map(({ name, host, upcoming, next }) => ({ name, host, upcoming, next })),
    sealed: sealFound(
      result.calendars.map((c) => ({ url: c.url.toString(), name: c.name })),
      { householdId: admin.householdId, personId: admin.id },
    ),
  };
}

/** Adds one found calendar: the address comes out of the sealed list, never from the browser. */
export async function addFoundCalendar(_prev: FeedFormState, fd: FormData): Promise<FeedFormState> {
  const admin = await requireAdmin();
  const entry = openFound(String(fd.get("sealed") ?? ""), Number(fd.get("index")), { householdId: admin.householdId, personId: admin.id });
  if (!entry) return { error: "That search has expired. Find the calendars again." };
  return saveFeed(admin, String(fd.get("name") ?? "") || entry.name, entry.url, String(fd.get("kidPersonId") ?? "") || null);
}
