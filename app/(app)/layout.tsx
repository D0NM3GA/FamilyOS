import { requireActiveProfile } from "@/lib/active-profile";
import { breakGlassStatus, breakGlassTime } from "@/lib/break-glass-notice";
import { getFamilyLook, getHouseholdSettings } from "@/lib/household-settings";
import { followHouseholdZone, processZone } from "@/lib/household-zone";
import { HouseholdZoneProvider } from "@/components/household-zone";
import { Bunson } from "@/components/bunson";
import { isAdult } from "@/lib/authz";
import { unreadCount } from "@/lib/notifications";
import { visibleApps } from "@/lib/apps";
import { getDisabledApps } from "@/lib/app-switches";
import { personColor } from "@/lib/person-color";
import { resolveViewMode } from "@/lib/view-prefs";
import { NavProvider } from "./nav-context";
import { AppLauncher } from "./app-launcher";
import { BottomBar, NavRail } from "./nav-rail";
import { TopBar } from "./top-bar";
import { FamilyLookProvider } from "@/components/family-look";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireActiveProfile();

  // Phase 36: the apps the family turned off leave the rail, launcher and phone bar, and
  // Bunson stops talking about them.
  const disabledApps = getDisabledApps(profile.householdId);
  const settings = getHouseholdSettings(profile.householdId);
  const [household, look, disabled, unread, breakGlass] = await Promise.all([
    settings,
    getFamilyLook(profile.householdId),
    disabledApps,
    // Everyone has a bell: admins get the Store's order alerts (Phase 20), kids hear when a
    // grocery pick was "not this time" (Phase 23).
    disabledApps.then((d) => unreadCount(profile.id, d)),
    // Phase 42.7: the break-glass entrance, said on every page while it's on.
    settings.then((h) => breakGlassStatus(profile.householdId, h.timezone)),
  ]);
  // Phase 49: a string compare, unless another app instance just saved a new zone.
  await followHouseholdZone(household);

  const adult = isAdult(profile);
  const viewMode = resolveViewMode(profile.viewMode, adult);
  // Off for the family (Settings → Make it yours) outranks everyone's own volume.
  const volume = look.mascot.on ? profile.bunsonVolume : "OFF";

  return (
    <HouseholdZoneProvider zone={processZone()}>
    <FamilyLookProvider look={look}>
      <NavProvider
        // Re-mount on profile switch so one person's apps never flash on another's rail.
        key={profile.id}
        personId={profile.id}
        apps={visibleApps(adult, disabled)}
      >
        {/* --bottom-bar-h is set here (not on :root) so only (app) pages offset for the phone
            bottom bar: Bunson's fixed wrapper and the groceries "complete trip" bar read it. */}
        {/* data-view drives the `big:` variant (globals.css); data-bunson-volume gates Bunson's
            moments in pure CSS; data-app-root scopes the one-Bunson-per-screen rule. */}
        {/* Exactly the window's height (h-dvh), so the page never grows past it: the rail stays
            put and scrolls on its own, and only <main> scrolls the page. */}
        <div
          data-app-root
          data-view={viewMode}
          data-bunson-volume={volume}
          className={`flex h-dvh flex-col overflow-hidden [--bottom-bar-h:0px] max-md:pb-[var(--bottom-bar-h)] ${
            viewMode === "BIG" ? "max-md:[--bottom-bar-h:5rem]" : "max-md:[--bottom-bar-h:4.25rem]"
          }`}
        >
          {/* Phase 44.1: the first stop for a keyboard, past the top bar and the app rail. */}
          <a
            href="#main"
            className="sr-only z-50 rounded-xl border-2 border-ink bg-sun px-4 py-2 font-extrabold text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          >
            Skip to content
          </a>
          <TopBar
            personId={profile.id}
            activeName={profile.firstName}
            hasPhoto={profile.photoContentType !== null}
            color={personColor(profile)}
            prefs={{ viewMode, bunsonVolume: profile.bunsonVolume }}
            unread={unread}
          />
          {breakGlass && (
            <p role="alert" className="bg-red-700 px-4 py-2 text-center text-sm font-bold text-white">
              Emergency local access is on until {breakGlassTime(breakGlass.endsAt, household.timezone)}.
              Turn it off on the server once Cloudflare is back.
            </p>
          )}
          <AppLauncher />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <NavRail />
            {/* Focusable (tabIndex 0) because it's what scrolls: a page with nothing to tab to can
                still be scrolled from the keyboard. The skip link lands here too. */}
            <main
              id="main"
              tabIndex={0}
              className="min-w-0 flex-1 overflow-y-auto overscroll-contain bg-muted outline-none focus-visible:ring-4 focus-visible:ring-sun focus-visible:ring-inset"
            >
              {children}
            </main>
          </div>
          <BottomBar />
          {/* The corner nook is Chatty-only; Just cheers keeps only the moments. */}
          {/* Phase 39: he looks up his own facts once he's on screen (app/api/bunson-facts), so
              no page waits on them and pages that hide him don't pay for them. */}
          {volume === "CHATTY" && <Bunson factsUrl="/api/bunson-facts" offApps={disabled} />}
        </div>
      </NavProvider>
    </FamilyLookProvider>
    </HouseholdZoneProvider>
  );
}
