import Link from "next/link";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { getServerSession } from "@/lib/session";
import { listMySessions } from "@/lib/my-sessions";
import { formatRelative } from "@/lib/format";
import { ConfirmSubmit } from "@/components/submit";
import { btnDanger } from "@/components/styles";
import { signOutDevice, signOutEverywhereElse } from "./actions";

export const metadata = { title: "Where I'm signed in" };

/**
 * Phase 67a: your own sign-in's devices, each with where and when it signed in. Sign out one you
 * don't recognise or lost, or every one but this. Only on your own sign-in: a profile switched to
 * with a PIN isn't the sign-in these belong to.
 */
export default async function MyDevicesPage() {
  const profile = await requireActiveProfile();
  const session = await getServerSession();
  const own = session !== null && (await isSessionOwner(profile));
  const back = (
    <Link href="/settings" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
      ← Settings
    </Link>
  );
  if (!own || !session) {
    return (
      <div className="max-w-3xl space-y-2 p-4 sm:p-6">
        {back}
        <h1 className="text-xl font-semibold text-foreground">Where I&apos;m signed in</h1>
        <p className="text-muted-foreground">This shows the devices of your own sign-in, on your own profile.</p>
      </div>
    );
  }

  const sessions = await listMySessions(session.user.id, session.session.id);
  const others = sessions.filter((s) => !s.current);

  return (
    <div className="max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        {back}
        <h1 className="text-xl font-semibold text-foreground">Where I&apos;m signed in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every device signed in as you. Lost a phone, or see one you don&apos;t know? Sign it out: it needs your sign-in again
          the next time it opens the app.
        </p>
      </div>

      <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <ul className="divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {s.device}
                  {s.current ? " · This device" : ""}
                </p>
                <p className="text-xs text-muted-foreground">Signed in {formatRelative(s.signedInAt).toLowerCase()}</p>
              </div>
              {!s.current && (
                <form action={signOutDevice.bind(null, s.id)}>
                  <ConfirmSubmit
                    question={`Sign out ${s.device}? It needs your sign-in again to open the app.`}
                    yes="Sign it out"
                    aria-label={`Sign out ${s.device}, signed in ${formatRelative(s.signedInAt).toLowerCase()}`}
                    className="inline-flex min-h-11 items-center text-xs font-medium text-destructive hover:text-red-800 dark:hover:text-red-400 sm:min-h-0"
                    yesClassName={btnDanger}
                  >
                    Sign out
                  </ConfirmSubmit>
                </form>
              )}
            </li>
          ))}
        </ul>
        {others.length > 1 && (
          <form action={signOutEverywhereElse} className="border-t border-border pt-3">
            <ConfirmSubmit
              question={`Sign out all ${others.length} other devices? This one stays signed in.`}
              yes="Sign them out"
              className="inline-flex min-h-11 items-center text-sm font-medium text-destructive hover:text-red-800 dark:hover:text-red-400 sm:min-h-0"
              yesClassName={btnDanger}
            >
              Sign out everywhere else
            </ConfirmSubmit>
          </form>
        )}
      </section>
    </div>
  );
}
