"use client";

import { useActionState, useState } from "react";
import { Wordmark } from "@/components/family-look";
import { btnPrimary, card, field, fieldLabel } from "@/components/styles";
import { APP_NAME_SUFFIX, FAMILY_NAME_MAX, appNameFromFamilyName, appNameOrDefault } from "@/lib/app-name";
import { DEFAULT_MASCOT_NAME, MASCOT_NAME_MAX, iconLetter, type AppIconKind } from "@/lib/family-look";
import { REWARD_PRESETS, REWARD_WORD_MAX, STORE_NAME_MAX, capitalized, rewardCount, type RewardWords } from "@/lib/reward-words";
import { THEME_COLORS, themeColorOf } from "@/lib/theme-colors";
import { saveLook, type LookFormState } from "./actions";

export type LookDefaults = {
  familyName: string;
  themeColor: string;
  /** A preset id, or "custom" with the words below. */
  reward: string;
  rewardWords: RewardWords;
  mascotOn: boolean;
  mascotName: string;
  appIcon: AppIconKind;
};

// A selected choice: the ink outline and sun fill used for "current" chips elsewhere.
const picked = "border-ink bg-sun text-ink dark:border-sun";
const unpicked = "border-ink/15 bg-card dark:border-white/15";
const focusRing = "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50";

