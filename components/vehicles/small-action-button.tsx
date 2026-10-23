"use client";

import { useTransition } from "react";
import { btn, btnDanger } from "@/components/styles";

/**
 * A one-tap adult action (delete a fill-up, mark a recall handled / un-handled) that needs
 * a pending state but no form fields. `confirmText`, when set, asks first — used for the
 * one destructive case (deleting a fill-up can't be undone).
 */
export function SmallActionButton({
  action,
  label,
  pendingLabel,
  confirmText,
  tone = "neutral",
  ariaLabel,
}: {
  action: () => Promise<void>;
  label: string;
  pendingLabel?: string;
  confirmText?: string;
  tone?: "neutral" | "danger";
  /** Names what it acts on when the visible label alone ("Delete") repeats down a list. */
  ariaLabel?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={ariaLabel}
      onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        startTransition(() => action());
      }}
      className={`shrink-0 ${tone === "danger" ? btnDanger : btn}`}
    >
      {pending ? (pendingLabel ?? "…") : label}
    </button>
  );
}
