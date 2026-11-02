import { ChevronRight } from "lucide-react";
import { sectionTitle } from "@/components/styles";

/** What's after today, folded so a long list doesn't bury it. */
export function UpcomingFold({ days, count, open = false, children }: { days: number; count: number; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group">
      <summary className="flex min-h-11 cursor-pointer items-center">
        <h2 className={`${sectionTitle} flex items-center gap-1`}>
          <ChevronRight size={16} aria-hidden className="transition-transform group-open:rotate-90" />
          Next {days} days ({count})
        </h2>
      </summary>
      <ul className="mt-2 space-y-2">{children}</ul>
    </details>
  );
}
