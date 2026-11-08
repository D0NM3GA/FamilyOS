import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdult } from "@/lib/roles";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAppOn } from "@/lib/app-guard";
import { getHouseholdSettings } from "@/lib/household-settings";
import { formatEventWhen } from "@/lib/format";
import { dayKey, weekStartOf } from "@/lib/calendar/agenda";
import { getDriveTarget } from "@/lib/outlook-copy/drivers";
import { backLink } from "@/components/styles";
import { DriverForm } from "./driver-form";

export const metadata = { title: "Who's driving" };

/**
 * Phase 70b: who's driving to one Outlook event (grown-ups). Opened from the event on the calendar;
 * everyone sees the answer there and on Home. The app keeps it; Outlook never hears of it.
 */
export default async function DrivePage({ searchParams }: { searchParams: Promise<{ c?: string; g?: string }> }) {
  await requireAppOn("calendar");
  const profile = await requireActiveProfile();
  if (!isAdult(profile)) redirect("/calendar");
  const { c, g } = await searchParams;
  const target = typeof c === "string" && typeof g === "string" ? await getDriveTarget(profile, c, g) : null;
  const zone = (await getHouseholdSettings(profile.householdId)).timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const week = target ? dayKey(weekStartOf(target.startsAt)) : "";

  return (
    <div className="max-w-xl space-y-4 p-4 sm:p-6">
      <div>
        <Link href={week ? `/calendar?week=${week}` : "/calendar"} className={backLink}>
          ← Calendar
        </Link>
        <h1 className="text-xl font-semibold text-foreground">{target ? target.title : "Who's driving"}</h1>
        {target && <p className="mt-1 text-sm text-muted-foreground">{formatEventWhen({ startsAt: target.startsAt, endsAt: target.endsAt, allDay: false }, zone)}</p>}
      </div>
      {target ? (
        <DriverForm calendarId={target.calendarId} graphId={target.graphId} week={week} driverId={target.driverId} drivers={target.drivers} />
      ) : (
        <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground shadow-sm ring-1 ring-border">
          That event isn&apos;t on the calendar anymore, or it&apos;s an all-day one (drivers are for events with a time).
        </p>
      )}
    </div>
  );
}
