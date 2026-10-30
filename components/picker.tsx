"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { field } from "@/components/styles";
import { groupOptions, moveActive, pickerRows, type PickerOption } from "@/lib/picker";

export type { PickerOption } from "@/lib/picker";

// Below this much room under the box (px), the list opens upward instead, if there's more room
// there: inside a sheet the list would otherwise open into the sheet's scroll space.
const LIST_ROOM = 300;

/**
 * Phase 57.3: a searchable list for the few long or rich choices, where a native <select> is
 * hard work (400 time zones, the whole pantry) or can't show enough (a category's emoji). Every
 * other dropdown stays a styled native one (app/globals.css, 57.1).
 *
 * An ARIA 1.2 combobox, modelled on the grocery add box: focus opens the list with the current
 * choice still in the box (selected, so typing replaces it) and highlighted; typing filters;
 * arrows and Home/End move; Enter picks; Escape closes the list (and only that: inside a sheet or
 * dialog the sheet stays open). It must end on one of the options: typing that matches nothing
 * keeps what was chosen. Result counts are announced in a polite live region.
 *
 * Two ways to use it: controlled (`value` and `onChange`, for pages that set it from code) or
 * in a form (`name`, with `defaultValue`): a hidden input carries the value, a required one
 * blocks the form with the browser's own message (set on the text box, since a hidden input
 * ignores `required`), and it goes back to `defaultValue` when its form resets, as React does
 * after a successful action.
 */
