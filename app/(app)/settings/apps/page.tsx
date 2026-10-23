import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getDisabledApps } from "@/lib/app-switches";
import { isAppOn } from "@/lib/apps";
import { PageHeader } from "@/components/page-header";
import { backLink } from "@/components/styles";
import { AppSwitchList } from "./app-switch-list";

export const metadata = { title: "Apps" };

/**
 * Phase 36: Settings → Apps (admins only). A family turns off the apps it doesn't use: gone
 * from the rail, launcher, Home, search, the calendar week and Bunson, for everyone, with
 * their background work paused. Nothing in the app is deleted, so turning one back on brings
 * it all back. Only apps with a switch are listed (the owner's call).
 */
export default async function AppsSettingsPage() {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile)) {
    return <p className="p-4 text-muted-foreground sm:p-6">Only admins can turn apps on and off.</p>;
  }
  const [disabled, outlookConnected] = await Promise.all([
    getDisabledApps(profile.householdId),
    // Only worth mentioning Outlook when the family calendar there is connected.
    prisma.calendarSync.count({ where: { householdId: profile.householdId } }).then((n) => n > 0),
  ]);
  // With Calendar off the Outlook sync is paused, so nothing comes off Outlook either.
  const outlook = outlookConnected && isAppOn(disabled, "calendar");

  return (
    <div className="max-w-2xl p-4 sm:p-6">
      <Link href="/settings" className={backLink}>
        ← Settings
      </Link>
      <PageHeader title="Apps" />
      <p className="mt-2 text-sm text-muted-foreground">
        Turn off what your family doesn&apos;t use. It disappears for everyone, and its background work pauses. Nothing in
        the app is deleted: backups keep it all, and turning it back on brings everything back.
        {outlook && " Events on the family's Outlook calendar are copies: a turned-off app's come off it, and are put back when it's on again."}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">Home, People, Data and Settings are always on, so they aren&apos;t listed.</p>
      <AppSwitchList disabled={disabled} outlook={outlook} />
    </div>
  );
}
