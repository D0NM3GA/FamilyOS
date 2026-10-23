import Link from "next/link";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { signInKind } from "@/lib/sign-in-kind";
import { listMyCalendars } from "@/lib/graph/calendar";
import { SubmitButton } from "@/components/submit";
import { backLink, btnPrimary } from "@/components/styles";
import { chooseHomeCalendar } from "./actions";

export const metadata = { title: "Calendar on Home" };

const ERRORS: Record<string, string> = {
  outlook: "Outlook didn't answer just now. Try again in a minute.",
  notYours: "That calendar isn't in your Outlook anymore. Pick another.",
};

/**
 * Phase 45.2: which of your own Outlook calendars Home and Calendar show (a synced family
 * Google Calendar, say), instead of FAMILY_CALENDAR_NAME typed into `.env` to match exactly.
 * Only for the grown-up signed in with Microsoft as themselves.
 */
export default async function CalendarOnHomePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const profile = await requireActiveProfile();
  const { saved, error } = await searchParams;
  const mine = isAdult(profile) && (await isSessionOwner(profile)) && (await signInKind(profile)) === "microsoft";
  const calendars = mine ? await listMyCalendars() : null;
  const fallback = process.env.FAMILY_CALENDAR_NAME?.trim();

  return (
    <div className="max-w-2xl space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/settings" className={backLink}>
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Calendar on Home</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Only changes things for you. Pick which of your Outlook calendars shows on Home and in Calendar, like a family
          calendar synced in from Google. Renaming it in Outlook later is fine.
        </p>
      </div>

      {!mine ? (
        <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground shadow-sm ring-1 ring-border">
          This is for grown-ups who sign in with Microsoft, on their own profile: Outlook shows only your own calendars to you.
        </p>
      ) : !calendars?.ok ? (
        <p role="alert" className="rounded-lg bg-card p-4 text-sm text-destructive shadow-sm ring-1 ring-border">
          {calendars?.error}
        </p>
      ) : (
        <form action={chooseHomeCalendar} className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <fieldset className="space-y-1">
            <legend className="mb-2 text-sm font-medium text-foreground">Show this calendar</legend>
            <label className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted">
              <input type="radio" name="calendarId" value="" defaultChecked={!profile.homeCalendarId} className="size-4" />
              <span className="text-sm text-foreground">
                {fallback ? `The family's usual one (${fallback})` : "Your main Outlook calendar"}
              </span>
            </label>
            {calendars.calendars.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted">
                <input type="radio" name="calendarId" value={c.id} defaultChecked={profile.homeCalendarId === c.id} className="size-4" />
                <span className="text-sm text-foreground">
                  {c.name}
                  {c.isDefault && <span className="text-muted-foreground"> (your main one)</span>}
                </span>
              </label>
            ))}
          </fieldset>
          {profile.homeCalendarId && !calendars.calendars.some((c) => c.id === profile.homeCalendarId) && (
            <p role="alert" className="text-sm text-destructive">The calendar you picked before isn&apos;t in your Outlook anymore. Pick another.</p>
          )}
          {error && ERRORS[error] && <p role="alert" className="text-sm text-destructive">{ERRORS[error]}</p>}
          {saved && <p role="status" className="text-sm text-green-700 dark:text-green-400">Saved. Home shows it from now on.</p>}
          <SubmitButton className={btnPrimary}>Use this calendar</SubmitButton>
        </form>
      )}
    </div>
  );
}
