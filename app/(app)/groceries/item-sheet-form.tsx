"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";
import { CONTAINERS, SIZE_UNITS, describeSize } from "@/lib/groceries/size";
import { addItem, deletePantryItem, mergeIntoItem, saveItemDetails, type SheetReturn, type SheetState } from "./actions";
import { btn, btnDanger, btnPrimary, chip, field, fieldLabel } from "@/components/styles";
import { RequesterSelect } from "./requester-select";
import { SubmitButton } from "@/components/submit";

type Props = {
  product: {
    id: string;
    name: string;
    brand: string | null;
    imageUrl: string | null;
    barcode: string | null;
    sizeAmount: number | null;
    sizeUnit: string | null;
    container: string | null;
    defaultStoreId: string | null;
    groupId: string | null;
  };
  stores: { id: string; name: string }[];
  sections: { id: string; name: string; emoji: string | null }[];
  usualText: string | null;
  /** Grown-ups only; null for kids or when no receipt has priced it yet. */
  lastPriceText?: string | null;
  listRow: { id: string; requestedById: string | null } | null;
  members: { id: string; firstName: string }[];
  others: { id: string; name: string }[];
  canTidy: boolean;
  returnTo: SheetReturn;
};


function AddToListButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${btnPrimary} w-full sm:w-auto`}>
      {pending ? "Adding…" : "+ Add to the list"}
    </button>
  );
}

/**
 * Only what a person can't guess: how it comes and where we buy it. The section is a
 * suggestion they can change; "usually" is learned from trips and shown, never asked.
 * A bottom sheet on phones, a side panel on laptops. Close, Esc and Back all close it.
 */
export function ItemSheetForm({ product, stores, sections, usualText, lastPriceText = null, listRow, members, others, canTidy, returnTo }: Props) {
  const router = useRouter();
  const [state, action, pending] = useActionState<SheetState, FormData>(
    saveItemDetails.bind(null, product.id, returnTo),
    {},
  );
  const [amount, setAmount] = useState(product.sizeAmount?.toString() ?? "");
  const [unit, setUnit] = useState(product.sizeUnit ?? "");
  const [container, setContainer] = useState(product.container ?? "");
  const [storeId, setStoreId] = useState(product.defaultStoreId ?? "");
  const [addingStore, setAddingStore] = useState(false);

  const dialogRef = useRef<HTMLElement>(null);

  // Phase 44.1: a modal takes focus when it opens, keeps Tab inside it, and gives focus back to
  // whatever had it (the row that opened it) when it closes. Saving remounts the form (it's keyed
  // on the saved version), so the opener is kept outside it and handed on, not re-read.
  useEffect(() => {
    if (sheetsOpen === 0 && !sheetOpener) {
      const at = document.activeElement;
      sheetOpener = at instanceof HTMLElement && at !== document.body ? at : null;
    }
    sheetsOpen++;
    dialogRef.current?.focus();
    return () => {
      sheetsOpen--;
      // A remount mounts the new form before this runs: only a real close gives focus back.
      setTimeout(() => {
        if (sheetsOpen > 0) return;
        const opener = sheetOpener;
        sheetOpener = null;
        if (opener?.isConnected) opener.focus();
      }, 0);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // An open <select> handles its own Escape. In the styled list (Phase 57.2) focus is on one of
      // its options, so anything inside a select counts, not only the select itself.
      if (e.key === "Escape" && !(e.target instanceof Element && e.target.closest("select"))) router.replace(returnTo, { scroll: false });
      if (e.key === "Tab" && dialogRef.current) trapTab(e, dialogRef.current);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, returnTo]);

  const sentence = describeSize({ sizeAmount: Number(amount) || null, sizeUnit: unit || null, container: container || null });

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 lg:items-stretch lg:justify-end" role="presentation">
      <Link href={returnTo} replace scroll={false} aria-label="Close" className="absolute inset-0 cursor-default" tabIndex={-1} />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-sheet-title"
        tabIndex={-1}
        className="relative outline-none max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border-2 border-ink bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl lg:max-h-none lg:w-[26rem] lg:rounded-none lg:rounded-l-3xl dark:border-white/20"
      >
        <form action={action} className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-2">
            <Link href={returnTo} replace scroll={false} className={btn}>
              <X size={16} aria-hidden /> Close
            </Link>
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>

          {state.error && (
            <p role="alert" className="rounded-xl bg-tomato/15 px-3 py-2 text-sm font-semibold text-foreground">
              {state.error}
            </p>
          )}

          <div className="flex items-center gap-3">
            {product.imageUrl ? (
              // Open Food Facts image, already an absolute https URL; not worth next/image's loader config.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imageUrl} alt="" width={56} height={56} loading="lazy" decoding="async" className="h-14 w-14 shrink-0 rounded-xl border-2 border-ink/10 object-contain" />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <h2 id="item-sheet-title" className="sr-only">
                {product.name}
              </h2>
              {/* Not the shared field: its text-sm would fight text-lg here. */}
              <input
                name="name"
                defaultValue={product.name}
                aria-label="Name"
                required
                maxLength={120}
                className="min-h-11 rounded-xl border-2 border-input bg-background px-3 py-2 text-lg font-extrabold focus:border-ring focus:outline-none"
              />
              <input name="brand" defaultValue={product.brand ?? ""} aria-label="Brand" placeholder="Brand (optional)" maxLength={120} className={field} />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className={fieldLabel}>How it comes</legend>
            <div className="flex flex-wrap gap-2">
              <input
                name="sizeAmount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                type="number"
                step="any"
                min="0"
                placeholder="31.1"
                aria-label="Size"
                className={`${field} w-24`}
              />
              <select name="sizeUnit" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit" className={`${field} min-w-24`}>
                <option value="">unit</option>
                {SIZE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <select name="container" value={container} onChange={(e) => setContainer(e.target.value)} aria-label="Container" className={`${field} min-w-32`}>
                <option value="">container</option>
                {CONTAINERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <p className="font-hand text-lg text-muted-foreground" aria-live="polite">
              {sentence ? `“${/^[0-9]/.test(sentence) ? "A " : ""}${sentence}”` : "e.g. a 31.1 lb bag, a 1 gal jug, a 12-roll pack"}
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className={fieldLabel}>Where we buy it</legend>
            {/* A typed new store wins on the server; left blank, the picked chip stays. */}
            <input type="hidden" name="storeId" value={storeId} />
            <div className="flex flex-wrap gap-2">
              {stores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={storeId === s.id}
                  onClick={() => {
                    setAddingStore(false);
                    setStoreId(storeId === s.id ? "" : s.id);
                  }}
                  className={chip}
                >
                  {s.name}
                </button>
              ))}
              {addingStore ? (
                <input name="newStore" autoFocus placeholder="Store name" aria-label="New store name" maxLength={60} className={field} />
              ) : (
                <button type="button" onClick={() => setAddingStore(true)} className={`${chip} border-dashed text-muted-foreground`}>
                  + store
                </button>
              )}
            </div>
          </fieldset>

          <label className="flex flex-col gap-2">
            <span className={fieldLabel}>Section</span>
            <select name="groupId" defaultValue={product.groupId ?? ""} className={field}>
              <option value="">No section</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji ? `${s.emoji} ` : ""}
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className={fieldLabel}>Usually</span>
            <p className="text-sm">{usualText ?? "Learns from your trips."}</p>
          </div>

          {canTidy && (
            <div className="flex flex-col gap-1">
              <span className={fieldLabel}>Last paid</span>
              <p className="text-sm">{lastPriceText ?? "Snap a receipt after a trip to see prices."}</p>
            </div>
          )}

          <label className="flex flex-col gap-2">
            <span className={fieldLabel}>Barcode</span>
            <input name="barcode" defaultValue={product.barcode ?? ""} inputMode="numeric" maxLength={32} placeholder="Optional" className={field} />
            <span className="text-xs text-muted-foreground">Scanned details come from Open Food Facts (ODbL).</span>
          </label>
        </form>

        {listRow ? (
          <div className="mt-5 flex items-center justify-between gap-2 border-t-2 border-dashed border-ink/15 pt-4">
            <label htmlFor="requested-by" className={fieldLabel}>
              On the list · who&apos;s it for
            </label>
            <RequesterSelect id="requested-by" itemId={listRow.id} currentId={listRow.requestedById} members={members} />
          </div>
        ) : (
          // Its own form, outside the details form above: forms can't nest. The page
          // revalidates and this turns into "On the list · who's it for".
          <form action={addItem.bind(null, { productId: product.id })} className="mt-5 border-t-2 border-dashed border-ink/15 pt-4">
            <AddToListButton />
          </form>
        )}

        {canTidy && (
          <div className="mt-5 flex flex-col gap-3 border-t-2 border-dashed border-ink/15 pt-4">
            {others.length > 0 && (
              <form
                action={mergeIntoItem.bind(null, product.id, returnTo)}
                onSubmit={(e) => {
                  const picked = others.find((o) => o.id === new FormData(e.currentTarget).get("mergeId"));
                  if (!picked || !confirm(`Fold “${picked.name}” into “${product.name}”? Its trips and list rows move here and “${picked.name}” is removed.`)) {
                    e.preventDefault();
                  }
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <label htmlFor="merge-pick" className="text-sm font-bold">
                  Same as…
                </label>
                <select id="merge-pick" name="mergeId" required defaultValue="" className={`${field} min-w-0 flex-1`}>
                  <option value="" disabled>
                    pick the duplicate
                  </option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <SubmitButton className={btn}>
                  Merge into this
                </SubmitButton>
              </form>
            )}
            <form
              action={deletePantryItem.bind(null, product.id, returnTo)}
              onSubmit={(e) => {
                if (!confirm(`Remove ${product.name} from the Pantry and the list? Past trips keep its name.`)) e.preventDefault();
              }}
            >
              <SubmitButton className={btnDanger}>
                Remove from the Pantry
              </SubmitButton>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}

// The control that opened the item sheet, kept across the form's remounts (see the focus effect).
let sheetOpener: HTMLElement | null = null;
let sheetsOpen = 0;

/** Wraps Tab and Shift+Tab around the dialog's own controls, so focus can't wander behind it. */
function trapTab(e: KeyboardEvent, dialog: HTMLElement) {
  const controls = [...dialog.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")].filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const at = document.activeElement;
  if (e.shiftKey && (at === first || at === dialog)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (at === last || !dialog.contains(at))) {
    e.preventDefault();
    first.focus();
  }
}
