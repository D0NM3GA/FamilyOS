"use client";

import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { btn, btnDanger } from "@/components/styles";

/**
 * Phase 38: the submit button for any form that runs a server action. React sends every
 * submit, even while the last one is still running, so a double tap on a phone would log a
 * call twice or add stock twice; this one is disabled (and aria-busy, which globals.css dims)
 * until its form's action finishes. Server components can render it inside their own <form>.
 * `pendingText` swaps the label while busy; without it the label stays, so icon buttons keep
 * their size.
 */
export function SubmitButton({
  children,
  pendingText,
  disabled,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { pendingText?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button {...rest} type="submit" disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending && pendingText !== undefined ? pendingText : children}
    </button>
  );
}

/**
 * The question, a "yes" button and Cancel, in place of the button that asked. Focus moves to
 * "yes" so the question is read out with it; Cancel puts focus back on the button it replaced.
 */
function useAsking() {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (asking || !cancelled.current) return;
    cancelled.current = false;
    trigger.current?.focus();
  }, [asking]);
  return {
    asking,
    trigger,
    ask: () => setAsking(true),
    cancel: () => {
      cancelled.current = true;
      setAsking(false);
    },
  };
}

type ConfirmProps = {
  children: ReactNode;
  /** What happens, in a sentence: "Disconnect the bank feed? You'll need a new setup token to reconnect." */
  question: string;
  yes: string;
  /** The button that asks, and (unless `yesClassName`) the "yes" button. */
  className?: string;
  yesClassName?: string;
  "aria-label"?: string;
};

function ConfirmPanel({
  question,
  pending,
  cancel,
  yesButton,
}: {
  question: string;
  pending: boolean;
  cancel: () => void;
  yesButton: (questionId: string) => ReactNode;
}) {
  const questionId = useId();
  return (
    // basis-full: in a flex row the question takes its own line instead of squeezing the row.
    // text-left: a question in a right-aligned cell (Settings → Household) still reads normally.
    // Escape cancels, like closing a dialog.
    <span
      className="flex max-w-sm basis-full flex-col gap-2 rounded-xl bg-tomato/10 p-2 text-left"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) cancel();
      }}
    >
      <span id={questionId} className="text-sm font-semibold">
        {question}
      </span>
      <span className="flex flex-wrap gap-2">
        {yesButton(questionId)}
        <button type="button" disabled={pending} className={btn} onClick={cancel}>
          Cancel
        </button>
      </span>
    </span>
  );
}

/**
 * A submit button that asks first, for the one-tap things that are hard to take back (removing
 * someone from the household, leaving a jar). The first tap swaps it for the question, a "yes"
 * button and Cancel, in place; only "yes" submits the form (the owner's call: ask first, in
 * place, rather than an Undo bar).
 */
export function ConfirmSubmit({ children, question, yes, className = btnDanger, yesClassName, "aria-label": ariaLabel }: ConfirmProps) {
  const { asking, trigger, ask, cancel } = useAsking();
  const { pending } = useFormStatus();
  if (!asking) {
    return (
      <button ref={trigger} type="button" aria-label={ariaLabel} className={className} onClick={ask}>
        {children}
      </button>
    );
  }
  return (
    <ConfirmPanel
      question={question}
      pending={pending}
      cancel={cancel}
      yesButton={(questionId) => (
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={yesClassName ?? className} aria-describedby={questionId} autoFocus>
          {pending ? "Working…" : yes}
        </button>
      )}
    />
  );
}

/** ConfirmSubmit for a button that isn't in a form: "yes" calls `onConfirm`. */
export function ConfirmAction({
  children,
  question,
  yes,
  onConfirm,
  pending,
  className = btnDanger,
  yesClassName,
  "aria-label": ariaLabel,
}: ConfirmProps & { onConfirm: () => void; pending: boolean }) {
  const { asking, trigger, ask, cancel } = useAsking();
  if (!asking) {
    return (
      <button ref={trigger} type="button" disabled={pending} aria-label={ariaLabel} className={className} onClick={ask}>
        {children}
      </button>
    );
  }
  return (
    <ConfirmPanel
      question={question}
      pending={pending}
      cancel={cancel}
      yesButton={(questionId) => (
        <button
          type="button"
          disabled={pending}
          aria-busy={pending || undefined}
          className={yesClassName ?? className}
          aria-describedby={questionId}
          autoFocus
          onClick={onConfirm}
        >
          {pending ? "Working…" : yes}
        </button>
      )}
    />
  );
}
