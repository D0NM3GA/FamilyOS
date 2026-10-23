"use client";

import Link from "next/link";
import { useActionState } from "react";
import { btn, btnPrimary } from "@/components/styles";
import type { VehicleFormState } from "../../../actions";

type Option = { key: string; title: string; intervalLabel: string; alreadyTracked: boolean };

export function TemplatesForm({
  action,
  options,
  skipHref,
}: {
  action: (prevState: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;
  options: Option[];
  skipHref: string;
}) {
  const [state, formAction, pending] = useActionState<VehicleFormState, FormData>(action, {});

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <ul className="space-y-1.5">
        {options.map((o) => (
          <li key={o.key}>
            <label
              className={`flex min-h-11 items-center gap-3 rounded-xl bg-card px-3 py-2 ring-1 ring-border ${
                o.alreadyTracked ? "opacity-60" : "cursor-pointer hover:bg-muted"
              }`}
            >
              <input type="checkbox" name="template" value={o.key} disabled={o.alreadyTracked} className="size-4 shrink-0" />
              <span className="flex-1 text-sm font-bold text-foreground">{o.title}</span>
              <span className="text-xs text-muted-foreground">
                {o.alreadyTracked ? "Already tracked" : o.intervalLabel}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Adding…" : "Add selected"}
        </button>
        <Link href={skipHref} className={btn}>
          Skip
        </Link>
      </div>
    </form>
  );
}
