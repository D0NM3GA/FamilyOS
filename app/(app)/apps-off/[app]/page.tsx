import { notFound, redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { appOn } from "@/lib/app-switches";
import { APPS, isSwitchableApp } from "@/lib/apps";
import { AppOffCard } from "@/components/app-off";

export const metadata = { title: "Turned off" };

/**
 * Phase 36: where every page of a turned-off app sends you (lib/app-guard.ts), inside the
 * app's shell so the rail and Home are a tap away. Back on by now (another admin, or an old
 * tab)? Straight to the app instead.
 */
export default async function AppOffPage({ params }: { params: Promise<{ app: string }> }) {
  const profile = await requireActiveProfile();
  const { app } = await params;
  const def = isSwitchableApp(app) ? APPS.find((a) => a.id === app) : undefined;
  if (!def) notFound();
  if (await appOn(profile.householdId, def.id)) redirect(def.href);
  return <AppOffCard app={def} isAdmin={isAdmin(profile)} />;
}
