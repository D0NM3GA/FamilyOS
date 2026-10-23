import { getActiveProfile } from "@/lib/active-profile";
import { getDisabledApps } from "@/lib/app-switches";
import { appsOffFor } from "@/lib/apps";
import { isAdult } from "@/lib/authz";
import { getBunsonFacts } from "@/lib/bunson-facts";
import { getFamilyLook } from "@/lib/household-settings";

/**
 * Phase 39: the corner Bunson's real-data lines, fetched by him once he's on screen
 * (components/bunson.tsx) instead of by the (app) layout on every full load. Pages with their
 * own Bunson moment, Home among them, hide the corner one, so there they cost nothing. A plain
 * GET rather than a server action: actions share one queue in the router, so a slow facts
 * lookup would hold up a tap on "Done" made while it ran.
 *
 * The same lines the layout used to send: only for the active profile, only if he's Chatty
 * with them and on for the family, only about the apps that are on (and open to them). getBunsonFacts never
 * throws; anything else is just no facts (he tells jokes).
 */
export async function GET() {
  const profile = await getActiveProfile();
  if (!profile) return Response.json([], { status: 401, headers: { "Cache-Control": "no-store" } });
  let facts: string[] = [];
  if (profile.bunsonVolume === "CHATTY") {
    const [look, disabled] = await Promise.all([getFamilyLook(profile.householdId), getDisabledApps(profile.householdId)]);
    if (look.mascot.on) facts = await getBunsonFacts(profile.householdId, profile, appsOffFor(isAdult(profile), disabled));
  }
  return Response.json(facts, { headers: { "Cache-Control": "private, no-store" } });
}
