import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAppOn } from "@/lib/app-guard";
import { getHouseholdSettings } from "@/lib/household-settings";
import { formatRelative } from "@/lib/format";
import { atMidnight } from "@/lib/tasks/schedule";
import { swapChoices } from "@/lib/chores/swaps";
import { backLink } from "@/components/styles";
import { SwapForm } from "./swap-form";

export const metadata = { title: "Ask to swap" };

/**
 * Phase 70c: a kid asks a brother or sister to take one of their chores, and can offer to do one of
 * theirs back. It's theirs once they say yes (the owner's call: no grown-up needed).
 */
export default async function SwapPage() {
  await requireAppOn("chores");
  const profile = await requireActiveProfile();
  if (profile.role !== "KID") redirect("/chores");
  const [choices, settings] = await Promise.all([swapChoices(profile, atMidnight(new Date())), getHouseholdSettings(profile.householdId)]);
  const zone = settings.timezone ?? undefined;
  const label = (c: { title: string; day: Date }) => `${c.title} (${formatRelative(c.day, zone).toLowerCase()})`;

  return (
    <div className="max-w-xl space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/chores" className={backLink}>
          ← Chores
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Ask to swap a chore</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ask your brother or sister to take one of yours. It&apos;s theirs once they say yes.</p>
      </div>
      {!choices || choices.mine.length === 0 ? (
        <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground shadow-sm ring-1 ring-border">You don&apos;t have a chore still to do to swap.</p>
      ) : choices.others.length === 0 ? (
        <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground shadow-sm ring-1 ring-border">There&apos;s nobody to swap with.</p>
      ) : (
        <SwapForm
          mine={choices.mine.map((c) => ({ id: c.id, label: label(c) }))}
          others={choices.others.map((o) => ({ id: o.id, name: o.name, chores: o.chores.map((c) => ({ id: c.id, label: label(c) })) }))}
        />
      )}
    </div>
  );
}
