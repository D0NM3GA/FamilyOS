"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type PointerEvent } from "react";
import { nextBehavior, type Behavior, type BehaviorInput, type RoomView, type Weather } from "@/lib/pet/behavior";
import { itemDef, ROOM_SLOTS, type Place, type RoomSlot } from "@/lib/pet/items";
import type { Food, Personality, PetSpot, Toy } from "@/lib/pet/personality";
import { rngFor } from "@/lib/pet/random";
import type { Season, Sky } from "@/lib/pet/room";
import type { CallKind, Species, Stage } from "@/lib/pet/state";
import {
  CLEAN_LINES,
  CURED_LINES,
  FAVORITE_MEAL_LINES,
  FAVORITE_SPOT_LINES,
  FAVORITE_TOY_LINES,
  MEAL_LINES,
  MEDICINE_LINES,
  OUTCOME_LINES,
  PET_LINES,
  SAY_NO_LINES,
  TRICK_LINES,
  TRICK_SILLY_LINES,
  serveFood,
  SNACK_LINES,
  STILL_SICK_LINES,
  TOY_LINES,
  type LineContext,
} from "@/lib/pet/voice";
import { GAME_DEFS, GAMES, type GameId } from "@/lib/pet/games/catalog";
import { btn, btnPrimary, card, sectionTitle } from "@/components/styles";
import { careForPet, openPresent, petPet, playWithToy, seeGrowth, type CareReply } from "./actions";
import { BigButton, ToyIcon } from "./pet-controls";
import { BED_X, durationOf, moodFor, poseFor, spotOfDecor, TOY_SPOTS, WINDOW_X, type Mood } from "@/lib/pet/motion";
import { PetRoom } from "./pet-room";
import { PetSprite } from "./pet-sprite";
import { RoomPanel } from "./room-panel";
import { StatsPanel } from "./stats-panel";
import { useReactions } from "./use-reactions";
import { EffectLayer, roomPoint } from "./effects";
import { RevealMoment, type ScreenReveal } from "./reveal";
import { BOWL, POOP_SPOTS } from "@/lib/pet/room";
import { TRICKS, tryTrick, type TrickId } from "@/lib/pet/tricks";

const FOOD_EMOJI: Record<Food, string> = { berries: "🫐", "rice-ball": "🍙", pancake: "🥞", carrot: "🥕", fish: "🐟" };

// The games are only fetched when one is opened: most visits are feeding and petting.
const GameStage = dynamic(() => import("./games/game-stage").then((module) => module.GameStage), {
  ssr: false,
  loading: () => <p className="py-10 text-center font-bold text-muted-foreground">Getting the game ready…</p>,
});

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

