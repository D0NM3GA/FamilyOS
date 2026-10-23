import Link from "next/link";
import { getActiveProfile, requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getHouseholdMembers } from "@/lib/people";
import { getPointsBalance } from "@/lib/tasks/queries";
import { getStickerHistory, type LedgerKind } from "@/lib/store/ledger";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { card, chip, chipRow, sectionTitle } from "@/components/styles";
import { AdjustForm } from "./adjust-form";
import { requireAppOn } from "@/lib/app-guard";
import { appOn } from "@/lib/app-switches";
import type { Metadata } from "next";
import { getRewardWords } from "@/lib/household-settings";
import { capitalized } from "@/lib/reward-words";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${capitalized((await getRewardWords((await getActiveProfile())?.householdId)).one)} history` };
}

const KIND: Record<LedgerKind, { emoji: string; what: string }> = {
  chore: { emoji: "🧹", what: "Chore" },
  med: { emoji: "💊", what: "Meds" },
  order: { emoji: "🛍️", what: "Bought" },
  refund: { emoji: "↩️", what: "Given back" },
  bonus: { emoji: "🌟", what: "Bonus" },
  taken: { emoji: "✋", what: "Taken back" },
};

/**
 * Where someone's stickers came from and went. Kids only ever see their own; grown-ups can
 * look at anyone in the family and give a bonus or take some back.
 */
export default async function StickerHistoryPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  await requireAppOn("store");
  const profile = await requireActiveProfile();
  const choresOn = await appOn(profile.householdId, "chores");
  const words = await getRewardWords(profile.householdId);
  const adult = isAdult(profile);
  const { person } = await searchParams;

  const members = adult ? await getHouseholdMembers(profile.householdId) : [];
  const who = adult ? (members.find((m) => m.id === person) ?? members.find((m) => m.id === profile.id) ?? members[0]) : null;
  const personId = who?.id ?? profile.id;
  const firstName = who?.firstName ?? profile.firstName;
  const mine = personId === profile.id;

  const [balance, rows] = await Promise.all([getPointsBalance(personId), getStickerHistory(personId, words)]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Link href="/points" className="inline-flex min-h-11 items-center text-sm font-bold text-muted-foreground hover:text-foreground sm:min-h-0">
        ← {words.store}
      </Link>
      <PageHeader title={mine ? `📜 My ${words.many}` : `📜 ${firstName}'s ${words.many}`} />

      {adult && members.length > 1 && (
        <nav aria-label={`Whose ${words.many}`} className={chipRow}>
          {members.map((m) => (
            <Link key={m.id} href={`/points/history?person=${m.id}`} aria-current={m.id === personId ? "page" : undefined} className={chip}>
              {m.firstName}
            </Link>
          ))}
        </nav>
      )}

      <p className="font-heading text-3xl font-extrabold">
        ⭐ {balance} <span className="text-lg font-bold text-muted-foreground">{Math.abs(balance) === 1 ? words.one : words.many} to spend</span>
      </p>

      {adult && !mine && (
        <section className={card}>
          <h2 className={`${sectionTitle} mb-3`}>A bonus, or some back</h2>
          <AdjustForm personId={personId} firstName={firstName} />
        </section>
      )}

      <section>
        <h2 className={sectionTitle}>Lately</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing yet. {mine && choresOn ? <Link href={`/chores?person=${profile.id}`} className="font-bold underline">Chores earn {words.many}!</Link> : null}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-2xl bg-card ring-1 ring-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span aria-hidden className="text-xl">
                  {KIND[r.kind].emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-foreground">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {KIND[r.kind].what} · {formatDateTime(r.createdAt)}
                  </span>
                </span>
                <span className={`shrink-0 font-heading text-lg font-extrabold ${r.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                  {r.delta > 0 ? `+${r.delta}` : r.delta} ⭐
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">The latest 100.</p>
      </section>
    </div>
  );
}
