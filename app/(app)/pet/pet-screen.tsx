"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition, type PointerEvent } from "react";
import { nextBehavior, type Behavior, type RoomView, type Weather } from "@/lib/pet/behavior";
import { fitsPlace, itemDef, ITEMS, ROOM_SLOTS, type Place, type RoomSlot } from "@/lib/pet/items";
import type { Personality, PetSpot, Toy } from "@/lib/pet/personality";
import { rngFor } from "@/lib/pet/random";
import type { Season, Sky } from "@/lib/pet/room";
import { hearts, type CallKind, type Species, type Stage } from "@/lib/pet/state";
import { PET_NAME_MAX } from "@/lib/pet/words";
import {
  CLEAN_LINES,
  CURED_LINES,
  FAVORITE_MEAL_LINES,
  FAVORITE_SPOT_LINES,
  FAVORITE_TOY_LINES,
  fill,
  MEAL_LINES,
  MEDICINE_LINES,
  OUTCOME_LINES,
  PET_LINES,
  pickLine,
  SAY_NO_LINES,
  serveFood,
  SNACK_LINES,
  STILL_SICK_LINES,
  TOY_LINES,
  type LineContext,
} from "@/lib/pet/voice";
import { GAME_DEFS, GAMES, type GameId } from "@/lib/pet/games/catalog";
import { GameStage } from "./games/game-stage";
import { btn, btnPrimary, card, field, fieldLabel, sectionTitle } from "@/components/styles";
import { SubmitButton } from "@/components/submit";
import { careForPet, openPresent, petPet, placeItem, playWithToy, renamePet, type CareReply, type HatchState } from "./actions";
import { PetRoom, ROOM_W, SLOT_ANCHORS } from "./pet-room";
import { PetSprite, type Mood, type Pose } from "./pet-sprite";

/**
 * Phase 47: the pet screen. The room with the pet living in it, and big buttons below. The pet
 * does its own thing between visits (lib/pet/behavior.ts picks what, from its state), reacts
 * to taps and strokes, and follows the pointer with its eyes. Every change goes through a
 * server action; the page re-renders with the saved pet.
 */

export type ScreenPet = {
  name: string;
  species: Species;
  stage: Stage;
  form: number;
  formName: string;
  hunger: number;
  fun: number;
  energy: number;
  discipline: number;
  weight: number;
  poops: number;
  sick: boolean;
  call: CallKind | null;
  napping: boolean;
  awake: boolean;
  ageDays: number;
  mood: string;
  seed: string;
  personality: Personality;
  minute: number;
  /** Minutes until an egg hatches. */
  hatchesIn: number | null;
};

export type ScreenItem = { id: string; itemId: string; place: Place };

type Panel = "feed" | "play" | "decorate" | "stats" | null;

/** Where things stand on the floor, as a percentage across the room. */
const BED_X = 86;
const WINDOW_X = 50;
const TOY_SPOTS = [40, 56, 30, 70, 47];
const pct = (x: number) => (x / ROOM_W) * 100;

/** Where to stand to see a decoration: beside it on the floor, or under it if it's up high. */
function spotOfDecor(decor: Partial<Record<RoomSlot, string>>, id: string): number {
  const slot = (Object.keys(decor) as RoomSlot[]).find((s) => decor[s] === id);
  if (!slot) return 45;
  const anchor = SLOT_ANCHORS[slot];
  return Math.min(80, Math.max(15, pct(anchor.x) + (slot.startsWith("floor") ? 10 : 0)));
}

function poseFor(behavior: Behavior): Pose {
  switch (behavior.kind) {
    case "wobble":
      return "wobble";
    case "hop":
    case "play-toy":
    case "call":
      return "hop";
    case "dance":
      return "dance";
    case "sulk":
      return "droop";
    case "lie-down":
    case "sleep":
      return "lie";
    default:
      return "idle";
  }
}

