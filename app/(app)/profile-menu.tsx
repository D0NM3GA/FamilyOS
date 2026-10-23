"use client";

import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { Avatar } from "@/components/avatar";
import { BUNSON_VOLUMES, VIEW_MODES } from "@/lib/view-prefs";
import { setMyBunsonVolume, setMyViewMode } from "./prefs-actions";
import { captureError } from "@/lib/observability";
import { useFamilyLook } from "@/components/family-look";

export type Prefs = { viewMode: "BIG" | "FULL"; bunsonVolume: "CHATTY" | "CHEERS" | "OFF" };

/** A row of real radio inputs styled as a segmented control (keyboard and screen-reader friendly). */
function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="font-heading text-sm font-bold">{legend}</legend>
      <div
        className="mt-1.5 grid overflow-hidden rounded-xl border-2 border-ink dark:border-white/25"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o, i) => (
          <label
            key={o.value}
            className={`grid cursor-pointer place-items-center px-1 py-2 text-center text-xs font-extrabold transition has-[:checked]:bg-sun has-[:checked]:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-ring hover:bg-muted ${
              i > 0 ? "border-l-2 border-ink dark:border-white/25" : ""
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
            {o.hint && <span className="text-[11px] font-semibold opacity-75">{o.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ProfileMenu({
  personId,
  activeName,
  hasPhoto,
  color,
  prefs,
}: {
  personId: string;
  activeName: string;
  hasPhoto: boolean;
  color: { bg: string; fg: string };
  /** Omitted by the dev-preview shell, which has no signed-in profile to save to. */
  prefs?: Prefs;
}) {
  const { appName, mascot } = useFamilyLook();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [, startTransition] = useTransition();
  // Shows the new choice instantly; the layout revalidation then brings the saved value
  // (and the re-rendered page) back as the real prop.
  const [optimistic, setOptimistic] = useOptimistic(prefs);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Tabbing out of the popover closes it too, so it never lingers behind focus.
    const onFocusIn = (e: FocusEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  function save(patch: Partial<Prefs>) {
    if (!optimistic) return;
    startTransition(async () => {
      setOptimistic({ ...optimistic, ...patch });
      try {
        if (patch.viewMode) await setMyViewMode(patch.viewMode);
        if (patch.bunsonVolume) await setMyBunsonVolume(patch.bunsonVolume);
      } catch (err) {
        console.error("[profile-menu] saving preference failed", err);
        captureError(err);
      }
    });
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-chrome-hover sm:min-h-0"
      >
        <Avatar
          personId={personId}
          hasPhoto={hasPhoto}
          initial={activeName}
          size={28}
          color={color}
          shapeClass="rounded-full ring-2 ring-paper/80"
        />
        <span className="hidden text-sm font-bold sm:inline">{activeName}</span>
        <span className="sr-only sm:hidden">{activeName}&apos;s menu</span>
        <ChevronDown size={14} className="hidden sm:block" aria-hidden />
      </button>

      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-1rem)] space-y-3 rounded-xl border-2 border-ink bg-card p-3 text-sm text-foreground shadow-lg dark:border-white/20"
        >
          {optimistic && (
            <>
              <Segmented
                legend={`How ${appName} looks for me`}
                name="view-mode"
                value={optimistic.viewMode}
                options={VIEW_MODES}
                onChange={(viewMode) => save({ viewMode })}
              />
              {/* Nothing to turn down when the family turned the mascot off. */}
              {mascot.on && (
                <Segmented
                  legend={mascot.name}
                  name="bunson-volume"
                  value={optimistic.bunsonVolume}
                  options={BUNSON_VOLUMES}
                  onChange={(bunsonVolume) => save({ bunsonVolume })}
                />
              )}
            </>
          )}
          <div className="-mx-3 border-t-2 border-dashed border-border pt-1">
            <button
              type="button"
              onClick={() => router.push("/profiles")}
              className="block w-full px-4 py-2 text-left hover:bg-muted"
            >
              Switch person
            </button>
            <button
              type="button"
              onClick={async () => {
                // A kid on the family tablet can reach this too; it signs the grown-up out.
                if (!window.confirm(`Sign out of ${appName} on this device? You'll need to sign in again to get back in.`)) return;
                await signOut();
                router.push("/sign-in");
              }}
              className="block w-full px-4 py-2 text-left hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
