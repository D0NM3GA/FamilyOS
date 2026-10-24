"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Camera, Plus } from "lucide-react";
import { btn, btnPrimary, field } from "@/components/styles";
import { addItem, addItemByBarcode, searchProductsAutocomplete, type BarcodeAddResult } from "./actions";
import { BarcodeScanner } from "./barcode-scanner";
import { useCameraSupported } from "@/components/camera";
import { useAppName } from "@/components/family-look";

type Suggestion = { id: string; name: string; detail: string | null };

// Digits only, barcode-length: a USB scanner (keyboard wedge) or someone typing the code.
const LOOKS_LIKE_BARCODE = /^\d{8,14}$/;

/** The typed part stays plain, the rest of the match is bold (Baymard's typeahead advice). */
function Highlight({ name, query }: { name: string; query: string }) {
  const at = name.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0 || !query.trim()) return <b>{name}</b>;
  const end = at + query.trim().length;
  return (
    <span>
      <b>{name.slice(0, at)}</b>
      <span className="font-normal">{name.slice(at, end)}</span>
      <b>{name.slice(end)}</b>
    </span>
  );
}

/**
 * Phase 22: the one way onto the list. Type and pick a suggestion, or press Enter to add
 * exactly what you typed (it becomes a Pantry item). 📷 Scan opens the camera; digits from a
 * barcode scanner are looked up too. A barcode nobody knows asks for a name once.
 */
export function AddBox() {
  const appName = useAppName();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [needsNameFor, setNeedsNameFor] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pending, startTransition] = useTransition();
  const cameraSupported = useCameraSupported();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef("");

  useEffect(() => {
    const term = query.trim();
    if (!term) return;
    if (LOOKS_LIKE_BARCODE.test(term)) {
      // Barcode digits: Enter looks the code up, so no stale suggestion may stay picked.
      latest.current = "";
      const t = setTimeout(() => {
        setSuggestions([]);
        setOpen(false);
        setActive(-1);
      });
      return () => clearTimeout(t);
    }
    latest.current = term;
    const timer = setTimeout(async () => {
      const results = await searchProductsAutocomplete(term);
      if (latest.current !== term) return; // a slower, older search came back last
      setSuggestions(results);
      setActive(-1);
      setOpen(results.length > 0);
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  function reset() {
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    setActive(-1);
    latest.current = "";
  }

  function onChange(value: string) {
    setQuery(value);
    setMessage(null);
    if (!value.trim()) {
      setSuggestions([]);
      setOpen(false);
    }
  }

  function handleBarcode(result: BarcodeAddResult, code: string) {
    if (result.kind === "added") {
      setMessage(`Added ${result.productName}.`);
      setNeedsNameFor(null);
      setName("");
    } else if (result.kind === "unknown") {
      setNeedsNameFor(code);
    } else {
      setMessage(result.message);
    }
  }

  // Guarded by `pending`: a keyboard-wedge scanner or a double Enter can fire twice before
  // the disabled state paints, and adds are deliberately not idempotent.
  function submit() {
    if (pending) return;
    const picked = active >= 0 ? suggestions[active] : null;
    const text = query.trim();
    if (!picked && !text) return;
    reset();
    startTransition(async () => {
      if (picked) await addItem({ productId: picked.id });
      else if (LOOKS_LIKE_BARCODE.test(text)) handleBarcode(await addItemByBarcode(text), text);
      else await addItem({ name: text });
    });
    inputRef.current?.focus();
  }

  function pick(s: Suggestion) {
    if (pending) return;
    reset();
    startTransition(() => addItem({ productId: s.id }));
    inputRef.current?.focus();
  }

  function submitName() {
    if (pending || !needsNameFor || !name.trim()) return;
    const code = needsNameFor;
    const given = name;
    startTransition(async () => handleBarcode(await addItemByBarcode(code, given), code));
  }

  const onScannedUnknown = useCallback((code: string) => {
    setScanning(false);
    setNeedsNameFor(code);
    setMessage(null);
  }, []);

  if (scanning) {
    return (
      <div className="rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
        <BarcodeScanner onUnknown={onScannedUnknown} onDone={() => setScanning(false)} />
      </div>
    );
  }

  if (needsNameFor) {
    return (
      <div className="rounded-2xl border-2 border-ink bg-card p-4 dark:border-white/20">
        <p className="font-extrabold">We don&apos;t know this one yet</p>
        <p className="text-sm text-muted-foreground">Name it once and {appName} remembers barcode {needsNameFor} next time.</p>
        <div className="mt-3 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitName();
              }
            }}
            placeholder="What is it? e.g. Treats for Pepper"
            aria-label="What is it?"
            maxLength={120}
            autoFocus
            className={`${field} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={submitName}
            disabled={pending || !name.trim()}
            className={`${btnPrimary} shrink-0`}
          >
            {pending ? "Adding…" : "Add to the list"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setNeedsNameFor(null);
            setName("");
          }}
          className={`${btn} mt-2`}
        >
          Never mind
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-2xl border-2 border-ink bg-card p-1.5 pl-3 shadow-[3px_3px_0_rgb(31_41_51/0.15)] focus-within:ring-2 focus-within:ring-ring dark:border-white/20">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "ArrowDown" && suggestions.length > 0) {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp" && open) {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, -1));
            } else if (e.key === "Escape") {
              setOpen(false);
              setActive(-1);
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label="Add to the list"
          placeholder="Add something…"
          maxLength={120}
          enterKeyHint="done"
          className="min-h-11 min-w-0 flex-1 bg-transparent py-2 text-base focus:outline-none sm:min-h-9"
        />
        {cameraSupported && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setScanning(true);
            }}
            className={`${btn} shrink-0`}
          >
            <Camera size={16} aria-hidden />
            Scan
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={pending || !query.trim()}
          aria-label="Add"
          className={`${btnPrimary} shrink-0`}
        >
          <Plus size={18} aria-hidden />
          <span className="hidden sm:inline">Add</span>
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border-2 border-ink bg-card py-1 shadow-lg dark:border-white/20"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-4 py-2.5 ${i === active ? "bg-muted" : "hover:bg-muted"}`}
            >
              <Highlight name={s.name} query={query} />
              {s.detail && <span className="truncate text-sm text-muted-foreground">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="mt-1 min-h-5 text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