export function PetScreen({
  pet,
  items,
  presents,
  sky,
  weather,
  season,
  careHours,
  tricks,
  newTricks,
  reveal,
}: {
  pet: ScreenPet;
  items: ScreenItem[];
  presents: string[];
  tricks: TrickId[];
  newTricks: TrickId[];
  reveal: ScreenReveal;
  sky: Sky;
  weather: Weather;
  season: Season;
  careHours: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [, startSeeing] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [game, setGame] = useState<GameId | null>(null);
  const { line: reaction, flash, effects, say, show: showReaction, pose: flashPose, burst, fly } = useReactions(pet);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [x, setX] = useState(45);
  const tick = useRef(0);
  // Where effects start: the pet's middle, the bowl, each poop.
  const petMiddle = { x, y: 70 };
  // The reveal shows until the kid has seen it; keyed by what it shows, so a new one starts fresh.
  const revealKey = `${reveal?.to.stage ?? ""}-${reveal?.to.form ?? ""}-${newTricks.join(",")}`;
  const [seenReveal, setSeenReveal] = useState<string | null>(null);
  const revealing = (reveal !== null || newTricks.length > 0) && seenReveal !== revealKey && pet.stage !== "egg";
  // When the reveal closes, focus goes back into the room's controls, not the top of the page.
  // After it has closed, not on the tap: until then the controls are still inert.
  const wasRevealing = useRef(revealing);
  useEffect(() => {
    if (wasRevealing.current && !revealing) {
      // Play when it's usable, otherwise Room (which works even while the pet sleeps).
      const play = document.getElementById("pet-play-button") as HTMLButtonElement | null;
      (play && !play.disabled ? play : document.getElementById("pet-room-button"))?.focus();
    }
    wasRevealing.current = revealing;
  }, [revealing]);

  function finishReveal() {
    setSeenReveal(revealKey);
    // Its own transition, so saving it doesn't briefly disable the care buttons.
    startSeeing(async () => {
      await seeGrowth();
    });
    burst("sparkle", petMiddle, 10);
  }

  function unwrap(presentId: string) {
    startTransition(async () => {
      const opened = await openPresent(presentId);
      if (opened.ok) {
        showReaction(`${opened.hint} Inside: ${opened.gift}!`, "excited", "dance");
        burst("sparkle", petMiddle, 8);
      } else if (opened.reason === "asleep") {
        showReaction(`Shh, ${pet.name} is asleep. Open it together when it wakes up.`);
      }
      // No router.refresh(): the action's revalidatePath already sends the fresh page back.
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

  const input: BehaviorInput = { stage: pet.stage, sick: pet.sick, fun: pet.fun, energy: pet.energy, napping: pet.napping, calling: pet.call !== null };
  const [behavior, setBehavior] = useState<Behavior>(() => nextBehavior(input, pet.personality, room, pet.awake, rngFor(pet.seed, "behave", 0)));
  // What the next pick reads: the pet and room as they are now, not when the last pick was made.
  const latest = useRef({ input, room, decor, toysOut, awake: pet.awake });
  useEffect(() => {
    latest.current = { input, room, decor, toysOut, awake: pet.awake };
  });

  // Pick what to do next whenever the last thing finishes (not while a game is open).
  useEffect(() => {
    if (game) return;
    const timer = window.setTimeout(() => {
      tick.current += 1;
      const { input, room, decor, toysOut, awake } = latest.current;
      const next = nextBehavior(input, pet.personality, room, awake, rngFor(pet.seed, "behave", tick.current, Date.now()));
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
  }, [behavior, game, pet.personality, pet.seed]);

  // Keep the pet current while the screen is open: hatch the egg on time, catch up every minute,
  // and catch up straight away on coming back to the tab. Paused during a game, so a round isn't
  // interrupted by a page reload.
  useEffect(() => {
    if (game) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const ms = pet.hatchesIn != null ? Math.max(5, pet.hatchesIn * 60) * 1000 : 60_000;
    const timer = window.setInterval(refresh, ms);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [game, pet.hatchesIn, router]);

  type Success = {
    lines: readonly string[];
    favoriteLines?: readonly string[];
    extra?: Partial<LineContext>;
    mood: Mood;
    /** What bursts from the pet, and how many (more for a favorite). */
    effect?: "heart" | "sparkle";
    hearts?: number;
    /** Food that flies from the bowl first. */
    food?: string;
    /** Bubbles where each poop was (cleaning). */
    puff?: number;
  };

  function run(action: () => Promise<CareReply & { favorite?: boolean }>, success: Success) {
    startTransition(async () => {
      const reply = await action();
      if (reply.outcome === "ok") {
        const favorite = reply.favorite && success.favoriteLines;
        showReaction(say(favorite ? success.favoriteLines! : success.lines, success.extra), success.mood);
        if (success.food) fly(success.food, roomPoint(BOWL.x, BOWL.y - 10), { x, y: 72 });
        for (const spot of POOP_SPOTS.slice(0, success.puff ?? 0)) burst("bubble", roomPoint(spot.x, spot.y - 6), 4);
        burst(success.effect ?? "heart", petMiddle, favorite ? 6 : (success.hearts ?? 2));
      } else if (reply.outcome === "cured") {
        showReaction(say(CURED_LINES), "happy");
        burst("sparkle", petMiddle, 6);
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
      food: FOOD_EMOJI[food],
    });
  }

  /** A trick: a show for the kid, worked out here. Nothing is saved, so nothing to farm. */
  function doTrick(trick: TrickId) {
    if (tryTrick(pet.discipline, Math.random)) {
      flashPose("excited", trick, 1500);
      showReaction(say(TRICK_LINES[trick]));
      burst("sparkle", petMiddle, 5);
    } else {
      flashPose("happy", "dance", 1500);
      showReaction(say(TRICK_SILLY_LINES));
    }
  }

  function petSpot(spot: PetSpot) {
    run(() => petPet(spot), { lines: PET_LINES[spot], favoriteLines: FAVORITE_SPOT_LINES, mood: "petted", hearts: 3 });
  }

  function playToy(toy: ScreenItem) {
    const id = toy.itemId as Toy;
    run(() => playWithToy(toy.id), {
      lines: TOY_LINES[id] ?? TOY_LINES.ball,
      favoriteLines: FAVORITE_TOY_LINES,
      extra: { toy: id },
      mood: "excited",
      effect: "sparkle",
      hearts: 4,
    });
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
      flashPose(pet.stage === "egg" ? "content" : "happy", pet.stage === "egg" ? "wobble" : "squash", 400);
    }
    stroke.current = null;
  }

  // The eyes follow the pointer, but only in a few steps: a new look at most once a frame, and
  // only when it would move the pupils, so a moving mouse doesn't redraw the screen nonstop.
  const lookFrame = useRef(0);
  function onRoomMove(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const { clientX, clientY } = event;
    if (lookFrame.current) return;
    lookFrame.current = requestAnimationFrame(() => {
      lookFrame.current = 0;
      const dx = clientX - (box.left + (x / 100) * box.width);
      const dy = clientY - (box.top + 0.72 * box.height);
      const length = Math.max(1, Math.hypot(dx, dy));
      const step = (value: number) => Math.round((value / length) * 4) / 4;
      const next = { x: step(dx), y: step(dy) };
      setLook((current) => (current.x === next.x && current.y === next.y ? current : next));
    });
  }
  useEffect(() => () => cancelAnimationFrame(lookFrame.current), []);

  if (game) {
    return (
      <GameStage
        game={game}
        pet={{ name: pet.name, species: pet.species, stage: pet.stage, form: pet.form }}
        decor={Object.values(decor)}
        onClose={() => {
          setGame(null);
          // Back where they left off: on the Play button.
          requestAnimationFrame(() => document.getElementById("pet-play-button")?.focus());
        }}
      />
    );
  }

  const mood = flash?.mood ?? moodFor(behavior, pet);
  const pose = flash?.pose ?? poseFor(behavior);
  const canCare = pet.awake && pet.stage !== "egg" && !pending;

  return (
    <div className="space-y-4">
      <div
        className="relative mx-auto aspect-[40/26] w-full max-w-3xl touch-pan-y select-none overflow-hidden rounded-3xl border-2 border-ink shadow-[0_4px_0_#1f2933] [container-type:size] dark:border-white/20"
        onPointerMove={onRoomMove}
      >
        {/* While the reveal is up, everything else is out of reach (it really is modal), so a care
            tap can't change what Yay! saves as seen. */}
        <div inert={revealing} className="contents">
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
        </div>

        </div>
        <EffectLayer effects={effects} />
        {revealing && <RevealMoment name={pet.name} species={pet.species} reveal={reveal} newTricks={newTricks} onDone={finishReveal} />}

        {reaction && (
          <p role="status" className="absolute left-1/2 top-[4%] max-w-[80%] -translate-x-1/2 rounded-2xl border-2 border-ink bg-card px-3 py-1 text-center text-sm font-bold shadow-[0_2px_0_#1f2933]">
            {reaction}
          </p>
        )}
      </div>

      <div inert={revealing} className="space-y-4">
      <p className="text-center text-lg font-bold">
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
        <BigButton id="pet-play-button" emoji="🎾" label="Play" disabled={!canCare} pressed={panel === "play"} onClick={() => setPanel(panel === "play" ? null : "play")} />
        <BigButton emoji="🧽" label="Clean" disabled={!canCare} onClick={() => run(() => careForPet("clean"), { lines: CLEAN_LINES, mood: "happy", effect: "sparkle", puff: pet.poops })} />
        <BigButton emoji="💊" label="Medicine" disabled={!canCare} onClick={() => run(() => careForPet("medicine"), { lines: MEDICINE_LINES, mood: "content" })} />
        <BigButton emoji="✋" label="Say no" disabled={!canCare} onClick={() => run(() => careForPet("no"), { lines: SAY_NO_LINES, mood: "content" })} />
        <BigButton id="pet-room-button" emoji="🪴" label="Room" pressed={panel === "decorate"} onClick={() => setPanel(panel === "decorate" ? null : "decorate")} />
      </div>

      {panel === "feed" && (
        <div className={`${card} mx-auto flex max-w-3xl flex-wrap justify-center gap-2`}>
          <button type="button" className={btnPrimary} disabled={!canCare} onClick={serveMeal}>
            🍚 A meal
          </button>
          <button type="button" className={btn} disabled={!canCare} onClick={() => run(() => careForPet("snack"), { lines: SNACK_LINES, mood: "eating", food: "🍪" })}>
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
          <p className={sectionTitle}>Tricks</p>
          <div className="flex flex-wrap gap-2">
            {TRICKS.map((trick) =>
              tricks.includes(trick.id) ? (
                <button key={trick.id} type="button" className={btn} disabled={!canCare} onClick={() => doTrick(trick.id)}>
                  {trick.name}
                </button>
              ) : (
                <span
                  key={trick.id}
                  role="img"
                  aria-label="A trick still to learn"
                  className="inline-flex min-h-11 items-center rounded-xl border-2 border-dashed border-input px-3 text-sm font-bold text-muted-foreground"
                >
                  ???
                </span>
              ),
            )}
          </div>
          {tricks.length < TRICKS.length && <p className="text-sm text-muted-foreground">Get closer to {pet.name} to learn more.</p>}
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

      {panel === "decorate" && <RoomPanel items={items} />}

      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
        <button type="button" className={btn} aria-pressed={panel === "stats"} onClick={() => setPanel(panel === "stats" ? null : "stats")}>
          📋 About {pet.name}
        </button>
        <Link href="/pet/book" className={btn}>
          📚 Collection book
        </Link>
        <Link href="/pet/memories" className={btn}>
          📖 Memory book
        </Link>
      </div>

      {panel === "stats" && <StatsPanel pet={pet} />}
      </div>
    </div>
  );
}
