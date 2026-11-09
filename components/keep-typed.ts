"use client";

import { useActionState, useEffect, useRef, type RefObject } from "react";

/**
 * `useActionState` for a form that should keep what was typed when its action says no. React
 * resets a form after every action that doesn't throw, so an action that returns `{ error }`
 * still wiped the fields: twelve ingredient lines gone over a duplicate name, or "Take some back"
 * flipping to "Give". A reset is a cancellable event, and this cancels the one after a refusal.
 *
 * Give the form the returned ref (or pass one it already has). A success still resets as before.
 * Components that keep their own state in a form (the Picker) skip a cancelled reset.
 */
export function useKeptActionState<S extends { error?: string | null }>(
  action: (prev: S, formData: FormData) => Promise<S>,
  initial: S,
  formRef?: RefObject<HTMLFormElement | null>,
) {
  const ownRef = useRef<HTMLFormElement>(null);
  const ref = formRef ?? ownRef;
  const keep = useRef(false);

  useEffect(() => {
    // Capture, so it runs before listeners on the form itself (the Picker's).
    const onReset = (event: Event) => {
      if (event.target !== ref.current || !keep.current) return;
      keep.current = false;
      event.preventDefault();
    };
    document.addEventListener("reset", onReset, true);
    return () => document.removeEventListener("reset", onReset, true);
  }, [ref]);

  const [state, run, pending] = useActionState<S, FormData>(async (prev: S, formData: FormData): Promise<S> => {
    keep.current = false;
    const next = await action(prev, formData);
    keep.current = Boolean(next?.error);
    return next;
  }, initial as Awaited<S>);

  return [state, run, pending, ref] as const;
}
