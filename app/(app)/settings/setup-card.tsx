import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { SubmitButton } from "@/components/submit";
import { SETUP_PATH, type SetupItem } from "@/lib/setup-checklist";
import { hideSetupCard, showSetupCard } from "./get-started/actions";

/**
 * Phase 45.4: "Finish setting up" at the top of Settings: what's left, worked out from the app
 * itself, each with why it matters. Admins can pick the guided setup back up; anyone can hide
 * the card for themselves. Gone once everything is done.
 */
export function SetupCard({ items, hidden, admin }: { items: SetupItem[]; hidden: boolean; admin: boolean }) {
  const left = items.filter((i) => !i.done);
  if (left.length === 0) return null;
  if (hidden) {
    return (
      <form action={showSetupCard}>
        <SubmitButton className="inline-flex min-h-11 items-center rounded-xl border-2 border-dashed border-border px-4 text-sm font-bold text-foreground hover:bg-muted sm:min-h-9">
          Show &ldquo;Finish setting up&rdquo; ({left.length} left)
        </SubmitButton>
      </form>
    );
  }
  const done = items.length - left.length;
  const next = left[0];
  return (
    <section aria-labelledby="setup-heading" className="space-y-4 rounded-3xl bg-ink p-5 text-white sm:p-6 dark:bg-card dark:ring-2 dark:ring-sun/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-sun">Finish setting up</p>
          <h2 id="setup-heading" className="font-heading text-2xl font-extrabold leading-tight">
            {done} of {items.length} done. {left.length === 1 ? "One left." : `${left.length} to go.`}
          </h2>
          <p className="mt-1 text-sm text-white/80">The app works without these, but each one makes it more useful for the whole family.</p>
        </div>
        <form action={hideSetupCard}>
          <SubmitButton className="inline-flex min-h-11 items-center rounded-xl border-2 border-white/30 px-3 text-sm font-bold text-white hover:bg-white/10 sm:min-h-9">
            Hide for now
          </SubmitButton>
        </form>
      </div>
      <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} className="h-3 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-sun" style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-x-4 gap-y-1">
        {items.map((item) => (
          <li key={item.id}>
            {item.done ? (
              <span className="flex min-h-9 items-center gap-2 text-sm text-white/70">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-sun text-ink">
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
                <span className="line-through">{item.label}</span>
                <span className="sr-only">(done)</span>
              </span>
            ) : (
              <Link href={item.href} className="flex min-h-9 items-center gap-2 text-sm font-bold text-white hover:underline">
                <span className="size-6 shrink-0 rounded-full border-2 border-white/50" aria-hidden="true" />
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={admin ? SETUP_PATH : next.href}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-sun px-5 text-base font-extrabold text-ink transition hover:brightness-95"
        >
          {admin ? "Pick up where you left off" : next.label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        <span className="text-sm text-white/80">
          Next: {next.label.toLowerCase()}, {next.why}.
        </span>
      </div>
    </section>
  );
}
