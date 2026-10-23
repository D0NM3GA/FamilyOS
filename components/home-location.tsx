"use client";

import { useState, useTransition } from "react";
import { MapPin } from "lucide-react";
import { ConfirmAction } from "@/components/submit";
import { btn, btnPrimary, field } from "@/components/styles";
import { checkHomeLocation, clearHomeLocation, saveHomeLocation, type HomeInput } from "@/lib/home-location/actions";

type Step =
  | { kind: "start" }
  | { kind: "locating" }
  | { kind: "zip"; note?: string }
  | { kind: "confirm"; input: HomeInput; nearZip: string }
  | { kind: "saved"; nearZip: string };

/** About a kilometre: the phone rounds before anything leaves it (the server rounds again). */
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Phase 45.1: "Where's home?" for admins, in Settings → Household, the guided setup and the
 * Chores page. A phone's location (the browser asks first) or a typed ZIP code, a confirm step
 * that says which ZIP code it landed near, then save. Never coordinates on screen.
 */
export function HomeLocation({ nearZip, onSaved }: { nearZip: string | null; onSaved?: (nearZip: string) => void }) {
  const [step, setStep] = useState<Step>(nearZip ? { kind: "saved", nearZip } : { kind: "start" });
  const [zip, setZip] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // What's saved now, so "Change" can be called off without saving again.
  const [savedZip, setSavedZip] = useState<string | null>(nearZip);
  const keep = savedZip && (
    <button type="button" className={btn} onClick={() => setStep({ kind: "saved", nearZip: savedZip })} disabled={pending}>
      Keep ZIP {savedZip}
    </button>
  );

  function confirm(input: HomeInput) {
    setError(null);
    startTransition(async () => {
      const result = await checkHomeLocation(input);
      if (result.ok) setStep({ kind: "confirm", input, nearZip: result.nearZip });
      else {
        setError(result.error);
        setStep(input.via === "zip" ? { kind: "zip" } : { kind: "start" });
      }
    });
  }

  function useDevice() {
    setError(null);
    if (!("geolocation" in navigator)) {
      setStep({ kind: "zip", note: "This browser can't share its location. A ZIP code works just as well." });
      return;
    }
    setStep({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => confirm({ via: "device", latitude: round(pos.coords.latitude), longitude: round(pos.coords.longitude) }),
      (err) =>
        setStep({
          kind: "zip",
          note:
            err.code === err.PERMISSION_DENIED
              ? "No problem: this device didn't share its location. A ZIP code works just as well."
              : "This device couldn't find its location just now. A ZIP code works just as well.",
        }),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  }

  function save(input: HomeInput) {
    setError(null);
    startTransition(async () => {
      const result = await saveHomeLocation(input);
      if (!result.ok) return setError(result.error);
      setStep({ kind: "saved", nearZip: result.nearZip });
      setSavedZip(result.nearZip);
      onSaved?.(result.nearZip);
    });
  }

  return (
    <div className="space-y-3">
      {step.kind === "saved" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 basis-56 text-sm text-foreground" role="status">
            Home is set near ZIP <span className="font-bold">{step.nearZip}</span>.
          </p>
          <button type="button" className={btn} onClick={() => setStep({ kind: "start" })}>
            Change
          </button>
          <ConfirmAction
            question="Forget where home is? Outdoor chores stop warning about rain."
            yes="Yes, forget it"
            pending={pending}
            onConfirm={() =>
              startTransition(async () => {
                await clearHomeLocation();
                setSavedZip(null);
                setStep({ kind: "start" });
              })
            }
          >
            Forget it
          </ConfirmAction>
        </div>
      )}

      {(step.kind === "start" || step.kind === "locating") && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnPrimary} onClick={useDevice} disabled={step.kind === "locating" || pending} aria-busy={step.kind === "locating" || undefined}>
            <MapPin className="size-4" aria-hidden="true" />
            {step.kind === "locating" ? "Finding this device…" : "Use this device's location"}
          </button>
          <button type="button" className={btn} onClick={() => setStep({ kind: "zip" })} disabled={pending}>
            Type a ZIP code instead
          </button>
          {keep}
        </div>
      )}

      {step.kind === "zip" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            confirm({ via: "zip", zip });
          }}
        >
          {step.note && (
            <p role="status" className="rounded-xl bg-sun/30 px-3 py-2 text-sm text-foreground">
              {step.note}
            </p>
          )}
          <label htmlFor="home-zip" className="block text-sm font-bold text-foreground">
            ZIP code
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="home-zip"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              className={`${field} w-32 tracking-widest`}
            />
            <button type="submit" className={btnPrimary} disabled={zip.length !== 5 || pending} aria-busy={pending || undefined}>
              {pending ? "Finding…" : "Find it"}
            </button>
            <button type="button" className={btn} onClick={() => setStep({ kind: "start" })} disabled={pending}>
              Use this device instead
            </button>
            {keep}
          </div>
          <p className="text-xs text-muted-foreground">Looked up on your family&apos;s own server from public Census data. Nothing is sent anywhere.</p>
        </form>
      )}

      {step.kind === "confirm" && (
        <div className="space-y-3 rounded-xl bg-muted p-3">
          <p className="text-sm text-foreground" role="status">
            Home would be set near ZIP <span className="font-bold">{step.nearZip}</span>
            {step.input.via === "device" ? ", from this device, rounded to about a kilometre." : "."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => save(step.input)} disabled={pending} aria-busy={pending || undefined}>
              {pending ? "Saving…" : "Looks right, save it"}
            </button>
            <button type="button" className={btn} onClick={() => setStep({ kind: "zip" })} disabled={pending}>
              Not right? Type a ZIP code
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
