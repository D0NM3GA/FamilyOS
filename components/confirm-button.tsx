"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button for a server-rendered form that asks first, for the one-tap things that
 * can't be taken back (removing graded homework, undoing a logged service). Cancelling stops
 * the form from submitting; the form and its server action stay as they were. Disabled while
 * the form is busy (Phase 38), like SubmitButton.
 */
export function ConfirmButton({
  message,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  message: string;
  className: string;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
