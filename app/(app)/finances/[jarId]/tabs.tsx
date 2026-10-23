import Link from "next/link";
import { chip, chipRow } from "@/components/styles";

export type JarTab = "activity" | "budget" | "bills" | "trends" | "net-worth";

/** Phase 26: Activity | Budget | Bills. Phase 33: Trends. Phase 34: Net worth. Every page still runs requireJar itself. */
export function JarTabs({ jarId, active }: { jarId: string; active: JarTab }) {
  const tabs = [
    ["activity", "📒 Activity", `/finances/${jarId}`],
    ["budget", "🎯 Budget", `/finances/${jarId}/budget`],
    ["bills", "🔁 Bills & ahead", `/finances/${jarId}/bills`],
    ["trends", "📈 Trends", `/finances/${jarId}/trends`],
    ["net-worth", "💎 Net worth", `/finances/${jarId}/net-worth`],
  ] as const;
  return (
    <nav aria-label="Jar views" className={`mt-3 ${chipRow}`}>
      {tabs.map(([id, label, href]) => (
        <Link key={id} href={href} aria-current={active === id ? "page" : undefined} className={chip}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
