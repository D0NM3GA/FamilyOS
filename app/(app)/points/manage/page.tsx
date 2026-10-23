import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { limitLabel } from "@/lib/store/rules";
import { btn } from "@/components/styles";
import { setRewardActive } from "../actions";
import { BucketForm, DeleteBucketButton, FamilyGoalForm, RewardForm } from "./forms";
import { requireAppOn } from "@/lib/app-guard";
import { RewardWord } from "@/components/family-look";
import { SubmitButton } from "@/components/submit";

export const metadata = { title: "Stock the store" };

/** Phase 20: grown-ups stock the Sticker Store — shelves, rewards and the family goal. */
export default async function ManageStorePage() {
  await requireAppOn("store");
  const profile = await requireActiveProfile();
  if (!isAdult(profile)) {
    return <p className="p-6 text-muted-foreground">Only grown-ups can stock the store.</p>;
  }

  const [buckets, rewards, household] = await Promise.all([
    prisma.rewardBucket.findMany({
      where: { householdId: profile.householdId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, emoji: true, _count: { select: { rewards: true } } },
    }),
    prisma.reward.findMany({
      where: { householdId: profile.householdId },
      orderBy: [{ active: "desc" }, { pointCost: "asc" }],
      select: { id: true, title: true, emoji: true, pointCost: true, bucketId: true, limitPerWeek: true, needsApproval: true, active: true },
    }),
    prisma.household.findUniqueOrThrow({
      where: { id: profile.householdId },
      select: { familyGoalStickers: true, familyGoalTitle: true },
    }),
  ]);
  const shelfOptions = buckets.map((b) => ({ id: b.id, label: `${b.emoji ?? ""} ${b.name}`.trim() }));

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 sm:p-6">
      <div>
        <Link href="/points" className="inline-flex min-h-11 items-center text-sm font-bold text-muted-foreground hover:text-foreground sm:min-h-9">
          ← Back to the store
        </Link>
        <h1 className="text-4xl font-extrabold">Stock the store</h1>
        <p className="text-muted-foreground">Kids can only buy what&apos;s on these shelves.</p>
      </div>

      <section className="rounded-3xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-xl font-extrabold">Family sheet goal</h2>
        <p className="text-sm text-muted-foreground">Everyone&apos;s <RewardWord /> this month add up toward this. Leave blank for no goal.</p>
        <FamilyGoalForm stickers={household.familyGoalStickers} title={household.familyGoalTitle} />
      </section>

      <section className="rounded-3xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-xl font-extrabold">Shelves</h2>
        <ul className="mt-3 space-y-2">
          {buckets.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2">
              <BucketForm bucket={{ id: b.id, name: b.name, emoji: b.emoji }} />
              <span className="text-xs text-muted-foreground">{b._count.rewards} rewards</span>
              <DeleteBucketButton bucketId={b.id} />
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-border pt-3">
          <BucketForm bucket={null} />
        </div>
      </section>

      <section className="rounded-3xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-xl font-extrabold">Rewards</h2>
        <div className="mt-3">
          <RewardForm reward={null} shelves={shelfOptions} />
        </div>
        <ul className="mt-4 divide-y divide-border">
          {rewards.map((r) => (
            <li key={r.id} className="py-3">
              <details>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 sm:min-h-9">
                  <span className={`min-w-0 font-bold break-words ${r.active ? "" : "text-muted-foreground line-through"}`}>
                    {r.emoji ?? "🎁"} {r.title}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    ⭐ {r.pointCost} · {limitLabel(r.limitPerWeek)}
                    {r.needsApproval && " · Needs an OK"}
                    {r.bucketId ? ` · ${shelfOptions.find((s) => s.id === r.bucketId)?.label ?? ""}` : " · No shelf"}
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  <RewardForm reward={r} shelves={shelfOptions} />
                  <form action={setRewardActive.bind(null, r.id, !r.active)}>
                    <SubmitButton className={btn}>
                      {r.active ? "Take off the shelves" : "Put back on the shelves"}
                    </SubmitButton>
                  </form>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