function moodFor(behavior: Behavior, pet: ScreenPet): Mood {
  if (behavior.kind === "sleep" || behavior.kind === "yawn") return "asleep";
  if (pet.sick) return "sick";
  if (behavior.kind === "dance" || behavior.kind === "play-toy") return "excited";
  if (behavior.kind === "sulk") return "sad";
  if (behavior.kind === "call") return pet.call === "fake" ? "excited" : "sad";
  if (hearts(pet.hunger) <= 1 || hearts(pet.fun) <= 1) return "sad";
  return hearts(pet.fun) >= 3 ? "happy" : "content";
}

/** How long each behavior lasts before the pet picks another, in milliseconds. */
function durationOf(behavior: Behavior): number {
  switch (behavior.kind) {
    case "wander":
      return 3500;
    case "dance":
    case "play-toy":
      return 4000;
    case "window":
    case "sit":
      return 5000;
    default:
      return 3000;
  }
}

function Meter({ label, value, icon }: { label: string; value: number; icon: string }) {
  const filled = hearts(value);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-sm font-bold">{label}</span>
      <span aria-hidden="true" className="text-lg tracking-tight">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className={i < filled ? "" : "opacity-20 grayscale"}>
            {icon}
          </span>
        ))}
      </span>
      <span className="sr-only">
        {filled} of 4
      </span>
    </div>
  );
}

