import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getHouseholdMembers } from "@/lib/people";
import { resolveViewMode } from "@/lib/view-prefs";
import { backLink } from "@/components/styles";
import { StartingViews } from "../starting-views";

export const metadata = { title: "Starting views" };

/** Phase 45.3: who starts on Big buttons, moved off the Settings page onto its own. Grown-ups. */
export default async function StartingViewsPage() {
  const profile = await requireActiveProfile();
  if (!isAdult(profile)) redirect("/settings");
  const members = await getHouseholdMembers(profile.householdId);

  return (
    <div className="max-w-2xl space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/settings" className={backLink}>
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Starting views</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What each person sees when they open the app. Big buttons shows just their own chores and rewards, extra large:
          made for younger kids. Anyone can switch their own view later from the menu under their name.
        </p>
      </div>
      <div className="rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <StartingViews
          members={members.map((m) => ({
            id: m.id,
            firstName: m.firstName,
            mode: resolveViewMode(m.viewMode, isAdult(m)),
          }))}
        />
      </div>
    </div>
  );
}
