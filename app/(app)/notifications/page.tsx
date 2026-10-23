import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { recentNotifications } from "@/lib/notifications";
import { getDisabledApps } from "@/lib/app-switches";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Notifications" };

/**
 * Everything the bell has said to the active profile (its own inbox only), newest first.
 * Phase 36: not the pings that lead into a turned-off app (back with the app).
 */
export default async function NotificationsPage() {
  const profile = await requireActiveProfile();
  const items = await recentNotifications(profile.id, 100, await getDisabledApps(profile.householdId));

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <PageHeader title="🔔 Notifications" />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">All quiet. Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl bg-card ring-1 ring-border">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.href} className={`flex min-h-11 flex-col justify-center px-4 py-3 text-sm hover:bg-muted ${n.unread ? "font-bold" : ""}`}>
                {n.title}
                <span className="text-xs font-normal text-muted-foreground">{formatDateTime(n.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">The latest 100.</p>
    </div>
  );
}