export function PetScreen({
  pet,
  items,
  presents,
  sky,
  weather,
  season,
  careHours,
}: {
  pet: ScreenPet;
  items: ScreenItem[];
  presents: string[];
  sky: Sky;
  weather: Weather;
  season: Season;
  careHours: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [game, setGame] = useState<GameId | null>(null);
  const [reaction, setReaction] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ mood: Mood; pose: Pose } | null>(null);
  const [hearts, setHearts] = useState<number[]>([]);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [x, setX] = useState(45);
  const tick = useRef(0);
  // The pet's lines (lib/pet/voice.ts): never the same one twice in a row.
  const lastLine = useRef<string | null>(null);
  function say(pool: readonly string[], extra: Partial<LineContext> = {}): string {
    const line = pickLine(pool, Math.random, lastLine.current);
    lastLine.current = line;
    return fill(line, { name: pet.name, species: pet.species, ...extra });
  }

  function unwrap(presentId: string) {
    startTransition(async () => {
      const opened = await openPresent(presentId);
      if (opened.ok) {
        showReaction(`${opened.hint} Inside: ${opened.gift}!`, "excited", "dance");
        burst(5);
      } else if (opened.reason === "asleep") {
        showReaction(`Shh, ${pet.name} is asleep. Open it together when it wakes up.`);
      }
      router.refresh();
    });
  }

  // Petting: a stroke across the pet (not just a tap) counts, by where it started.
  const stroke = useRef<{ x: number; y: number; travelled: number; spot: PetSpot } | null>(null);

  const decor = useMemo(() => {
    const placed: Partial<Record<RoomSlot, string>> = {};
    for (const item of items) if (item.place && ROOM_SLOTS.includes(item.place as RoomSlot)) placed[item.place as RoomSlot] = item.itemId;
    return placed;
  }, [items]);
  const toysOut = useMemo(() => items.filter((item) => item.place === "out"), [items]);
  const hat = items.find((item) => item.place === "worn")?.itemId ?? null;
  const room: RoomView = useMemo(
    () => ({ toysOut: toysOut.map((toy) => toy.itemId as Toy), decor: Object.values(decor), weather }),
    [toysOut, decor, weather],
  );

  const input = { stage: pet.stage, sick: pet.sick, fun: pet.fun, energy: pet.energy, napping: pet.napping, calling: pet.call !== null };
  const [behavior, setBehavior] = useState<Behavior>(() => nextBehavior(input, pet.personality, room, pet.awake, rngFor(pet.seed, "behave", 0)));

  // Pick what to do next whenever the last thing finishes, from the pet as it is now.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      tick.current += 1;
      const next = nextBehavior(input, pet.personality, room, pet.awake, rngFor(pet.seed, "behave", tick.current, Date.now()));
      setBehavior(next);
      // Don't wander off while someone is stroking it.
      if (stroke.current) return;
      const rng = rngFor(pet.seed, "walk", tick.current, Date.now());
      if (next.kind === "wander") setX(18 + rng() * 52);
      else if (next.kind === "window") setX(WINDOW_X);
      else if (next.kind === "sleep") setX(next.target && next.target !== "bed" ? spotOfDecor(decor, next.target) : BED_X);
      else if ((next.kind === "sniff" || next.kind === "peek") && next.target) setX(spotOfDecor(decor, next.target));
      else if (next.kind === "play-toy" && next.target) {
        const index = toysOut.findIndex((toy) => toy.itemId === next.target);
        if (index >= 0) setX(TOY_SPOTS[index % TOY_SPOTS.length] + 6);
      }
    }, durationOf(behavior));
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run when the behavior ends, not on every render
  }, [behavior]);

  // Keep the pet current: hatch the egg on time, and catch up every minute while open.
  useEffect(() => {
    const ms = pet.hatchesIn != null ? Math.max(5, pet.hatchesIn * 60) * 1000 : 60_000;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => window.clearTimeout(timer);
  }, [pet, router]);

  const showReaction = useCallback((text: string, mood?: Mood, pose?: Pose) => {
    setReaction(text);
    if (mood) setFlash({ mood, pose: pose ?? "hop" });
    window.setTimeout(() => setFlash(null), 1800);
    window.setTimeout(() => setReaction((current) => (current === text ? null : current)), 3000);
  }, []);

  function burst(count: number) {
    const ids = Array.from({ length: count }, (_, i) => Date.now() + i);
    setHearts((current) => [...current, ...ids]);
    window.setTimeout(() => setHearts((current) => current.filter((id) => !ids.includes(id))), 1300);
  }

  type Success = { lines: readonly string[]; favoriteLines?: readonly string[]; extra?: Partial<LineContext>; mood: Mood; hearts?: number };

  function run(action: () => Promise<CareReply & { favorite?: boolean }>, success: Success) {
    startTransition(async () => {
      const reply = await action();
      if (reply.outcome === "ok") {
        const favorite = reply.favorite && success.favoriteLines;
        showReaction(say(favorite ? success.favoriteLines! : success.lines, success.extra), success.mood);
        burst(favorite ? 5 : (success.hearts ?? 2));
      } else if (reply.outcome === "cured") {
        showReaction(say(CURED_LINES), "happy");
        burst(3);
      } else if (reply.outcome === "still-sick") {
        showReaction(say(STILL_SICK_LINES), "sick", "idle");
      } else if (reply.outcome === "asleep") {
        showReaction(`Shh, ${pet.name} is asleep.`);
      } else if (reply.outcome === "busy") {
        showReaction("Hang on, try that again.");
      } else if (reply.outcome === "played-recently") {
        showReaction(say(success.lines, success.extra), success.mood);
      } else if (reply.outcome !== "no-pet" && reply.outcome !== "gone") {
        showReaction(say(OUTCOME_LINES[reply.outcome]), reply.outcome === "too-many-snacks" ? "sick" : undefined, "wiggle");
      }
      router.refresh();
    });
  }

  /** What's in the bowl: often its favorite, so there's a chance to notice. */
  function serveMeal() {
    const food = serveFood(pet.personality.favoriteFood, Math.random);
    const favorite = food === pet.personality.favoriteFood;
    run(async () => ({ ...(await careForPet("meal")), favorite }), {
      lines: MEAL_LINES,
      favoriteLines: FAVORITE_MEAL_LINES,
      extra: { food },
      mood: "eating",
    });
  }

  function petSpot(spot: PetSpot) {
    run(() => petPet(spot), { lines: PET_LINES[spot], favoriteLines: FAVORITE_SPOT_LINES, mood: "petted", hearts: 3 });
  }

  function playToy(toy: ScreenItem) {
    const id = toy.itemId as Toy;
    run(() => playWithToy(toy.id), { lines: TOY_LINES[id] ?? TOY_LINES.ball, favoriteLines: FAVORITE_TOY_LINES, extra: { toy: id }, mood: "excited" });
  }

  function onPetDown(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    const spot: PetSpot = fy < 0.45 ? "head" : fy > 0.8 ? "back" : fx < 0.33 || fx > 0.67 ? "cheeks" : "belly";
    stroke.current = { x: event.clientX, y: event.clientY, travelled: 0, spot };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPetMove(event: PointerEvent<HTMLDivElement>) {
    const current = stroke.current;
    if (!current) return;
    current.travelled += Math.hypot(event.clientX - current.x, event.clientY - current.y);
    current.x = event.clientX;
    current.y = event.clientY;
    if (current.travelled > 60 && !pending && pet.stage !== "egg" && pet.awake) {
      stroke.current = null;
      petSpot(current.spot);
    }
  }
  function onPetUp() {
    if (stroke.current && stroke.current.travelled < 10) {
      // A tap: it notices you.
      setFlash({ mood: pet.stage === "egg" ? "content" : "happy", pose: pet.stage === "egg" ? "wobble" : "wiggle" });
      window.setTimeout(() => setFlash(null), 1200);
    }
    stroke.current = null;
  }

  function onRoomMove(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const petX = box.left + (x / 100) * box.width;
    const petY = box.top + 0.72 * box.height;
    const dx = event.clientX - petX;
    const dy = event.clientY - petY;
    const length = Math.max(1, Math.hypot(dx, dy));
    setLook({ x: dx / length, y: dy / length });
  }

  if (game) {
    return (
      <GameStage
        game={game}
        pet={{ name: pet.name, species: pet.species, stage: pet.stage, form: pet.form }}
        decor={Object.values(decor)}
        onClose={() => setGame(null)}
      />
    );
  }

  const mood = flash?.mood ?? moodFor(behavior, pet);
  const pose = flash?.pose ?? poseFor(behavior);
  const canCare = pet.awake && pet.stage !== "egg" && !pending;

  return (
    <div className="space-y-4">
      <div
        className="relative mx-auto aspect-[40/26] w-full max-w-3xl touch-pan-y select-none overflow-hidden rounded-3xl border-2 border-ink shadow-[0_4px_0_#1f2933] dark:border-white/20"
        onPointerMove={onRoomMove}
      >
        <PetRoom sky={sky} weather={weather} season={season} awake={pet.awake} decor={decor} poops={pet.poops} />

        {toysOut.map((toy, i) => (
          <button
            key={toy.id}
            type="button"
            disabled={!canCare}
            onClick={() => playToy(toy)}
            className="absolute bottom-[6%] flex size-[9%] -translate-x-1/2 items-center justify-center rounded-full text-[clamp(1rem,4vw,2rem)] transition hover:scale-110 disabled:cursor-default"
            style={{ left: `${TOY_SPOTS[i % TOY_SPOTS.length]}%` }}
            aria-label={`Play with the ${itemDef(toy.itemId)?.name.toLowerCase()}`}
          >
            <ToyIcon id={toy.itemId} wiggle={behavior.kind === "play-toy" && behavior.target === toy.itemId} />
          </button>
        ))}

        {presents.slice(0, 3).map((id, i) => (
          <button
            key={id}
            type="button"
            disabled={!canCare}
            onClick={() => unwrap(id)}
            className="absolute bottom-[20%] flex size-[10%] -translate-x-1/2 items-center justify-center text-[clamp(1.25rem,5vw,2.5rem)] transition hover:scale-110 disabled:cursor-default"
            style={{ left: `${6 + i * 7}%` }}
            aria-label="Open the present"
          >
            <span aria-hidden="true" className="inline-block animate-[pet-wiggle_1.2s_ease-in-out_infinite]">
              🎁
            </span>
          </button>
        ))}

        <div
          className="absolute bottom-[8%] w-[24%] -translate-x-1/2 cursor-grab transition-[left] duration-[1800ms] ease-in-out active:cursor-grabbing"
          style={{ left: `${x}%` }}
          onPointerDown={onPetDown}
          onPointerMove={onPetMove}
          onPointerUp={onPetUp}
          onPointerCancel={() => (stroke.current = null)}
          role="img"
          aria-label={`${pet.name} the ${pet.formName}`}
        >
          <PetSprite species={pet.species} stage={pet.stage} form={pet.form} mood={mood} pose={pose} hat={hat} look={look} className="w-full overflow-visible" />
          {behavior.kind === "call" && !flash && (
            <span className="absolute -top-2 right-2 rounded-full border-2 border-ink bg-sun px-2 text-lg font-black text-ink">!</span>
          )}
          {hearts.map((id, i) => (
            <span key={id} aria-hidden="true" className="pet-float-up absolute top-0 text-2xl" style={{ left: `${20 + ((i * 23) % 60)}%`, animationDelay: `${i * 90}ms` }}>
              💗
            </span>
          ))}
        </div>

        {reaction && (
          <p className="absolute left-1/2 top-[4%] max-w-[80%] -translate-x-1/2 rounded-2xl border-2 border-ink bg-card px-3 py-1 text-center text-sm font-bold shadow-[0_2px_0_#1f2933]">
            {reaction}
          </p>
        )}
      </div>

      <p className="text-center text-lg font-bold" aria-live="polite">
        {pet.mood}
        {!pet.awake && <span className="block text-sm font-normal text-muted-foreground">Awake {careHours} today.</span>}
        {presents.length > 0 && pet.awake && pet.stage !== "egg" && (
          <span className="block text-sm font-normal text-muted-foreground">
            {presents.length === 1 ? "There's a present by the door." : `There are ${presents.length} presents by the door.`}
          </span>
        )}
        {pet.hatchesIn != null && <span className="block text-sm font-normal text-muted-foreground">Hatching in about {Math.max(1, pet.hatchesIn)} minute{pet.hatchesIn === 1 ? "" : "s"}.</span>}
      </p>

      <div className="mx-auto grid max-w-3xl grid-cols-3 gap-2 sm:grid-cols-6">
        <BigButton emoji="🍙" label="Feed" disabled={!canCare} pressed={panel === "feed"} onClick={() => setPanel(panel === "feed" ? null : "feed")} />
        <BigButton emoji="🎾" label="Play" disabled={!canCare} pressed={panel === "play"} onClick={() => setPanel(panel === "play" ? null : "play")} />
        <BigButton emoji="🧽" label="Clean" disabled={!canCare} onClick={() => run(() => careForPet("clean"), { lines: CLEAN_LINES, mood: "happy" })} />
        <BigButton emoji="💊" label="Medicine" disabled={!canCare} onClick={() => run(() => careForPet("medicine"), { lines: MEDICINE_LINES, mood: "content" })} />
        <BigButton emoji="✋" label="Say no" disabled={!canCare} onClick={() => run(() => careForPet("no"), { lines: SAY_NO_LINES, mood: "content" })} />
        <BigButton emoji="🪴" label="Room" pressed={panel === "decorate"} onClick={() => setPanel(panel === "decorate" ? null : "decorate")} />
      </div>

      {panel === "feed" && (
        <div className={`${card} mx-auto flex max-w-3xl flex-wrap justify-center gap-2`}>
          <button type="button" className={btnPrimary} disabled={!canCare} onClick={serveMeal}>
            🍚 A meal
          </button>
          <button type="button" className={btn} disabled={!canCare} onClick={() => run(() => careForPet("snack"), { lines: SNACK_LINES, mood: "eating" })}>
            🍪 A snack
          </button>
        </div>
      )}

      {panel === "play" && (
        <div className={`${card} mx-auto max-w-3xl space-y-3`}>
          <p className={sectionTitle}>Games</p>
          {pet.sick || pet.energy < 12 ? (
            <p className="text-sm text-muted-foreground">{pet.sick ? `${pet.name} is too poorly for games. Medicine first.` : `${pet.name} is too sleepy for games. Let it nap.`}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {GAMES.map((id) => (
                <button key={id} type="button" className={`${btn} min-h-16 flex-col`} disabled={!canCare} onClick={() => setGame(id)}>
                  <span aria-hidden="true" className="text-2xl">
                    {GAME_DEFS[id].emoji}
                  </span>
                  {GAME_DEFS[id].name}
                </button>
              ))}
            </div>
          )}
          <p className={sectionTitle}>Cuddles</p>
          <p className="text-sm text-muted-foreground">Stroke {pet.name} in the room, or pick a spot:</p>
          <div className="flex flex-wrap gap-2">
            {(["head", "cheeks", "belly", "back"] as const).map((spot) => (
              <button key={spot} type="button" className={btn} disabled={!canCare} onClick={() => petSpot(spot)}>
                Pet its {spot}
              </button>
            ))}
          </div>
          <p className={sectionTitle}>Toys</p>
          <div className="flex flex-wrap gap-2">
            {items.filter((item) => itemDef(item.itemId)?.kind === "toy").map((toy) => (
              <button key={toy.id} type="button" className={btn} disabled={!canCare} onClick={() => playToy(toy)}>
                <ToyIcon id={toy.itemId} /> {itemDef(toy.itemId)?.name}
              </button>
            ))}
            {!items.some((item) => itemDef(item.itemId)?.kind === "toy") && <p className="text-sm text-muted-foreground">Toys come as {pet.name} grows up.</p>}
          </div>
        </div>
      )}

      {panel === "decorate" && <RoomPanel items={items} decor={decor} />}

      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
        <button type="button" className={btn} aria-pressed={panel === "stats"} onClick={() => setPanel(panel === "stats" ? null : "stats")}>
          📋 About {pet.name}
        </button>
        <Link href="/pet/memories" className={btn}>
          📖 Memory book
        </Link>
      </div>

      {panel === "stats" && <StatsPanel pet={pet} />}
    </div>
  );
}

