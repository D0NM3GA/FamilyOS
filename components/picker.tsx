"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { field } from "@/components/styles";
import { filterOptions, groupOptions, moveActive, type PickerOption } from "@/lib/picker";

export type { PickerOption } from "@/lib/picker";

/**
 * Phase 57.3: a searchable list for the few long or rich choices, where a native <select> is
 * hard work (400 time zones, the whole pantry) or can't show enough (a category's emoji). Every
 * other dropdown stays a styled native one (app/globals.css, 57.1).
 *
 * An ARIA 1.2 combobox, modelled on the grocery add box: type to filter, arrows, Home/End,
 * Enter to pick, Escape to close (and only that: inside a sheet or dialog the sheet stays open).
 * It must end on one of the options: typing that matches nothing picks nothing.
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
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;

  const selected = options.find((o) => o.value === current) ?? null;
  const shownText = (o: PickerOption | null) => (o ? `${o.emoji ? `${o.emoji} ` : ""}${o.label}` : "");
  const { shown, more } = useMemo(() => filterOptions(options, editing ? query : ""), [options, editing, query]);
  const groups = useMemo(() => groupOptions(shown), [shown]);
  // Rows in the order they're drawn (grouping can move them), which the arrows walk.
  const rows = useMemo(() => groups.flatMap((g) => g.options), [groups]);

  function choose(next: string) {
    if (!controlled) setInner(next);
    if (next !== current) onChange?.(next);
  }

  function close() {
    setOpen(false);
    setEditing(false);
    setQuery("");
    setActive(-1);
  }

  function pick(option: PickerOption) {
    choose(option.value);
    close();
  }

  function openList() {
    if (disabled) return;
    setEditing(true);
    setOpen(true);
    const all = groupOptions(filterOptions(options, "").shown).flatMap((g) => g.options);
    setActive(Math.max(0, all.findIndex((o) => o.value === current)));
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

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

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
        value={editing ? query : shownText(selected)}
        placeholder={editing && selected ? shownText(selected) : placeholder}
        onFocus={openList}
        onClick={() => !open && openList()}
        onChange={(e) => {
          setEditing(true);
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
            // Never submit the form from a half-typed search.
            if (open) e.preventDefault();
            if (open && active >= 0 && rows[active]) pick(rows[active]);
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
      {selected && !required && !disabled && (
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
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          aria-labelledby={label ? undefined : inputId}
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl border-2 border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {rows.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">Nothing matches “{query}”.</div>}
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
                  onMouseMove={() => setActive(row)}
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
          {more > 0 && <div className="px-3 py-2 text-xs text-muted-foreground">{more} more: keep typing to narrow it down.</div>}
        </div>
      )}
    </div>
  );
}
