"use server";

import { requireActiveProfile } from "@/lib/active-profile";
import { getDisabledApps } from "@/lib/app-switches";
import { z } from "zod";
import { markRead, NOTIFICATIONS_PAGE_SIZE, recentNotifications, unreadCount } from "@/lib/notifications";

/**
 * Phase 20: opening the bell fetches the latest pings and marks them read in one round
 * trip (so there's no separate "mark all read"). Only ever the active profile's own inbox.
 * No revalidation: the bell zeroes its own badge, and re-rendering the page for it re-ran
 * everything on it (Home's Outlook calls included). Phase 36: pings that lead into a
 * turned-off app aren't listed, counted or marked read.
 */
export async function openBell() {
  const profile = await requireActiveProfile();
  const disabled = await getDisabledApps(profile.householdId);
  const items = await recentNotifications(profile.id, 10, disabled);
  const shown = items.filter((i) => i.unread).map((i) => i.id);
  await markRead(profile.id, shown);
  // More than the bell showed are still unread: the badge keeps counting them.
  return { items, unread: await unreadCount(profile.id, disabled) };
}

const idsSchema = z.array(z.string().min(1).max(64)).max(NOTIFICATIONS_PAGE_SIZE);

/**
 * Phase 60: the Notifications page marks what it showed as read, from the browser once it has
 * rendered (a write during the page's render would race the layout's unread count).
 */
export async function markShownRead(ids: string[]) {
  const profile = await requireActiveProfile();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return;
  await markRead(profile.id, parsed.data);
}

/** The bell's polling read: just the active profile's unread count. */
export async function getUnreadCount() {
  const profile = await requireActiveProfile();
  return unreadCount(profile.id, await getDisabledApps(profile.householdId));
}
