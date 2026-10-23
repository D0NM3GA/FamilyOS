"use server";

import { requireActiveProfile } from "@/lib/active-profile";
import { getDisabledApps } from "@/lib/app-switches";
import { markAllRead, recentNotifications, unreadCount } from "@/lib/notifications";

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
  if (items.some((i) => i.unread)) await markAllRead(profile.id, disabled);
  return items;
}

/** The bell's polling read: just the active profile's unread count. */
export async function getUnreadCount() {
  const profile = await requireActiveProfile();
  return unreadCount(profile.id, await getDisabledApps(profile.householdId));
}
