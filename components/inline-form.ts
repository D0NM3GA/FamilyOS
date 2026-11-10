"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * A form that opens in place behind a button ("Log service", "+ Log a repair", "Rename").
 * Closing it (Cancel, Escape or a save) takes away the button that had focus, so focus would
 * fall to the top of the page and a keyboard or screen reader user would lose their place:
 * `close` hands it back to the button that opened the form. Put `opener` on that button; it
 * can be one that only shows while the form is closed.
 */
export function useInlineForm(startOpen = false) {
  const [open, setOpen] = useState(startOpen);
  const opener = useRef<HTMLButtonElement>(null);
  const handBack = useRef(false);
  // Once the closed form has rendered, so an opener that only shows while closed is back. A save
  // can close it from inside its action, which commits whenever the action finishes.
  useEffect(() => {
    if (open || !handBack.current) return;
    handBack.current = false;
    opener.current?.focus();
  }, [open]);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    handBack.current = true;
    setOpen(false);
  }, []);
  return { open, show, close, opener };
}

/**
 * A form's onKeyDown: Escape closes it, like Cancel, unless something inside already used the
 * key (a picker's open list, an in-place question, which mark it handled).
 */
export function closeOnEscape(close: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    close();
  };
}

/**
 * A list whose rows swap their Edit button for a form, one row at a time. Like useInlineForm,
 * closing the form hands focus back to that row's Edit button (if the row is still there).
 * Put `editButton(id)` as the ref on each row's Edit button.
 */
export function useRowEdit() {
  const [editing, setEditing] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const handBackTo = useRef<string | null>(null);
  useEffect(() => {
    if (editing !== null || handBackTo.current === null) return;
    buttons.current.get(handBackTo.current)?.focus();
    handBackTo.current = null;
  }, [editing]);
  const stop = useCallback(() => {
    setEditing((was) => {
      handBackTo.current = was;
      return null;
    });
  }, []);
  const editButton = useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      if (el) buttons.current.set(id, el);
      else buttons.current.delete(id);
    },
    [],
  );
  return { editing, edit: setEditing, stop, editButton };
}