export function Picker({
  options,
  value,
  defaultValue = "",
  onChange,
  name,
  required = false,
  disabled = false,
  id,
  label,
  placeholder = "Type to search",
  requiredMessage = "Pick one from the list.",
  className = "",
}: {
  options: readonly PickerOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  /** For a <label htmlFor>; otherwise pass `label`. */
  id?: string;
  /** An accessible name when there's no visible <label>. */
  label?: string;
  placeholder?: string;
  requiredMessage?: string;
  /** On the wrapper: width and layout ("w-full", "min-w-0 flex-1"). */
  className?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const [query, setQuery] = useState("");
  // True once something's been typed since the list opened: only then does the box show what's
  // typed and the list filter by it.
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const [active, setActive] = useState(-1);
  // The list's name: `label`, or the visible <label>'s text, read when it opens.
  const [listName, setListName] = useState<string | undefined>(label);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;

  const selected = options.find((o) => o.value === current) ?? null;
  const shownText = (o: PickerOption | null) => (o ? `${o.emoji ? `${o.emoji} ` : ""}${o.label}` : "");
  const { shown, more } = useMemo(() => pickerRows(options, typed ? query : null, selected), [options, typed, query, selected]);
  const groups = useMemo(() => groupOptions(shown), [shown]);
  // Rows in the order they're drawn (grouping can move them), which the arrows walk.
  const rows = useMemo(() => groups.flatMap((g) => g.options), [groups]);

  function choose(next: string) {
    if (!controlled) setInner(next);
    if (next !== current) onChange?.(next);
  }

  function close() {
    setOpen(false);
    setTyped(false);
    setQuery("");
    setActive(-1);
  }

  function pick(option: PickerOption) {
    choose(option.value);
    close();
  }

  function openList() {
    if (disabled || open) return;
    if (blurTimer.current) clearTimeout(blurTimer.current);
    const input = inputRef.current;
    if (input) {
      const box = input.getBoundingClientRect();
      const below = window.innerHeight - box.bottom;
      setUpward(below < LIST_ROOM && box.top > below);
      setListName(label ?? input.labels?.[0]?.textContent?.trim() ?? undefined);
      input.select();
    }
    setTyped(false);
    setOpen(true);
    // The current choice is highlighted; with none, nothing is, so Enter only closes the list.
    const drawn = groupOptions(pickerRows(options, null, selected).shown).flatMap((g) => g.options);
    setActive(drawn.findIndex((o) => o.value === current));
  }

  // The browser's "please fill in" check runs on the text box, since the hidden input that
  // carries the value is skipped by it.
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !current ? requiredMessage : "");
  }, [required, current, requiredMessage]);

  // Back to the starting value when the form resets (React resets a form after its action).
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form || controlled) return;
    const onReset = () => {
      setInner(defaultValue);
      setQuery("");
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [controlled, defaultValue]);

  // Keep the highlighted row in view by scrolling the list itself, never the page or the sheet.
  useEffect(() => {
    const list = listRef.current;
    const row = open && active >= 0 ? document.getElementById(`${listId}-${active}`) : null;
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [open, active, listId]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const status = !open || !typed ? "" : rows.length === 0 ? `Nothing matches “${query}”.` : `${rows.length}${more ? "+" : ""} result${rows.length === 1 && !more ? "" : "s"}.`;

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-required={required || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={typed ? query : shownText(selected)}
        placeholder={typed && selected ? shownText(selected) : placeholder}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => {
          if (!open) openList();
          setTyped(true);
          setOpen(true);
          setQuery(e.target.value);
          setActive(0);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(close, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || ((e.key === "Home" || e.key === "End") && open)) {
            e.preventDefault();
            if (!open) return openList();
            setActive((i) => moveActive(i, e.key, rows.length));
          } else if (e.key === "Enter") {
            // Never submit the form from an open list or a half-typed search.
            if (open) e.preventDefault();
            if (open && active >= 0 && rows[active]) pick(rows[active]);
            else if (open) close();
          } else if (e.key === "Escape" && open) {
            // Close the list only: not the sheet or dialog it's in.
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === "Tab") {
            close();
          }
        }}
        className={`${field} w-full pr-16`}
      />
      {name && <input type="hidden" name={name} value={current} />}
      {selected && selected.value !== "" && !required && !disabled && (
        <button
          type="button"
          aria-label="Clear"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            choose("");
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-8 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X size={14} aria-hidden />
        </button>
      )}
      <span
        aria-hidden
        className={`pointer-events-none absolute top-1/2 right-3.5 size-2 -translate-y-3/4 rotate-45 border-r-2 border-b-2 border-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${open ? "translate-y-[-25%] rotate-[225deg]" : ""}`}
      />
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      {open && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className={`absolute z-30 w-full overflow-hidden rounded-2xl border-2 border-border bg-popover text-popover-foreground shadow-lg ${upward ? "bottom-full mb-1" : "mt-1"}`}
        >
          {rows.length > 0 && (
            <div ref={listRef} id={listId} role="listbox" aria-label={listName} className="max-h-72 overflow-y-auto p-1">
              {groups.map((g, gi) => {
                const offset = groups.slice(0, gi).reduce((n, x) => n + x.options.length, 0);
                const items = g.options.map((o, i) => {
                  const row = offset + i;
                  const isSelected = o.value === current;
                  return (
                    <div
                      key={o.value}
                      id={`${listId}-${row}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseMove={(e) => {
                        // Only a real move of the pointer, not the event Chrome fires when the
                        // list scrolls under a resting cursor.
                        const last = lastPointer.current;
                        lastPointer.current = { x: e.clientX, y: e.clientY };
                        if (last && last.x === e.clientX && last.y === e.clientY) return;
                        setActive(row);
                      }}
                      onClick={() => pick(o)}
                      className={`flex cursor-pointer items-baseline gap-2 rounded-xl px-3 py-2 text-sm ${row === active ? "bg-[color-mix(in_srgb,currentColor_12%,transparent)] outline-2 -outline-offset-2 outline-ring" : ""}`}
                    >
                      <span aria-hidden className="w-4 shrink-0 text-brand-text">
                        {isSelected ? "✓" : ""}
                      </span>
                      <span className={`min-w-0 flex-1 ${isSelected ? "font-bold" : ""}`}>
                        {o.emoji && <span aria-hidden>{o.emoji} </span>}
                        {o.label}
                      </span>
                      {o.detail && <span className="shrink-0 text-xs text-muted-foreground">{o.detail}</span>}
                    </div>
                  );
                });
                if (!g.group) return items;
                const headId = `${listId}-g${gi}`;
                return (
                  <div key={headId} role="group" aria-labelledby={headId}>
                    <div id={headId} className="px-3 pt-2 pb-1 text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
                      {g.group}
                    </div>
                    {items}
                  </div>
                );
              })}
            </div>
          )}
          {/* Outside the listbox (only options belong in it); the live region above says these. */}
          {rows.length === 0 && (
            <p aria-hidden className="px-4 py-3 text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          )}
          {more > 0 && (
            <p aria-hidden className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              {more} more: keep typing to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
