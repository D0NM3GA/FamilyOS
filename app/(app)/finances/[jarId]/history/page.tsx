import Link from "next/link";
import type { Metadata } from "next";
import { requireJar } from "@/lib/finance/access";
import { todayCivil } from "@/lib/finance/budget";
import { jarHistory } from "@/lib/finance/history";
import { HistoryList } from "../history";
import { backLink } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Jar history" };

/** Phase 30: the jar's last 100 changes, as this viewer may see them (surprises stay hidden). */
export default async function JarHistoryPage({ params }: { params: Promise<{ jarId: string }> }) {
  await requireAppOn("money");
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);
  const lines = await jarHistory(jar.id, viewer.id, todayCivil(), 100);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-24 sm:p-6">
      <Link href={`/finances/${jar.id}`} className={`${backLink} self-start`}>
        ← {jar.name}
      </Link>
      <h1 className="text-3xl font-extrabold">🕘 Who changed what</h1>
      <p className="text-sm text-muted-foreground">Changes people made in this jar over the last year. The automatic tidy-ups aren&apos;t listed.</p>
      <section className="rounded-2xl border-2 border-ink bg-card p-4 dark:border-white/20">
        <HistoryList lines={lines} />
      </section>
    </div>
  );
}
