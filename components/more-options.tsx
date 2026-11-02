import { ChevronRight } from "lucide-react";

/** A form's less-used fields, folded. They still submit while closed, so nothing in here may be `required`. */
export function MoreOptions({ open, summary, children }: { open: boolean; summary: string; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border-2 border-input p-3">
      <summary className="flex min-h-11 cursor-pointer items-center gap-1 font-bold">
        <ChevronRight size={16} aria-hidden className="shrink-0 transition-transform group-open:rotate-90" />
        <span>
          More options <span className="block text-xs font-normal text-muted-foreground">{summary}</span>
        </span>
      </summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  );
}
