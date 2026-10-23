"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { iconBtn } from "@/components/styles";

type Sheet = { close: (note?: string) => void };
const SheetContext = createContext<Sheet | null>(null);

/** The open row's sheet, for a control inside it that's done (null outside a sheet). */
export const useSheet = () => useContext(SheetContext);

/**
 * One Activity row: a single tap target showing the charge (name, amount, day, category), which
 * opens everything you can do to it in one native <dialog>: a sheet up from the bottom on a
 * phone, a card in the middle from `sm` up. Esc, ✕ and a tap outside close it.
 *
 * The panel's contents are server-rendered children (the existing forms and server actions),
 * so the dialog only adds opening and closing. They're mounted the first time the sheet opens
 * (a month can have hundreds of rows) and kept after, so a half-filled form survives closing.
 * A control that finishes its job can close the sheet with a note (useSheet), which shows
 * under the row for a few seconds as the answer.
 */
export function TxnSheet({ summary, label, title, children }: { summary: ReactNode; label: string; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [note, setNote] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);

  const close = useCallback((n?: string) => {
    ref.current?.close();
    if (n) setNote(n);
  }, []);
  const sheet = useMemo(() => ({ close }), [close]);

  return (
    <SheetContext.Provider value={sheet}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={label}
        onClick={() => {
          setOpened(true);
          ref.current?.showModal();
        }}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {summary}
        <span aria-hidden className="shrink-0 text-lg font-bold text-muted-foreground">
          ›
        </span>
      </button>
      {/* Always in the page, so the answer is read out when it appears. */}
      <p role="status" className={note ? "px-4 pb-2 text-xs font-bold text-brand-text" : "sr-only"}>
        {note ? `✓ ${note}` : ""}
      </p>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        // A tap on the backdrop lands on the dialog itself, not its contents. So does a click on
        // the dialog's own scrollbar in Firefox, so only a click outside its box closes it.
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const box = e.currentTarget.getBoundingClientRect();
          if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) e.currentTarget.close();
        }}
        className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-full overflow-y-auto overscroll-contain rounded-t-3xl border-2 border-b-0 border-ink bg-card p-0 text-foreground shadow-xl backdrop:bg-ink/40 sm:inset-0 sm:m-auto sm:h-fit sm:max-w-lg sm:rounded-3xl sm:border-b-2 dark:border-white/20"
      >
        <div className="sticky top-0 z-10 flex items-start gap-2 border-b-2 border-dashed border-ink/10 bg-card py-2 pr-2 pl-4 dark:border-white/10">
          <h2 id={titleId} className="min-w-0 flex-1 py-2 text-lg font-extrabold break-words">
            {title}
          </h2>
          <button type="button" className={iconBtn} aria-label="Close" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-5 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{opened && children}</div>
      </dialog>
    </SheetContext.Provider>
  );
}
