"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { takeOffList, undoTakeOff } from "./actions";

const UNDO_MS = 6000;

type Note = { text: string; undo?: string };

const NoteContext = createContext<((note: Note) => void) | null>(null);

function failureText(err: unknown): string {
  return err instanceof TypeError ? "Couldn't reach home. Check your signal and try again." : "That didn't work. Reload and try again.";
}

/**
 * The list's bottom dock: the "Took Milk off the list · Undo" bar and the Finish trip button
 * (`footer`), stacked so they never cover each other. The bar lives here, above the rows,
 * because the row that offered it is gone from the list by the time it shows.
 *
 * pointer-events-none on the dock: it's a full-width, mostly-empty fixed box on narrow
 * viewports, and the Bunson mascot can end up docked underneath it; without this, its empty
 * padding would swallow taps meant for him even though he's visibly there. The bar and the
 * button turn pointer events back on for themselves. The dock deliberately wins the overlap
 * (no pointer-events trick on Bunson's side): on a narrow phone with items checked off, his
 * rest-state tap target shrinks to its bottom ~16px of ears while it shows, below his usual
 * 24px floor. Accepted tradeoff: this is the one page where the two compete for that strip,
 * and the real action (finishing the trip) wins.
 */
export function ListDock({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const [note, setNote] = useState<Note | null>(null);
  const [undoing, startUndo] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback((next: Note) => {
    clearTimeout(timer.current);
    setNote(next);
    timer.current = setTimeout(() => setNote(null), UNDO_MS);
  }, []);

  function undo(token: string) {
    clearTimeout(timer.current);
    startUndo(async () => {
      try {
        const { restored } = await undoTakeOff(token);
        if (restored) setNote(null);
        else show({ text: "Couldn't put it back. It may be gone from the Pantry." });
      } catch (err) {
        show({ text: failureText(err) });
      }
    });
  }

  return (
    <NoteContext value={show}>
      {children}
      {(note || footer) && (
        // data-covers-bottom: tabbing to a control scrolls it clear of this bar (globals.css).
        <div data-covers-bottom className="pointer-events-none fixed inset-x-0 bottom-[var(--bottom-bar-h,0px)] z-10 flex flex-col gap-2 p-4 lg:sticky lg:bottom-4">
          {note && (
            <div
              role="status"
              className="pointer-events-auto mx-auto flex w-full max-w-lg items-center justify-between gap-2 rounded-xl bg-ink py-0.5 pr-1 pl-3 text-sm font-bold text-paper shadow-[3px_3px_0_rgb(31_41_51/0.25)]"
            >
              <span className="min-w-0 truncate py-2.5">{note.text}</span>
              {note.undo && (
                <button
                  type="button"
                  disabled={undoing}
                  onClick={() => undo(note.undo!)}
                  className="inline-flex min-h-11 shrink-0 items-center px-3 text-sun underline disabled:opacity-50 sm:min-h-9"
                >
                  {undoing ? "Putting it back…" : "Undo"}
                </button>
              )}
            </div>
          )}
          {footer}
        </div>
      )}
    </NoteContext>
  );
}

/**
 * The row's − when it's down to one: takes the item off and offers Undo for a few seconds,
 * instead of an "Are you sure?". Outside a ListDock (the dev preview) it just takes it off.
 */
export function TakeOffButton({ itemId, name, className, children }: { itemId: string; name: string; className: string; children: ReactNode }) {
  const show = useContext(NoteContext);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Take ${name} off the list`}
      className={className}
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await takeOffList(itemId);
            if (result) show?.({ text: `Took ${result.name} off the list`, undo: result.undo });
          } catch (err) {
            show?.({ text: failureText(err) });
          }
        })
      }
    >
      {children}
    </button>
  );
}
