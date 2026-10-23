import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireJar } from "@/lib/finance/access";
import { formatMoney } from "@/lib/money";
import { todayCivil } from "@/lib/finance/budget";
import { visibleIssueWhere } from "@/lib/finance/gifts";
import { answerIssue } from "../../actions";
import { backLink, btn } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

export const metadata: Metadata = { title: "Needs a look" };

const utcDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Phase 25: only what the reconciler couldn't decide. Each answer is remembered, so the
 * same question never comes back. Phase 27: a question about a surprise hidden from the
 * viewer is left to the others.
 */
export default async function ReviewPage({ params }: { params: Promise<{ jarId: string }> }) {
  await requireAppOn("money");
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);
  const txnSelect = { select: { postedOn: true, amountCents: true, description: true, source: true, account: { select: { name: true, currency: true } } } };
  const issues = await prisma.reconcileIssue.findMany({
    where: { jarId: jar.id, resolvedAt: null, ...visibleIssueWhere(viewer.id, todayCivil()) },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, kind: true, txn: txnSelect, otherTxn: txnSelect, key: true },
  });
  const connections = await prisma.jarConnection.findMany({ where: { jarId: jar.id }, select: { id: true, provider: true, lastError: true } });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-24 sm:p-6">
      <Link href={`/finances/${jar.id}`} className={`${backLink} self-start`}>
        ← {jar.name}
      </Link>
      <h1 className="text-3xl font-extrabold">🔎 Needs a look</h1>
      {issues.length === 0 && <p className="text-muted-foreground">Nothing to check. The jar adds up.</p>}
      <ul className="flex flex-col gap-3">
        {issues.map((i) => {
          if (i.kind === "SYNC_ERROR") {
            const conn = connections.find((c) => `sync:${c.id}` === i.key);
            return (
              <li key={i.id} className="rounded-2xl border-2 border-ink bg-card p-4 dark:border-white/20">
                <p className="font-bold">{conn?.provider === "PRIVACY" ? "Privacy.com" : "The bank feed"} didn&apos;t sync</p>
                <p className="text-sm text-muted-foreground">{conn?.lastError ?? "It'll try again later."}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link href={`/finances/${jar.id}/settings`} className={btn}>
                    Reconnect
                  </Link>
                  <form action={answerIssue.bind(null, jar.id, i.id, "DISMISSED")}>
                    <SubmitButton className={btn}>
                      Dismiss
                    </SubmitButton>
                  </form>
                </div>
              </li>
            );
          }
          if (!i.txn || !i.otherTxn) return null;
          const row = (t: NonNullable<typeof i.txn>) => (
            <div className="rounded-xl bg-muted px-3 py-2 text-sm">
              <span className="font-bold">{formatMoney(t.amountCents, t.account.currency)}</span> · {utcDay(t.postedOn)} · {t.account.name}
              <span className="block truncate text-muted-foreground">
                {t.description} <em>({t.source === "MANUAL" ? "statement file" : "bank feed"})</em>
              </span>
            </div>
          );
          return (
            <li key={i.id} className="flex flex-col gap-2 rounded-2xl border-2 border-ink bg-card p-4 dark:border-white/20">
              <p className="font-bold">Same charge twice?</p>
              {row(i.txn)}
              {row(i.otherTxn)}
              <div className="flex flex-wrap gap-2">
                <form action={answerIssue.bind(null, jar.id, i.id, "SAME")}>
                  <SubmitButton className={btn}>
                    Same charge (keep the bank&apos;s)
                  </SubmitButton>
                </form>
                <form action={answerIssue.bind(null, jar.id, i.id, "DIFFERENT")}>
                  <SubmitButton className={btn}>
                    Two different charges
                  </SubmitButton>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
