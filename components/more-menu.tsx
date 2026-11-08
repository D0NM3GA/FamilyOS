"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, type ComponentProps, type ReactNode, type RefObject, type ToggleEvent } from "react";
import { btn, menuItem } from "./styles";

/**
 * The less-used things behind a ⋯, so a row or page shows one main action. A native popover: the
 * browser closes it on Esc or a tap elsewhere, and hands focus back to the button.
 */
export function MoreMenu({
  label,
  big = false,
  face,
  triggerClassName,
  triggerRef,
  children,
}: {
  label: string;
  big?: boolean;
  /** Phase 59.1a: what the button shows instead of ⋯ (the status pill), with its own classes. */
  face?: ReactNode;
  triggerClassName?: string;
  /** For a caller that needs to hand focus back to the ⋯ (a question it showed after the menu closed). */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const id = useId();
  const ownTrigger = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? ownTrigger;
  const panel = useRef<HTMLDivElement>(null);
  const stopWatching = useRef<() => void>(() => {});
  useEffect(() => () => stopWatching.current(), []);

  // Before it shows, so it never paints in the wrong place. Under the button, right edges lined up.
  const place = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box || !panel.current) return;
    panel.current.style.top = `${box.bottom + 4}px`;
    panel.current.style.right = `${Math.max(8, document.documentElement.clientWidth - box.right)}px`;
  };

  const onToggle = (event: ToggleEvent<HTMLDivElement>) => {
    stopWatching.current();
    stopWatching.current = () => {};
    const el = panel.current;
    if (event.newState !== "open" || !el) return;
    // No room below: open upward.
    const box = trigger.current?.getBoundingClientRect();
    if (box && el.getBoundingClientRect().bottom > innerHeight - 8) {
      el.style.top = `${Math.max(8, box.top - el.offsetHeight - 4)}px`;
    }
    // Too wide to reach left from a button near that edge: slide over.
    const overflow = el.offsetWidth + parseFloat(el.style.right) + 8 - document.documentElement.clientWidth;
    if (overflow > 0) el.style.right = `${Math.max(8, parseFloat(el.style.right) - overflow)}px`;
    el.querySelector<HTMLElement>("a, button")?.focus();
    // It's fixed to the screen, so it can't follow its button when the page scrolls.
    const close = () => el.hidePopover();
    document.addEventListener("scroll", close, { capture: true, passive: true, once: true });
    stopWatching.current = () => document.removeEventListener("scroll", close, { capture: true });
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={id}
        aria-label={label}
        title={label}
        className={triggerClassName ?? `${btn} inline-flex shrink-0 items-center justify-center ${big ? "size-14" : "min-w-11"}`}
      >
        {face ?? <MoreHorizontal size={big ? 22 : 18} aria-hidden />}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="group"
        aria-label={label}
        onBeforeToggle={(event) => event.newState === "open" && place()}
        onToggle={onToggle}
        // Tabbing out closes it, or it floats over the next row. No target is a tap, which the browser handles.
        onBlur={(event) => {
          // Not when focus goes to its own button: that tap toggles it closed itself, and closing it
          // here first made the same tap open it again.
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) event.currentTarget.hidePopover();
        }}
        onClick={(event) => {
          if ((event.target as Element).closest("a, button")) panel.current?.hidePopover();
        }}
        className="ui-menu fixed inset-auto m-0 min-w-44 max-w-[calc(100vw-1rem)] rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-ink/15 dark:ring-white/20"
      >
        {children}
      </div>
    </>
  );
}

/** A page's Print and Export: a plain button when there's only one, so a ⋯ never hides a single thing. */
export function PageMore({ items }: { items: { label: string; href: ComponentProps<typeof Link>["href"] }[] }) {
  if (items.length === 0) return null;
  if (items.length === 1) {
    return (
      <Link href={items[0].href} className={btn}>
        {items[0].label}
      </Link>
    );
  }
  return (
    <MoreMenu label="More">
      {items.map((item) => (
        <Link key={item.label} href={item.href} className={menuItem}>
          {item.label}
        </Link>
      ))}
    </MoreMenu>
  );
}
