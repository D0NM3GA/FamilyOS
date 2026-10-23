"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { fetchFeed } from "@/lib/school/feeds/fetch";
import { expandFeed } from "@/lib/school/feeds/parse";
import { feedAad, refreshFeed } from "@/lib/school/feeds/refresh";
import { feedUrlHash, normalizeFeedUrl } from "@/lib/school/feeds/url";

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
  const name = nameSchema.safeParse(String(fd.get("name") ?? ""));
  if (!name.success) return { error: name.error.issues[0]?.message ?? "Invalid name" };
  const url = normalizeFeedUrl(String(fd.get("url") ?? ""));
  if (!url.ok) return { error: url.error };
  const kidPersonId = String(fd.get("kidPersonId") ?? "") || null;
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
