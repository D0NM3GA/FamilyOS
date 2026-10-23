import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { moneyViewer } from "@/lib/finance/access";
import { backupSignInState, requireActiveProfile } from "@/lib/active-profile";
import { SignInAgain } from "@/components/sign-in-again";
import { todayCivil } from "@/lib/finance/budget";
import { visibleIssueWhere } from "@/lib/finance/gifts";
import { createJar } from "./actions";
import { ActionForm, Submit } from "./forms";
import { btn, field } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Money" };

/**
 * Phase 25: "Your jars". Only the jars the person is in, and only when they're using
 * the app as themselves (their own sign-in). Being an admin shows nothing extra.
 * Phase 28: your own copy of your jars (POST /api/backup/my-money), after a fresh sign-in.
 */
export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ stepup?: string }> }) {
  await requireAppOn("money");
  const viewer = await moneyViewer();
  const stepup = (await searchParams).stepup;
  if (!viewer) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-4xl font-extrabold">💰 Money</h1>
        <p className="mt-3 text-muted-foreground">
          Money opens only for grown-ups using the app as themselves, on their own sign-in (not a profile switched to on
          someone else&apos;s sign-in). Each jar is private to its members.
        </p>
      </div>
    );
  }

  const jars = await prisma.moneyJar.findMany({
    where: { householdId: viewer.householdId, members: { some: { personId: viewer.id } } },
    select: {
      id: true,
      name: true,
      emoji: true,
      _count: { select: { accounts: true, issues: { where: { resolvedAt: null, ...visibleIssueWhere(viewer.id, todayCivil()) } } } },
      members: { select: { person: { select: { firstName: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24 sm:p-6">
      <h1 className="text-4xl font-extrabold">💰 Your jars</h1>
      <p className="text-muted-foreground">Each jar keeps its own accounts and is private to the people in it.</p>

      {jars.length === 0 && <p className="mt-5 font-bold">No jars yet. Make one below; you can add people after.</p>}
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {jars.map((j) => (
          <li key={j.id}>
            <Link
              href={`/finances/${j.id}`}
              className="flex h-full flex-col gap-1 rounded-2xl border-2 border-ink bg-card p-4 shadow-[3px_3px_0_rgb(31_41_51/0.15)] transition hover:-translate-y-0.5 dark:border-white/20"
            >
              <span className="text-3xl" aria-hidden>
                {j.emoji || "🫙"}
              </span>
              <span className="text-xl font-extrabold break-words">{j.name}</span>
              <span className="text-sm text-muted-foreground">
                {j.members.map((m) => m.person.firstName).join(", ")} · {j._count.accounts} account{j._count.accounts === 1 ? "" : "s"}
              </span>
              {j._count.issues > 0 && (
                <span className="mt-1 w-fit -rotate-1 rounded-md bg-sun px-1.5 text-xs font-bold text-ink">
                  {j._count.issues} need{j._count.issues === 1 ? "s" : ""} a look
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <section className="mt-6 rounded-2xl border-2 border-dashed border-ink/25 p-4 dark:border-white/20">
        <h2 className="font-extrabold">New jar</h2>
        <ActionForm action={createJar} className="mt-2 flex flex-wrap items-end gap-2">
          <input name="emoji" maxLength={8} placeholder="🫙" aria-label="Emoji" className={`${field} w-16 text-center`} />
          <input name="name" required maxLength={60} placeholder="Family money" aria-label="Jar name" className={`${field} min-w-0 flex-1`} />
          <Submit>Make it</Submit>
        </ActionForm>
      </section>

      {jars.length > 0 && <MyBackup stepup={stepup} />}
    </div>
  );
}

/** Phase 28: "Keep a copy" of your own jars, with the fresh sign-in it needs. */
async function MyBackup({ stepup }: { stepup?: string }) {
  const signIn = await backupSignInState(await requireActiveProfile());
  return (
    <section className="mt-6 rounded-2xl border-2 border-ink/15 p-4 dark:border-white/15">
      <h2 className="font-extrabold">🗄️ Keep a copy</h2>
      <p className="text-sm text-muted-foreground">
        A file of your jars, as you see them here (surprises meant for you stay out). It&apos;s yours to keep somewhere private.
        You&apos;ll get a note in Teams each time one is made.
      </p>
      {stepup === "blocked" && (
        <p role="alert" className="mt-2 text-sm font-bold text-tomato">
          Your browser didn&apos;t confirm this came from here, so no copy was made. Update the browser or try another one.
        </p>
      )}
      {signIn.fresh ? (
        <form method="post" action="/api/backup/my-money" className="mt-2">
          <button type="submit" className={btn}>
            Download my money jars (.json)
          </button>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p role={stepup === "fresh" ? "alert" : undefined} className={`text-sm ${stepup === "fresh" ? "font-bold text-tomato" : "text-muted-foreground"}`}>
            First, sign in again (copies need a sign-in from the last 15 minutes).
          </p>
          <SignInAgain callbackURL="/finances" loginHint={signIn.email} dev={signIn.dev} microsoft={signIn.microsoft} passkey={signIn.passkey} oidc={signIn.oidc} />
        </div>
      )}
    </section>
  );
}
