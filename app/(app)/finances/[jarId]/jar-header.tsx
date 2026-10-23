import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { btn } from "@/components/styles";
import { syncNow } from "../actions";
import { SyncButton } from "../forms";
import { JarTabs, type JarTab } from "./tabs";

/**
 * The top of every jar tab (Activity, Budget, Bills, Trends, Net worth): back to the jars, the jar's
 * name, Sync now (when it has a bank feed or Privacy.com) and ⚙️ Settings, then the tabs. The
 * page has already passed requireJar for this jar.
 */
export async function JarHeader({ jar, active }: { jar: { id: string; name: string; emoji: string | null }; active: JarTab }) {
  const feeds = await prisma.jarConnection.count({ where: { jarId: jar.id } });
  return (
    <>
      <Link href="/finances" className="inline-flex min-h-11 items-center text-sm font-bold text-muted-foreground hover:underline sm:min-h-9">
        ← Your jars
      </Link>
      <PageHeader
        className="mt-1"
        title={
          <>
            {jar.emoji || "🫙"} {jar.name}
          </>
        }
      >
        {feeds > 0 && <SyncButton sync={syncNow.bind(null, jar.id)} />}
        <Link href={`/finances/${jar.id}/settings`} className={btn}>
          ⚙️ Settings
        </Link>
      </PageHeader>
      <JarTabs jarId={jar.id} active={active} />
    </>
  );
}
