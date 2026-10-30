"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import type { PreparedReceipt } from "@/lib/groceries/receipts";
import { field } from "@/components/styles";
import { Picker, type PickerOption } from "@/components/picker";
import { readReceipt, saveReceipt, type ReadState } from "../actions";

const LONG_EDGE = 2000;

/**
 * Shrinks the photo on the phone before it's sent: a 12 MP shot is often 3-6 MB (over the
 * reader's 4 MB limit), and re-encoding through a canvas also drops the photo's metadata,
 * including where it was taken. HEIC from an iPhone arrives as JPEG already (Safari
 * converts it for image inputs).
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.82));
}

export function ReceiptFlow({ purchaseId }: { purchaseId: string | null }) {
  const [state, read, reading] = useActionState<ReadState, FormData>(readReceipt, { status: "idle" });
  const [prepError, setPrepError] = useState<string | null>(null);
  const [preparing, startPrep] = useTransition();

  if (state.status === "ready") return <ReceiptReview receipt={state.receipt} />;

  function onPick(input: HTMLInputElement) {
    const file = input.files?.[0];
    // Cleared so picking the same photo again (after an error) still fires a change.
    input.value = "";
    setPrepError(null);
    if (!file) return;
    startPrep(async () => {
      let blob: Blob;
      try {
        blob = await shrink(file);
      } catch {
        setPrepError("Couldn't open that photo. Try taking it again.");
        return;
      }
      const data = new FormData();
      data.set("photo", new File([blob], "receipt.jpg", { type: "image/jpeg" }));
      if (purchaseId) data.set("purchase", purchaseId);
      read(data);
    });
  }

  const busy = reading || preparing;
  return (
    <div className="mt-6 flex flex-col gap-3">
      {/* No `capture`: iPhones then offer both the camera and the photo library. */}
      <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-ink/30 bg-card p-6 text-center font-bold dark:border-white/30">
        <span className="text-5xl" aria-hidden>
          🧾
        </span>
        {busy ? "Reading the receipt…" : "Take or choose a photo of the receipt"}
        <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => onPick(e.currentTarget)} />
      </label>
      {!busy && (prepError || state.status === "error") && (
        <p role="alert" className="rounded-xl bg-tomato/15 px-3 py-2 text-sm font-semibold">
          {prepError ?? (state.status === "error" ? state.message : "")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Flat, bright and the whole receipt in the frame reads best.</p>
    </div>
  );
}

const SKIP = "";

export function ReceiptReview({ receipt }: { receipt: PreparedReceipt }) {
  const [choice, setChoice] = useState<string[]>(() =>
    receipt.lines.map((l) => (!l.match.skip && l.match.preselect && l.match.productId ? l.match.productId : SKIP)),
  );
  const [storeId, setStoreId] = useState(receipt.storeId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const name = new Map(receipt.pantry.map((p) => [p.id, p.name]));
  const picked = choice.filter(Boolean).length;
  // Phase 57.3: the trip's items, then the whole pantry, as a search (the pantry keeps growing).
  const itemOptions = useMemo<PickerOption[]>(() => {
    const trip = new Set(receipt.tripItems.map((p) => p.id));
    const rest = receipt.pantry.filter((p) => !trip.has(p.id));
    const restGroup = receipt.tripItems.length > 0 ? "Everything else" : "Pantry";
    return [
      ...receipt.tripItems.map((p) => ({ value: p.id, label: p.name, group: "On this trip" })),
      ...rest.map((p) => ({ value: p.id, label: p.name, group: restGroup })),
    ];
  }, [receipt.tripItems, receipt.pantry]);

  function save() {
    setError(null);
    startSave(async () => {
      const result = await saveReceipt({
        purchaseId: receipt.purchaseId,
        storeId: storeId || null,
        date: receipt.date,
        lines: receipt.lines.map((l, i) => ({
          key: l.key,
          productId: choice[i] || null,
          quantity: l.quantity,
          unitCents: l.unitCents,
          totalCents: l.totalCents,
          initialProductId: l.match.productId,
          initialHow: l.match.how,
        })),
      }).catch(() => ({ error: "Couldn't save. Check your signal and try again." }));
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-ink bg-card p-4 dark:border-white/20">
        <label className="flex max-w-full min-w-0 items-center gap-2 text-sm font-bold">
          Store
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={`${field} min-w-0`}>
            <option value="">{receipt.merchant ? `${receipt.merchant} (not a saved store)` : "Not sure"}</option>
            {receipt.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {receipt.date && <span className="text-sm text-muted-foreground">{receipt.date}</span>}
        {receipt.totalCents != null && <span className="ml-auto font-extrabold">Total {formatMoney(receipt.totalCents)}</span>}
        {!receipt.purchaseId && <p className="basis-full text-xs text-muted-foreground">Not linked to a recent trip, so guesses come from the whole Pantry.</p>}
      </div>

      <ul className="divide-y-2 divide-dashed divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink bg-card dark:divide-white/10 dark:border-white/20">
        {receipt.lines.map((l, i) => (
          <li key={i} className={`flex flex-wrap items-center gap-2 px-4 py-3 ${l.match.skip ? "opacity-60" : ""}`}>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-sm break-words">{l.text}</span>
              {l.match.how === "learned" && <span className="text-xs font-bold text-brand-text">Remembered from last time</span>}
              {l.match.how === "suggested" && !l.match.preselect && l.match.productId && (
                <span className="text-xs text-muted-foreground">Maybe {name.get(l.match.productId)}?</span>
              )}
            </span>
            <span className="shrink-0 font-bold">{l.totalCents != null ? formatMoney(l.totalCents) : "—"}</span>
            <Picker
              label={`What is ${l.text}?`}
              options={[{ value: SKIP, label: l.match.skip ? "Not an item" : "Skip" }, ...itemOptions]}
              value={choice[i]}
              disabled={l.match.skip}
              onChange={(next) => setChoice((c) => c.map((v, j) => (j === i ? next : v)))}
              placeholder="Type to find the item"
              className="min-w-0 basis-full sm:basis-56"
            />
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="rounded-xl bg-tomato/15 px-3 py-2 text-sm font-semibold">
          {error}
        </p>
      )}
      <button type="button" onClick={save} disabled={saving} className="rounded-xl border-2 border-ink bg-lime py-3 text-lg font-extrabold text-ink disabled:opacity-50">
        {saving ? "Saving…" : `Save ${picked} price${picked === 1 ? "" : "s"}`}
      </button>
      <p className="text-xs text-muted-foreground">Matches you pick are remembered, so next time they fill in on their own.</p>
    </div>
  );
}
