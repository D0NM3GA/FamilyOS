import Link from "next/link";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";

/**
 * Phase 19.5: the root not-found handles every unmatched URL (a nested not-found.tsx only
 * renders for an explicit notFound() call). It sits outside the (app) layout, so there's no
 * signed-in profile or Bunson volume here — Bunson simply shows.
 */
export default function NotFound() {
  return (
    <div className="graph-paper flex flex-1 flex-col items-center justify-center gap-6 bg-muted px-4 py-16 text-center">
      <h1 className="text-4xl font-extrabold text-foreground">Page not found</h1>
      <BunsonMoment kind="cheer" pose="stand" text={MOMENT_LINES.notFound} />
      <Link
        href="/"
        className="rounded-2xl border-2 border-ink bg-sun px-6 py-3 font-heading text-lg font-extrabold text-ink shadow-[3px_3px_0_var(--color-ink)] transition hover:-translate-y-0.5"
      >
        Back home
      </Link>
    </div>
  );
}