export function LookForm({ defaults }: { defaults: LookDefaults }) {
  const [state, formAction, pending] = useActionState<LookFormState, FormData>(saveLook, {});
  const [familyName, setFamilyName] = useState(defaults.familyName);
  const [color, setColor] = useState(defaults.themeColor);
  const [reward, setReward] = useState(defaults.reward);
  const [custom, setCustom] = useState<RewardWords>(defaults.reward === "custom" ? defaults.rewardWords : { one: "", many: "", store: "" });
  const [mascotOn, setMascotOn] = useState(defaults.mascotOn);
  const [mascotName, setMascotName] = useState(defaults.mascotName);
  const [icon, setIcon] = useState<AppIconKind>(defaults.appIcon);

  const appName = appNameOrDefault(appNameFromFamilyName(familyName));
  const chrome = themeColorOf(color).light.chrome;
  const words = REWARD_PRESETS.find((p) => p.id === reward) ?? {
    one: custom.one.trim() || "…",
    many: custom.many.trim() || "…",
    store: custom.store.trim() || "…",
  };
  // An emoji or symbol first can't be drawn as a letter: the icon is the bunny then.
  const letter = iconLetter(appName);
  const shownMascot = mascotName.trim() || DEFAULT_MASCOT_NAME;

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      {/* What it'll look like, before saving: the top bar in the chosen color. */}
      <div aria-hidden className="flex h-14 items-center gap-3 rounded-2xl px-4 text-white shadow-sm" style={{ backgroundColor: chrome }}>
        <span className="size-8 rounded-full bg-sun" />
        <span className="truncate font-heading text-2xl font-extrabold leading-none">
          <Wordmark name={appName} accentClassName="text-sun" />
        </span>
      </div>

      <section className={`${card} space-y-2`}>
        <h2 className="font-heading text-xl font-extrabold">App name</h2>
        <label htmlFor="look-family-name" className={`${fieldLabel} block`}>
          Your family&apos;s name
        </label>
        <div className="flex max-w-sm">
          <input
            id="look-family-name"
            name="familyName"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            placeholder="Family"
            // maxLength counts UTF-16 units (an emoji is several); the server counts characters.
            maxLength={FAMILY_NAME_MAX * 4}
            aria-describedby="look-family-name-help"
            className={`${field} min-w-0 flex-1 rounded-r-none`}
          />
          <span aria-hidden className="inline-flex items-center rounded-r-xl border-2 border-l-0 border-input bg-muted px-3 font-heading font-extrabold">
            {APP_NAME_SUFFIX}
          </span>
        </div>
        <p id="look-family-name-help" className="text-xs text-muted-foreground">
          The app adds the OS: Smith becomes SmithOS. Up to {FAMILY_NAME_MAX} characters. Leave blank for FamilyOS.
        </p>
      </section>

      <fieldset className={`${card} space-y-3`}>
        <legend className="sr-only">Top bar color</legend>
        <h2 aria-hidden className="font-heading text-xl font-extrabold">
          Top bar color
        </h2>
        <p className="text-xs text-muted-foreground">
          The bar across the top and the main buttons, in light and dark mode. Every color keeps white text easy to read.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_COLORS.map((c) => (
            <label
              key={c.id}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 p-2 text-sm font-bold ${focusRing} ${color === c.id ? picked : unpicked}`}
            >
              <input type="radio" name="themeColor" value={c.id} checked={color === c.id} onChange={() => setColor(c.id)} className="sr-only" />
              <span aria-hidden className="h-7 w-10 shrink-0 rounded-lg ring-1 ring-ink/20 dark:ring-white/40" style={{ backgroundColor: c.swatch }} />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={`${card} space-y-3`}>
        <legend className="sr-only">What the kids earn</legend>
        <h2 aria-hidden className="font-heading text-xl font-extrabold">
          What the kids earn
        </h2>
        <p className="text-xs text-muted-foreground">
          The reward for chores and meds, and the store they spend it in. Changing it keeps everyone&apos;s balance.
        </p>
        <div className="flex flex-wrap gap-2">
          {[...REWARD_PRESETS.map((p) => ({ id: p.id, label: capitalized(p.many) })), { id: "custom", label: "Your own…" }].map((r) => (
            <label
              key={r.id}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 px-4 text-sm font-bold ${focusRing} ${reward === r.id ? picked : unpicked}`}
            >
              <input type="radio" name="reward" value={r.id} checked={reward === r.id} onChange={() => setReward(r.id)} className="sr-only" />
              {r.label}
            </label>
          ))}
        </div>
        {reward === "custom" && (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className={`${fieldLabel} block`}>One</span>
              <input name="rewardOne" value={custom.one} onChange={(e) => setCustom({ ...custom, one: e.target.value })} placeholder="acorn" maxLength={REWARD_WORD_MAX * 4} className={`${field} mt-1 w-full`} />
            </label>
            <label className="block">
              <span className={`${fieldLabel} block`}>Many</span>
              <input name="rewardMany" value={custom.many} onChange={(e) => setCustom({ ...custom, many: e.target.value })} placeholder="acorns" maxLength={REWARD_WORD_MAX * 4} className={`${field} mt-1 w-full`} />
            </label>
            <label className="block">
              <span className={`${fieldLabel} block`}>Store name</span>
              <input name="rewardStore" value={custom.store} onChange={(e) => setCustom({ ...custom, store: e.target.value })} placeholder="Acorn Shop" maxLength={STORE_NAME_MAX * 4} className={`${field} mt-1 w-full`} />
            </label>
          </div>
        )}
        <div className="rounded-xl bg-muted p-3 text-sm">
          <p className={fieldLabel}>How it reads</p>
          <p>
            Ivy finished <b>Make bed</b>: <b>+{rewardCount(5, words)}</b>
          </p>
          <p>
            Max has <b>{rewardCount(1, words)}</b> to go for Extra screen time
          </p>
          <p>
            Off to the <b>{words.store}</b>
          </p>
        </div>
      </fieldset>

      <fieldset className={`${card} space-y-3`}>
        <legend className="sr-only">The mascot</legend>
        <h2 aria-hidden className="font-heading text-xl font-extrabold">
          The mascot
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { on: true, label: "Visits everyone" },
            { on: false, label: "Off for everyone" },
          ].map((m) => (
            <label
              key={m.label}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-xl border-2 px-4 text-sm font-bold ${focusRing} ${mascotOn === m.on ? picked : unpicked}`}
            >
              <input type="radio" name="mascot" value={m.on ? "on" : "off"} checked={mascotOn === m.on} onChange={() => setMascotOn(m.on)} className="sr-only" />
              {m.label}
            </label>
          ))}
        </div>
        <label className="block max-w-sm">
          <span className={`${fieldLabel} block`}>His name</span>
          <input
            name="mascotName"
            value={mascotName}
            onChange={(e) => setMascotName(e.target.value)}
            placeholder={DEFAULT_MASCOT_NAME}
            maxLength={MASCOT_NAME_MAX * 4}
            className={`${field} mt-1 w-full`}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          &ldquo;Visits everyone&rdquo; still lets each person turn him down in their own menu. &ldquo;Off&rdquo; hides him everywhere.
        </p>
        <p className="font-hand text-xl text-brand-text">
          {mascotOn ? `“Psst, Ivy. 2 chores still waiting.” — ${shownMascot}` : "No visits. The bunny is napping."}
        </p>
      </fieldset>

      <fieldset className={`${card} space-y-3`}>
        <legend className="sr-only">Home Screen icon</legend>
        <h2 aria-hidden className="font-heading text-xl font-extrabold">
          Home Screen icon
        </h2>
        <p className="text-xs text-muted-foreground">
          What phones show once someone adds the app to their Home Screen. A phone keeps its old icon until it&apos;s added again.
        </p>
        <div className="flex flex-wrap gap-3">
          <label className={`flex w-32 cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 p-3 text-sm font-bold ${focusRing} ${icon === "BUNNY" ? picked : unpicked}`}>
            <input type="radio" name="appIcon" value="BUNNY" checked={icon === "BUNNY"} onChange={() => setIcon("BUNNY")} className="sr-only" />
            {/* eslint-disable-next-line @next/next/no-img-element -- small local pixel art; next/image's srcset blurs it */}
            <img src="/icons/bunny.png" alt="" width={72} height={72} className="rounded-2xl bg-paper" />
            Bunny
          </label>
          <label className={`flex w-32 cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 p-3 text-sm font-bold ${focusRing} ${icon === "LETTER" ? picked : unpicked}`}>
            <input type="radio" name="appIcon" value="LETTER" checked={icon === "LETTER"} onChange={() => setIcon("LETTER")} className="sr-only" />
            {letter ? (
              <span aria-hidden className="grid size-18 place-items-center rounded-2xl font-heading text-5xl font-extrabold text-sun" style={{ backgroundColor: chrome }}>
                {letter}
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- small local pixel art
              <img src="/icons/bunny.png" alt="" width={72} height={72} className="rounded-2xl bg-paper" />
            )}
            First letter
          </label>
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm font-bold text-destructive">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-sm font-bold text-green-700 dark:text-green-400">Saved. Everyone sees it on their next tap.</p>}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
