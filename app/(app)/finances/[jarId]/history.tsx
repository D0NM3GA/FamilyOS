import type { HistoryLine } from "@/lib/finance/history";

const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Phase 30: who changed what, newest first. */
export function HistoryList({ lines }: { lines: HistoryLine[] }) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">Nothing changed yet.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {lines.map((l) => (
        <li key={l.id} className="flex flex-wrap justify-between gap-x-3">
          <span>{l.text}</span>
          <time dateTime={l.at.toISOString()} className="text-xs text-muted-foreground">
            {when(l.at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
