"use client";

import { BulkBar } from "@/components/selection";
import type { BulkResult } from "@/lib/work-items/bulk";

type Bulk = (input: { ids: string[]; action: "TODO" | "DONE" | "MISSING" | "FORM_DONE" }) => Promise<BulkResult | { error: string }>;

/** Phase 59.3: the homework list's bar while selecting. */
export function HomeworkBulkBar({ bulk }: { bulk: Bulk }) {
  return (
    <BulkBar
      actions={[
        { key: "done", label: "Turned in", verb: "Turned in", run: (ids) => bulk({ ids, action: "DONE" }) },
        { key: "todo", label: "To do", verb: "Back to do", run: (ids) => bulk({ ids, action: "TODO" }) },
        { key: "missing", label: "Missing", verb: "Marked missing", run: (ids) => bulk({ ids, action: "MISSING" }) },
      ]}
    />
  );
}

/** Phase 59.3: Forms & to-dos' bar while selecting. */
export function FormsBulkBar({ bulk }: { bulk: Bulk }) {
  return <BulkBar actions={[{ key: "done", label: "Done", verb: "Done", run: (ids) => bulk({ ids, action: "FORM_DONE" }) }]} />;
}
