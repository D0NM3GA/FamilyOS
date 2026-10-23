"use client";

import { useTransition } from "react";
import { setRequestedBy } from "./actions";

export function RequesterSelect({
  id,
  itemId,
  currentId,
  members,
}: {
  id?: string;
  itemId: string;
  currentId: string | null;
  members: { id: string; firstName: string }[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      id={id}
      value={currentId ?? ""}
      disabled={pending}
      onChange={(e) => {
        const value = e.target.value || null;
        startTransition(() => setRequestedBy(itemId, value));
      }}
      className="min-h-11 shrink-0 rounded-md border-0 bg-transparent py-1 text-xs text-muted-foreground focus:outline-none disabled:opacity-50 sm:min-h-9"
    >
      <option value="">For anyone</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          For {m.firstName}
        </option>
      ))}
    </select>
  );
}