function BigButton({ emoji, label, onClick, disabled, pressed }: { emoji: string; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-ink bg-card text-sm font-extrabold shadow-[0_3px_0_#1f2933] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40 aria-pressed:bg-sun aria-pressed:text-ink dark:border-white/20"
    >
      <span aria-hidden="true" className="text-3xl">
        {emoji}
      </span>
      {label}
    </button>
  );
}

const TOY_EMOJI: Record<string, string> = { ball: "⚽", plush: "🧸", bubbles: "🫧", drum: "🥁", kite: "🪁" };

function ToyIcon({ id, wiggle = false }: { id: string; wiggle?: boolean }) {
  return (
    <span aria-hidden="true" className={wiggle ? "inline-block animate-[pet-wiggle_0.4s_ease-in-out_infinite]" : "inline-block"}>
      {TOY_EMOJI[id] ?? "🎁"}
    </span>
  );
}

const SLOT_NAMES: Record<RoomSlot, string> = {
  wall: "On the wall",
  shelf: "On the shelf",
  sill: "On the windowsill",
  "floor-left": "Floor, by the bowl",
  "floor-right": "Floor, by the bed",
};

function RoomPanel({ items, decor }: { items: ScreenItem[]; decor: Partial<Record<RoomSlot, string>> }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const move = (itemRowId: string, place: string) =>
    startTransition(async () => {
      await placeItem(itemRowId, place);
      router.refresh();
    });
  const decorItems = items.filter((item) => itemDef(item.itemId)?.kind === "decor");
  const toys = items.filter((item) => itemDef(item.itemId)?.kind === "toy");
  const hats = items.filter((item) => itemDef(item.itemId)?.kind === "hat");

  return (
    <div className={`${card} mx-auto max-w-3xl space-y-4`} aria-busy={pending || undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        {ROOM_SLOTS.map((slot) => {
          const here = items.find((item) => item.place === slot);
          const fits = decorItems.filter((item) => fitsPlace(item.itemId, slot));
          return (
            <div key={slot} className="grid gap-1">
              <label htmlFor={`pet-slot-${slot}`} className={fieldLabel}>
                {SLOT_NAMES[slot]}
              </label>
              <select
                id={`pet-slot-${slot}`}
                className={field}
                value={here?.id ?? ""}
                disabled={pending || fits.length === 0}
                onChange={(event) => (event.target.value ? move(event.target.value, slot) : here && move(here.id, "box"))}
              >
                <option value="">{fits.length === 0 ? "Nothing fits here yet" : "Empty"}</option>
                {fits.map((item) => (
                  <option key={item.id} value={item.id}>
                    {itemDef(item.itemId)?.name}
                    {item.place && item.place !== slot ? ` (move from ${SLOT_NAMES[item.place as RoomSlot]?.toLowerCase() ?? "elsewhere"})` : ""}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {decor && decorItems.length === 0 && <p className="text-sm text-muted-foreground">New things for the room turn up as your pet grows.</p>}
      {toys.length > 0 && (
        <div>
          <p className={sectionTitle}>Toys on the floor</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {toys.map((toy) => (
              <button key={toy.id} type="button" className={btn} aria-pressed={toy.place === "out"} disabled={pending} onClick={() => move(toy.id, toy.place === "out" ? "box" : "out")}>
                <ToyIcon id={toy.itemId} /> {itemDef(toy.itemId)?.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {hats.length > 0 && (
        <div>
          <p className={sectionTitle}>Dress up</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {hats.map((hat) => (
              <button key={hat.id} type="button" className={btn} aria-pressed={hat.place === "worn"} disabled={pending} onClick={() => move(hat.id, hat.place === "worn" ? "box" : "worn")}>
                {itemDef(hat.itemId)?.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {items.length} of {ITEMS.length} things found so far.
      </p>
    </div>
  );
}

function StatsPanel({ pet }: { pet: ScreenPet }) {
  const [state, rename] = useActionState<HatchState, FormData>(renamePet, {});
  return (
    <div className={`${card} mx-auto grid max-w-3xl gap-4 sm:grid-cols-2`}>
      <div className="space-y-2">
        <p className="text-lg font-extrabold">
          {pet.name} <span className="font-bold text-muted-foreground">the {pet.formName}</span>
        </p>
        <Meter label="Tummy" value={pet.hunger} icon="🍙" />
        <Meter label="Fun" value={pet.fun} icon="💗" />
        <Meter label="Energy" value={pet.energy} icon="⚡" />
        <p className="text-sm">
          <span className="font-bold">Manners:</span> {Math.round(pet.discipline)}%
        </p>
        <p className="text-sm">
          <span className="font-bold">Age:</span> {pet.ageDays} {pet.ageDays === 1 ? "day" : "days"} · <span className="font-bold">Weight:</span> {Math.round(pet.weight)} g
        </p>
      </div>
      <form action={rename} className="grid content-start gap-2">
        <label className="grid gap-1">
          <span className={fieldLabel}>Rename</span>
          <input name="name" defaultValue={pet.name} maxLength={PET_NAME_MAX} className={field} autoComplete="off" />
        </label>
        {state.error && <p className="text-sm font-bold text-destructive">{state.error}</p>}
        <SubmitButton className={btn}>Save name</SubmitButton>
      </form>
    </div>
  );
}
