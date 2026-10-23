"use client";

import { useState, useTransition } from "react";
import { VIEW_MODES } from "@/lib/view-prefs";
import { setMemberViewMode } from "./actions";

type Member = { id: string; firstName: string; mode: "BIG" | "FULL" };

/** Phase 19.5: grown-ups pick each household member's starting view. */
export function StartingViews({ members }: { members: Member[] }) {
  const [modes, setModes] = useState(() => Object.fromEntries(members.map((m) => [m.id, m.mode])));
  const [saving, setSaving] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <ul className="mt-2 divide-y divide-border">
      {members.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-3 py-2">
          <label htmlFor={`view-${m.id}`} className="text-sm font-medium text-foreground">
            {m.firstName}
          </label>
          <select
            id={`view-${m.id}`}
            value={modes[m.id]}
            disabled={saving === m.id}
            onChange={(e) => {
              const mode = e.target.value as Member["mode"];
              const before = modes[m.id];
              setModes((s) => ({ ...s, [m.id]: mode }));
              setSaving(m.id);
              startTransition(async () => {
                try {
                  await setMemberViewMode(m.id, mode);
                } catch {
                  setModes((s) => ({ ...s, [m.id]: before }));
                } finally {
                  setSaving(null);
                }
              });
            }}
            className="min-h-11 rounded-md border border-input bg-card px-2 py-1.5 text-sm focus:border-ring focus:outline-none sm:min-h-9"
          >
            {VIEW_MODES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}
