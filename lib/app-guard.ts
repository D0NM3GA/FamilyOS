import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { appOn } from "@/lib/app-switches";
import { isAdult } from "@/lib/authz";
import { isAdultOnlyApp, type SwitchableAppId } from "@/lib/apps";

/** The apps whose pages start with requireAppOn: the switchable ones, and Data (grown-ups only, no switch). */
export type GuardedAppId = SwitchableAppId | "data";

/**
 * Phase 36: the first line of every page of a switchable app (and its print pages). When the
 * family turned the app off, off to /apps-off/<app>, the friendly "turned off" note, before
 * the page reads or starts anything. A page, not a layout: a layout doesn't stop the page
 * under it from running, and isn't re-rendered when someone already in the app moves around
 * it (Next's authentication guide). lib/app-guard.test.ts checks every page calls it.
 *
 * It also keeps kids out of the grown-up apps (`adultOnly` in lib/apps.ts: Money, Cars with
 * Garage, Data): a kid who types the address lands on Home, the same as if the app weren't
 * there. Hiding them from the nav alone was cosmetic. Their server actions check for an adult
 * themselves (requireAdult, or requireJar for Money); lib/adult-apps.test.ts checks both.
 *
 * Its own file, apart from lib/app-switches.ts, because background jobs import that one and
 * have no request (and no signed-in profile) to redirect.
 */
export async function requireAppOn(app: GuardedAppId) {
  const profile = await requireActiveProfile();
  if (!(await appOn(profile.householdId, app))) redirect(`/apps-off/${app}`);
  if (isAdultOnlyApp(app) && !isAdult(profile)) redirect("/");
  return profile;
}
