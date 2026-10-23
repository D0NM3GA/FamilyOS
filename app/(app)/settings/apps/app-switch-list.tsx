"use client";

import { useOptimistic, useState, useTransition } from "react";
import { APPS, SWITCHABLE_APPS, isAppOn, switchApp, type AppDef, type SwitchableAppId } from "@/lib/apps";
import { AppTile } from "@/components/app-tile";
import { setAppSwitch } from "./actions";

/**
 * What turning each app off does, in a line (as approved in the mock). Money's gap: SimpleFIN
 * and the order-email scan only reach about 90 days back (lib/finance/sync.ts, order-mail).
 */
const OFF_NOTE: Record<SwitchableAppId, string> = {
  calendar: "Off: the Outlook sync pauses too.",
  chores: "Off: no chore board, and chores stop earning rewards.",
  meds: "Off: doses and refill nudges stop.",
  groceries: "Off: lists, the Pantry and receipt prices go quiet.",
  school: "Off: school calendar feeds stop syncing.",
  money: "Off: bank syncs, order emails and money alerts pause; after about 3 months off, the oldest charges can't be fetched again.",
  store: "Off: kids keep earning, with nothing to spend on until it is back.",
  pet: "Off: the pets sleep until it is back, and wake up just as they were.",
  cars: "Off: Garage goes with it, and recall checks stop.",
};

/**
 * With the family calendar in Outlook connected: the apps whose events the sync writes. Off,
 * their events come off the Outlook calendar (copies, made again when the app is back on).
 */
const OUTLOOK_NOTE: Partial<Record<SwitchableAppId, string>> = {
  chores: "Chores leave the Outlook calendar until it's back.",
  meds: "Doses leave the Outlook calendar until it's back.",
  school: "School items leave the Outlook calendar until it's back.",
  cars: "Maintenance dates leave the Outlook calendar until it's back.",
};

type Flip = { id: SwitchableAppId; on: boolean };

/**
 * Phase 36: the apps that have a switch, in the rail's fixed order, each saving as soon as
 * it's flipped (no Save button to forget). Only what can be changed is listed (the owner's
 * call): the always-on apps and Garage, which follows Cars, aren't rows. The switch moves at
 * once (useOptimistic) and settles to what the server saved; a failed save says so and
 * springs back.
 */
export function AppSwitchList({ disabled, outlook }: { disabled: SwitchableAppId[]; outlook: boolean }) {
  const [shown, flip] = useOptimistic(disabled, (state, f: Flip) => switchApp(state, f.id, f.on));
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set(id: SwitchableAppId, on: boolean) {
    setError(null);
    startTransition(async () => {
      flip({ id, on });
      try {
        const result = await setAppSwitch(id, on);
        if (!result.ok) setError(result.error);
      } catch {
        setError("That didn't save. Try again.");
      }
    });
  }

  return (
    <>
      {error && (
        <p role="alert" className="mt-4 text-sm font-bold text-destructive">
          {error}
        </p>
      )}
      <ul className="mt-4 divide-y divide-border rounded-lg bg-card px-4 shadow-sm ring-1 ring-border">
        {SWITCHABLE_APPS.map((id) => (
          <AppRow
            key={id}
            id={id}
            app={APPS.find((a) => a.id === id)!}
            on={isAppOn(shown, id)}
            note={[OFF_NOTE[id], outlook ? OUTLOOK_NOTE[id] : undefined].filter(Boolean).join(" ")}
            onSet={set}
          />
        ))}
      </ul>
    </>
  );
}

function AppRow({
  id,
  app,
  on,
  note,
  onSet,
}: {
  id: SwitchableAppId;
  app: AppDef;
  on: boolean;
  note: string;
  onSet: (id: SwitchableAppId, on: boolean) => void;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <AppTile app={app} dim={!on} />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-foreground">{app.label}</p>
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>
      <Switch label={app.label} on={on} onChange={(next) => onSet(id, next)} />
    </li>
  );
}

/** A real switch: role="switch" with aria-checked, the whole thing a 44px tap target, and On/Off in words too. */
function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="group inline-flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-xl px-1 text-sm font-bold text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span aria-hidden className="w-7 text-right">
        {on ? "On" : "Off"}
      </span>
      <span
        aria-hidden
        className={`relative inline-block h-7 w-12 rounded-full border-2 border-ink transition-colors dark:border-white/30 ${on ? "bg-brand" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full border-2 border-ink bg-white transition-transform motion-reduce:transition-none ${
            on ? "translate-x-5" : ""
          }`}
        />
      </span>
    </button>
  );
}
