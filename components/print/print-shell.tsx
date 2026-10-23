import Link from "next/link";
import { formatFullDate } from "@/lib/format";
import { PrintButton } from "./print-button";

/**
 * Shared chrome for every /print/** page (Phase 13). Kernel: presentational only, no data
 * fetching — each page fetches its own data and household name (see eslint.config.mjs's
 * printKernel zone).
 *
 * Why /print/** lives outside the (app) route group at all: that layout wraps pages in an
 * `overflow-hidden` flex row with a scrolling <main>, and Chromium clips a printed scroll
 * container to one viewport — print CSS can't undo that. Each page still calls
 * requireActiveProfile() itself, like every page in the app.
 *
 * Forced light colors (explicit stone-* classes, never the theme tokens like bg-card or
 * border-border): the root layout still toggles `.dark` on <html> for these pages, and
 * paper is white.
 */
export function PrintShell({
  title,
  subtitle,
  householdName,
  backHref,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  householdName: string;
  backHref: string;
  /** Extra on-screen-only controls (e.g. view toggles), hidden when printing. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white px-8 py-6 text-stone-900 print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href={backHref} className="text-sm text-stone-600 hover:underline">
            ← Back
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {toolbar}
            <PrintButton />
          </div>
        </div>

        <header className="mt-4 border-b border-stone-300 pb-3">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-stone-600">
            {subtitle ? <>{subtitle} · </> : null}
            {householdName} · printed {formatFullDate(new Date())}
          </p>
        </header>

        {children}
      </div>
    </div>
  );
}

export function PrintSection({
  title,
  children,
  breakBefore,
  keepTogether,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  /** Start this section on a new sheet (e.g. one chore chart per kid). */
  breakBefore?: boolean;
  /**
   * Keep the whole section on one sheet. Opt-in, not the default: Chromium honors it by
   * pushing a section that doesn't fit to the next page, so a long contact list or big
   * store section would leave page 1 nearly empty. Long tables instead rely on PrintRow
   * never splitting and <thead> repeating on each page.
   */
  keepTogether?: boolean;
}) {
  return (
    <section
      className={`mt-6 ${keepTogether ? "break-inside-avoid-page" : ""} ${breakBefore ? "print:break-before-page" : ""}`}
    >
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function PrintTable({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} className="py-1 pr-3 font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function PrintRow({ children }: { children: React.ReactNode }) {
  return <tr className="break-inside-avoid border-t border-stone-200">{children}</tr>;
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`py-1 pr-3 align-top ${className ?? ""}`}>{children}</td>;
}

export function PrintEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-stone-600">{children}</p>;
}

/** An empty tick box to fill in with a pen; `checked` prints a ✓ (e.g. already done). */
export function CheckBox({ checked }: { checked?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-stone-500 align-middle text-[11px] leading-none"
    >
      {checked ? "✓" : ""}
    </span>
  );
}

/** On-screen link styled like the rest of PrintShell's toolbar; hidden on paper. */
export function PrintToolbarLink({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${
        active ? "bg-stone-900 text-white ring-stone-900" : "text-stone-700 ring-stone-300 hover:bg-stone-100"
      }`}
    >
      {children}
    </Link>
  );
}
