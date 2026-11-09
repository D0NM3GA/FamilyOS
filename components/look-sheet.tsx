"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLook } from "@/components/look";
import { SubmitButton } from "@/components/submit";
import { btn, btnPrimary } from "@/components/styles";
import { ThemePicker } from "@/components/theme-toggle";
import { captureError } from "@/lib/observability";
import { LOOKS, lookColorOf, lookOf } from "@/lib/looks";
import { dismissLookPrompt, setMyLook } from "@/app/(app)/prefs-actions";

const focusRing = "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50";
const picked = "border-ink bg-sun text-ink dark:border-sun";
const unpicked = "border-ink/15 bg-card dark:border-white/15";

/** Settings' way into the sheet (the name menu has the other). */
export function MyLookButton() {
  const { available, openSheet } = useLook();
  if (!available) return null;
  return (
    <button type="button" onClick={() => openSheet()} className={btn}>
      My look
    </button>
  );
}

/**
 * Phase 58: try a look on over the real page you're on. Tapping changes only what's shown; Keep
 * it saves, and anything else (Put it back, Escape, going to another page) puts it back. Not
 * modal, so the page stays visible and scrollable behind it. The choices are native radios: arrow
 * keys and their meaning for free.
 */
export function LookSheet() {
  const { putBack, closeSheet, welcoming } = useLook();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const pathname = usePathname();
  const openedOn = useRef(pathname);

  function leave() {
    putBack();
    closeSheet();
    if (welcoming) dismissLookPrompt().catch(captureError);
  }
  const leaveRef = useRef(leave);
  useEffect(() => {
    leaveRef.current = leave;
  });

  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    if (pathname !== openedOn.current) leaveRef.current();
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      leaveRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section
      data-look-sheet
      role="dialog"
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 z-40 max-h-[70dvh] space-y-4 overflow-y-auto rounded-t-3xl border-2 border-ink bg-card p-4 text-foreground shadow-2xl md:inset-x-auto md:top-16 md:right-0 md:bottom-0 md:max-h-none md:w-96 md:rounded-none md:rounded-l-3xl dark:border-white/20"
    >
      <div>
        <h2 ref={heading} id={titleId} tabIndex={-1} className="font-heading text-2xl font-extrabold outline-none">
          {welcoming ? "Pick your look" : "My look"}
        </h2>
        <p className="text-sm text-muted-foreground">Tap one and the app tries it on. It&apos;s yours alone, on every device.</p>
      </div>
      <LookChooser
        onSaved={() => {
          putBack();
          closeSheet();
        }}
        onLeave={leave}
      />
    </section>
  );
}

/**
 * The choices, in the sheet or on a page (the setup's own step, where moving on is what leaves).
 * Whatever's being tried goes back when this leaves the screen, unless Keep it saved it.
 */
export function LookChooser({ onSaved, onLeave }: { onSaved?: () => void; onLeave?: () => void }) {
  const { worn, shown, tryOn, putBack } = useLook();
  const look = lookOf(shown.look);
  const color = lookColorOf(look, shown.color);
  const changed = shown.look !== worn.look || shown.color !== worn.color;
  const [failed, setFailed] = useState(false);

  useEffect(() => putBack, [putBack]);

  async function keep(form: FormData) {
    setFailed(false);
    try {
      await setMyLook(form);
    } catch (e) {
      // Thrown from a form action it would reach past the app's error page, this sheet being
      // above it; the look they're trying is still showing, so they can just try again.
      captureError(e);
      setFailed(true);
      return;
    }
    // The server's new value arrives with this action, so what's shown doesn't change.
    putBack();
    onSaved?.();
  }

  return (
    <form action={keep} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Look</legend>
          <div className="grid grid-cols-2 gap-2">
            {LOOKS.map((l) => (
              <label key={l.id} data-poster={l.id} className={`block min-h-20 cursor-pointer rounded-xl border-2 p-2 text-sm ${focusRing} ${shown.look === l.id ? "outline-3 outline-offset-2 outline-ring" : ""} ${shown.look === l.id ? picked : unpicked}`}>
                <input
                  type="radio"
                  name="look"
                  value={l.id}
                  checked={shown.look === l.id}
                  onChange={() => tryOn({ look: l.id, color: lookColorOf(l, l.id === worn.look ? worn.color : null).id })}
                  className="sr-only"
                />
                <b className="block font-bold">{l.name}</b>
                <span className="block text-xs">{l.blurb}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Color</legend>
          <div className="grid grid-cols-2 gap-2">
            {look.colors.map((c) => (
              <label key={c.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 p-2 text-sm font-bold ${focusRing} ${color.id === c.id ? picked : unpicked}`}>
                <input type="radio" name="color" value={c.id} checked={color.id === c.id} onChange={() => tryOn({ look: look.id, color: c.id })} className="sr-only" />
                <span aria-hidden className="h-7 w-10 shrink-0 rounded-lg ring-1 ring-ink/20 dark:ring-white/40" style={{ backgroundColor: c.swatch }} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <p className="text-sm font-bold">Day or night, on this device</p>
          <ThemePicker />
        </div>

        {failed && (
          <p role="alert" className="text-sm font-bold text-destructive">
            That didn&apos;t save. Check your connection and try again.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton className={btnPrimary}>{changed ? "Keep it" : "Done"}</SubmitButton>
          {(onLeave || changed) && (
            <button type="button" onClick={onLeave ?? putBack} className={btn}>
              {changed ? "Put it back" : "Close"}
            </button>
          )}
        </div>
    </form>
  );
}
