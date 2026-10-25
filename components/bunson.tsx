"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { HOP_FRAME_COUNT, hopFrameIndex } from "@/lib/bunson-hop";
import { BUBBLE_WIDTH_PX, bubbleShift } from "@/lib/bunson-bubble";
import { chaseAcceptsPointer } from "@/lib/bunson-chase";
import {
  HOP_BEAT_MS,
  LOCO_FRAME_COUNT,
  hopProgress,
  locoFrameIndex,
  planHop,
} from "@/lib/bunson-loco";
import { pickBunsonLine, INITIAL_BUNSON_LINE_STATE, type BunsonLineState } from "@/lib/bunson-lines";
import { isAppOn } from "@/lib/apps";
import { useFamilyLook } from "@/components/family-look";
import type { RewardWords } from "@/lib/reward-words";

// The once-ever "excited" entering hop (jump-in-place, camera-facing) — kept
// separate from locomotion on purpose. Reusing this same art for sideways
// travel is what originally made him look like he was lunging at the viewer
// while sliding; LOCO_FRAMES below is a distinct clip generated specifically
// to face and lean into the direction of travel.
const HOP_FRAMES = Array.from(
  { length: HOP_FRAME_COUNT },
  (_, i) => `/mascot/bunson-hop-${i}.png`,
);
// A rightward-facing bounding gait. Mirrored via CSS (scaleX(-1)) for
// leftward travel — the character is symmetric enough that one direction of
// art covers both. All 8 frames' lowest opaque row is 95, matching
// GROUND_PX below — re-measure and realign (shift the frame up, transparent
// fill at the bottom) if this art is ever regenerated, since a fresh
// generation isn't guaranteed to land on the same ground row idle does.
const LOCO_FRAMES = Array.from(
  { length: LOCO_FRAME_COUNT },
  (_, i) => `/mascot/bunson-loco-${i}.png`,
);
const IDLE_FRAME = "/mascot/bunson-idle.png";
const PERISCOPE_FRAME = "/mascot/bunson-periscope.png";

const BUBBLE_MS = 4000; // how long the bubble's content stays announced/fully opaque
const BUBBLE_EXIT_MS = 200; // fade-out duration after BUBBLE_MS, before the node unmounts
const SPEAK_TRANSITION_MS = 300; // matches the clip/crossfade duration-300 classes below
// Ordering invariant: BUBBLE_MS (4000) < +BUBBLE_EXIT_MS (4200) < +SPEAK_TRANSITION_MS
// (4500, RESUME_LOCO_MS below). The bubble fades out, then — only once it's
// fully gone — Bunson finishes settling back down from the speaking pose, and
// only after that does locomotion resume. Nothing ever hops mid-drop, and
// nothing fades in while a hop frame is showing.
const RESUME_LOCO_MS = BUBBLE_MS + BUBBLE_EXIT_MS + SPEAK_TRANSITION_MS;

// All geometry below is derived from the actual alpha bounding boxes of the
// sprites — re-measure if any art is regenerated. Displayed at native 1x
// (decided, not revisiting) so image-rendering: pixelated has a whole-pixel
// source:dest ratio.
const SPRITE_SIZE = 136;

// bunson-idle.png: 136x136 canvas, opaque rows 53-95, cols 48-85 (a 64px
// sprite placed 35px in, feet on row 95). These drive the clip/hitbox bounds
// for the idle and entering-hop states; the hop-*.png frames vary (some reach
// as high as row 41 mid-jump) but stay within the GROUND_PX clip below, so
// they don't need their own bounds here.
const ART_TOP_PX = 53;
const ART_LEFT_PX = 48;
const ART_RIGHT_PX = 86;
const ART_WIDTH_PX = ART_RIGHT_PX - ART_LEFT_PX;
const GROUND_PX = 96; // clip height once revealed — idle's lowest opaque row + 1
// How much of the head pokes up at rest — also the rest-state tap target
// height (24px), which is WCAG 2.5.8's AA floor for touch targets exactly,
// with no margin. Don't tune this below 24.
const VISIBLE_EARS_PX = 24;
const PEEK_PX = ART_TOP_PX + VISIBLE_EARS_PX; // clip height at rest, before ever clicked

// bunson-periscope.png (the "speaking" pose — sitting up, front paws tucked to
// his chest): 136x136 canvas, opaque rows 52-95, cols 48-85. It shares idle's
// ground row; the separate clip tier stays so a taller pose can come back
// without touching the wrapper (it's bottom-anchored, so a taller clip only
// moves its top edge up and the feet stay flush with the viewport edge).
const SPEAK_TOP_PX = 52;
const SPEAK_HEIGHT_PX = 96; // periscope's own lowest opaque row + 1

// Tail tip (~8.5px) + clearance above whichever pose is currently showing.
const BUBBLE_LIFT_PX = 13.5;
// The bubble only ever exists while entering or speaking, so it always
// anchors off whichever pose sits higher — a constant, not a runtime ternary,
// since the bubble is freshly (re)mounted every time this matters.
const BUBBLE_ANCHOR_TOP_PX = Math.min(ART_TOP_PX, SPEAK_TOP_PX);

// Keep-away from viewport edges, measured against the art's own bbox. Wider
// than the art's own margin needs on its own so a classic ~17px OS scrollbar
// on the right doesn't sit inside Bunson's clamped range.
const EDGE_MARGIN = 20;
const REST_INSET = 32; // rest-position inset of the *canvas's* right edge (the art sits (SPRITE_SIZE-ART_RIGHT_PX)=48px further in from its own margin)

// Rest-position bubble shift (Bunson parked at `right: REST_INSET`, chase not
// yet armed) — derived, not hardcoded, specifically so it can never drift out
// of sync with EDGE_MARGIN/SPRITE_SIZE/REST_INSET the way a separate literal
// once did. bubbleShift's rest-position result is viewport-independent (see
// its own tests), so any concrete viewport width produces the same answer —
// 1024 here is arbitrary, not load-bearing.
const BUBBLE_REST_SHIFT_PX = bubbleShift(1024 - SPRITE_SIZE - REST_INSET, 1024, EDGE_MARGIN);

// Phase 36: a line about one app names it, so a family that turned that app off never hears it.
// Phase 35: the reward line is in the family's own word (Settings → Make it yours).
const linesFor = (reward: RewardWords): { text: string; app?: string }[] => [
  { text: "Why did the bunny bring a ladder? To reach the top shelf of carrots." },
  { text: "A messy room is just a chore that hasn't started yet.", app: "chores" },
  { text: "I'm not stalling the chores board, I'm building anticipation.", app: "chores" },
  { text: "Fun fact: bunnies can't burp — we're too polite for that." },
  { text: "Pro tip: check the chores board before it checks you.", app: "chores" },
  { text: "What do you call a rabbit with fleas? Bugs Bunny." },
  { text: "I thump twice for yes, once for 'ask an adult.'" },
  { text: "Carrots are basically orange chore-fuel. Eat your snacks.", app: "chores" },
  { text: "Hop tip: the grocery list doesn't fill itself. Mostly.", app: "groceries" },
  { text: "A clean kitchen makes my nose twitch with joy." },
  { text: "Log a quick note on someone's page — future you will thank present you." },
  { text: "Check the groceries list before the fridge stages a rebellion.", app: "groceries" },
  { text: `Kids: every chore you finish drops ${reward.many} in your pile.`, app: "chores" },
  { text: "Adults: you're the one who gets to write the chores list. Choose wisely.", app: "chores" },
  { text: "I hop, therefore I am." },
  { text: "Milk's probably low. It's always low. Check anyway.", app: "groceries" },
  { text: "Someone in this house has a birthday coming up. Probably." },
  { text: "Unchecked chores don't disappear. Believe me, I've tried ignoring mine.", app: "chores" },
  { text: "My favorite chore is supervising. I'm very good at it.", app: "chores" },
  { text: "One ear up means I'm listening. Both ears up means carrots." },
];

/** How long his facts stay fresh before he looks them up again on the next page. */
const FACTS_FRESH_MS = 5 * 60 * 1000;

export function Bunson({ factsUrl, offApps = [] }: { factsUrl?: string; offApps?: readonly string[] }) {
  const { reward, mascot } = useFamilyLook();
  const lines = linesFor(reward)
    .filter((l) => !l.app || isAppOn(offApps, l.app))
    .map((l) => l.text);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Phase 39: he looks up his real-data lines himself (app/api/bunson-facts), when the
  // browser is idle and only while he's on screen: a page with its own Bunson moment hides
  // him (globals.css), so Home and the other moment pages cost nothing. Until they land, or
  // if they fail, he just tells jokes.
  const pathname = usePathname();
  const [facts, setFacts] = useState<string[]>([]);
  const factsAt = useRef(0);
  const factsLoading = useRef(false);
  const factsAbort = useRef<AbortController | null>(null);
  const lookUpFacts = useCallback(() => {
    if (!factsUrl || factsLoading.current || Date.now() - factsAt.current < FACTS_FRESH_MS) return;
    factsLoading.current = true;
    const abort = (factsAbort.current = new AbortController());
    fetch(factsUrl, { signal: abort.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((f: unknown) => {
        if (!Array.isArray(f)) return;
        setFacts(f.filter((x): x is string => typeof x === "string"));
        factsAt.current = Date.now();
      })
      .catch(() => {})
      .finally(() => {
        factsLoading.current = false;
      });
  }, [factsUrl]);
  useEffect(() => () => factsAbort.current?.abort(), []);
  useEffect(() => {
    let idle = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Checked when it runs, not now: a page's own moment hides him (globals.css), and the
    // page may not be in yet (still streaming on a full load, or its loading screen showing).
    const lookIfShown = () => {
      const el = wrapperRef.current;
      if (el && getComputedStyle(el).display !== "none") lookUpFacts();
    };
    // A couple of seconds after the page has loaded (React reveals streamed parts in batches,
    // and a slow page may still be on its loading screen), then whenever the browser is idle.
    // Nothing waits on these, so there's no hurry; if the page's moment shows up even later,
    // he looks them up once for nothing.
    // Not in a tab nobody can see: it waits until it's shown, which is also when React reveals
    // a streamed page (it does that on animation frames, which hidden tabs don't get).
    const schedule = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", schedule);
      timer = setTimeout(() => {
        if ("requestIdleCallback" in window) idle = requestIdleCallback(lookIfShown, { timeout: 3000 });
        else lookIfShown();
      }, 2000);
    };
    const start = () => {
      document.addEventListener("visibilitychange", schedule);
      schedule();
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      window.removeEventListener("load", start);
      document.removeEventListener("visibilitychange", schedule);
      clearTimeout(timer);
      if (idle) cancelIdleCallback(idle);
    };
  }, [pathname, lookUpFacts]);
  const targetX = useRef(0);
  const currentX = useRef(0);
  const reducedMotionRef = useRef(false);
  const chaseActiveRef = useRef(false);
  const hasInteractedRef = useRef(false);
  const startChaseRef = useRef<() => void>(() => {});
  const scheduleLocoRef = useRef<() => void>(() => {});
  const cancelLocoRef = useRef<() => void>(() => {});
  // Paused from the moment a click lands until RESUME_LOCO_MS later (see
  // handleClick) — locomotion never runs while entering or speaking.
  const locoPausedRef = useRef(true);

  const [revealed, setRevealed] = useState(false); // write-once: true after the first click, never false again
  const [entering, setEntering] = useState(false); // true only during the first click's hop-up-into-view
  const [frame, setFrame] = useState(IDLE_FRAME);
  // `bubble` gates the visual node's mount (stays truthy through the exit
  // fade, so there's text to fade out); `srText` is the accessible announcement
  // and clears BUBBLE_EXIT_MS earlier — see the comment above `clearAllTimers`
  // for why these can't be the same value. `exiting` switches the visual
  // node's classes from entrance to exit without touching its `key` (a key
  // change would replay the entrance instead).
  const [bubble, setBubble] = useState<string | null>(null);
  const [srText, setSrText] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  // "Speaking" is derived, not stored: true once a click has landed and the
  // (once-ever) entering hop has resolved. Everything about the periscope
  // crossfade and the taller clip tier below reads this, not `revealed`.
  const speaking = bubble !== null && !entering;
  // Which way LOCO_FRAMES should face — set once per hop launch (see
  // launchHop), not per frame, so this is plain React state rather than
  // something written imperatively like `left`.
  const [locoDirection, setLocoDirection] = useState<1 | -1>(1);

  const hopStart = useRef<number | null>(null); // the entering hop only
  const hopRaf = useRef<number | null>(null);
  const lastFrameIdx = useRef<number | null>(null);
  const lineStateRef = useRef<BunsonLineState>(INITIAL_BUNSON_LINE_STATE);
  const bubbleKeyRef = useRef(0);
  const bubbleExitStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleUnmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    for (const src of [...HOP_FRAMES, ...LOCO_FRAMES, PERISCOPE_FRAME]) {
      const img = new window.Image();
      img.src = src;
    }
  }, []);

  // Chase + locomotion. Position lives entirely in refs and is written to the
  // DOM directly (style.left, never via React state) since it updates every
  // animation frame — the wrapper's JSX `style` never sets `left` for exactly
  // this reason, so React's per-render diff always sees the same (absent)
  // value and never fights the loop.
  //
  // The box stays on static `right: REST_INSET` CSS (correct at first paint
  // with no JS, and correct across any resize with no JS) until the first
  // mouse pointermove actually needs to move it — only then does
  // `ensureSwitched` flip it to JS-driven `left` positioning, at the same
  // pixel position, so there's no hydration jump. Under prefers-reduced-motion
  // we never switch at all, and `handlePointerMove` ignores touch/pen (see
  // lib/bunson-chase.ts) — on those inputs Bunson stays parked at rest,
  // reachable only by tapping/clicking him there.
  //
  // Locomotion (lib/bunson-loco.ts) replaces a continuous eased glide with
  // discrete physical hops: the cursor's x is sampled only when a hop is
  // about to launch, never mid-flight, so he visibly chases but can't keep up
  // with fast cursor movement. `locoPausedRef` gates all of it — see
  // handleClick and the RESUME_LOCO_MS timer for why he stops hopping the
  // instant he's clicked and only resumes well after he's done speaking.
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mql.matches;
    let switched = false;
    let lastWritten: number | null = null;
    let lastShiftWritten: number | null = null;
    let locoRaf: number | null = null;
    let locoStart: number | null = null;
    let locoFromX = 0;
    let locoToX = 0;
    let locoLastFrameIdx: number | null = null;
    let locoPhase: "standing" | "hopping" | "beat" = "standing";

    function clampCanvasLeft(x: number) {
      const vw = document.documentElement.clientWidth;
      const min = EDGE_MARGIN - ART_LEFT_PX;
      const max = vw - EDGE_MARGIN - ART_RIGHT_PX;
      return Math.min(Math.max(x, min), Math.max(min, max));
    }

    function restLeft() {
      return clampCanvasLeft(
        document.documentElement.clientWidth - SPRITE_SIZE - REST_INSET,
      );
    }

    function writeLeft(x: number) {
      // Read before any write below — writing style.left and then reading
      // clientWidth (in that order) forces a synchronous layout flush every
      // rAF tick during the chase. Reading first avoids it.
      const vw = document.documentElement.clientWidth;

      const rounded = Math.round(x);
      if (rounded !== lastWritten) {
        lastWritten = rounded;
        if (wrapperRef.current) wrapperRef.current.style.left = `${rounded}px`;
      }
      // Own dedupe, deliberately not gated by the early return above: a
      // resize that doesn't move Bunson still needs to re-clamp the bubble,
      // which has a much wider footprint than his own hitbox.
      const shift = Math.round(bubbleShift(x, vw, EDGE_MARGIN));
      if (shift === lastShiftWritten) return;
      lastShiftWritten = shift;
      if (wrapperRef.current) {
        wrapperRef.current.style.setProperty("--bubble-shift", `${shift}px`);
      }
    }

    function ensureSwitched() {
      if (switched) return;
      switched = true;
      currentX.current = restLeft();
      targetX.current = currentX.current;
      if (wrapperRef.current) wrapperRef.current.style.right = "";
      writeLeft(currentX.current);
    }

    function cancelLoco() {
      if (locoRaf != null) {
        cancelAnimationFrame(locoRaf);
        locoRaf = null;
      }
      locoStart = null;
      locoPhase = "standing";
    }
    cancelLocoRef.current = cancelLoco;

    function land(x: number) {
      locoPhase = "standing";
      currentX.current = x;
      writeLeft(x);
      setFrame(IDLE_FRAME);
      locoLastFrameIdx = null;
      // Whoever calls land() has already consumed the rAF that led here
      // (typically the beat phase's own scheduled frame, in stepLoco) without
      // clearing this — leaving it stale would permanently block
      // scheduleLoco's `if (locoRaf != null) return` guard, so no future
      // pointermove could ever start a new hop again.
      locoRaf = null;
    }

    function launchHop(now: number, delta: number) {
      locoPhase = "hopping";
      locoStart = now;
      locoFromX = currentX.current;
      locoToX = clampCanvasLeft(currentX.current + delta);
      locoLastFrameIdx = null;
      setLocoDirection(delta < 0 ? -1 : 1);
      locoRaf = requestAnimationFrame(stepLoco);
    }

    function considerNextMove(now: number) {
      if (locoPausedRef.current) {
        land(currentX.current); // clears any held landing-crouch frame from the beat
        return;
      }
      const delta = planHop(targetX.current - currentX.current);
      if (delta == null) {
        land(currentX.current);
        return;
      }
      launchHop(now, delta);
    }

    function stepLoco(ts: number) {
      if (locoPhase === "beat") {
        const elapsed = ts - (locoStart ?? ts);
        if (elapsed >= HOP_BEAT_MS) {
          considerNextMove(ts);
        } else {
          locoRaf = requestAnimationFrame(stepLoco);
        }
        return;
      }
      const elapsed = ts - (locoStart ?? ts);
      const idx = locoFrameIndex(elapsed);
      if (idx == null) {
        currentX.current = locoToX;
        writeLeft(locoToX);
        setFrame(LOCO_FRAMES[LOCO_FRAME_COUNT - 1]); // landing crouch, held through the beat
        locoPhase = "beat";
        locoStart = ts;
        locoRaf = requestAnimationFrame(stepLoco);
        return;
      }
      if (idx !== locoLastFrameIdx) {
        locoLastFrameIdx = idx;
        setFrame(LOCO_FRAMES[idx]);
      }
      const t = hopProgress(elapsed);
      const x = locoFromX + (locoToX - locoFromX) * t;
      currentX.current = x;
      writeLeft(x);
      locoRaf = requestAnimationFrame(stepLoco);
    }

    function scheduleLoco() {
      if (!switched) return; // still on static `right` CSS — nothing to chase from (also true pre-mouse, touch, and reduced motion)
      if (locoPausedRef.current) return;
      if (locoRaf != null) return; // mid-cycle already; it reconsiders at its own boundary
      considerNextMove(performance.now());
    }
    scheduleLocoRef.current = scheduleLoco;

    function handlePointerMove(e: PointerEvent) {
      if (!chaseAcceptsPointer(e.pointerType)) return;
      ensureSwitched();
      targetX.current = clampCanvasLeft(e.clientX - (ART_LEFT_PX + ART_RIGHT_PX) / 2);
      scheduleLoco();
    }

    function handleResize() {
      if (!switched) return; // still on static `right` CSS — the browser handles this
      cancelLoco();
      const clampedTarget = clampCanvasLeft(targetX.current);
      targetX.current = clampedTarget;
      currentX.current = clampCanvasLeft(currentX.current);
      writeLeft(currentX.current);
      scheduleLoco();
    }

    function startChase() {
      if (chaseActiveRef.current) return;
      chaseActiveRef.current = true;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("resize", handleResize);
    }

    function stopChase() {
      if (!chaseActiveRef.current) return;
      chaseActiveRef.current = false;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", handleResize);
      cancelLoco();
      switched = false;
      lastWritten = null;
      lastShiftWritten = BUBBLE_REST_SHIFT_PX;
      if (wrapperRef.current) {
        wrapperRef.current.style.left = "";
        wrapperRef.current.style.right = `${REST_INSET}px`;
        wrapperRef.current.style.setProperty(
          "--bubble-shift",
          `${BUBBLE_REST_SHIFT_PX}px`,
        );
      }
      setFrame(IDLE_FRAME);
    }

    startChaseRef.current = startChase;
    if (!reducedMotionRef.current && hasInteractedRef.current) startChase();

    function handleMotionChange(e: MediaQueryListEvent) {
      reducedMotionRef.current = e.matches;
      if (e.matches) stopChase();
      else if (hasInteractedRef.current) startChase();
    }
    mql.addEventListener("change", handleMotionChange);

    return () => {
      stopChase();
      // Unconditional, not folded into stopChase: stopChase early-returns
      // when the chase was never active, but a loco cycle can still be live
      // in that state (e.g. reduced motion toggled on mid-hop) and must not
      // keep ticking after unmount.
      cancelLoco();
      mql.removeEventListener("change", handleMotionChange);
      startChaseRef.current = () => {};
      scheduleLocoRef.current = () => {};
      cancelLocoRef.current = () => {};
    };
  }, []);

  function cancelHop() {
    if (hopRaf.current != null) {
      cancelAnimationFrame(hopRaf.current);
      hopRaf.current = null;
    }
    hopStart.current = null;
  }

  // The entering hop — plays exactly once, on the very first click, as
  // Bunson rises from a peek to fully revealed. Hands off to the speaking
  // crossfade via `setEntering(false)` once it resolves.
  function stepHop(ts: number) {
    if (hopStart.current == null) return; // cancelled
    const idx = hopFrameIndex(ts - hopStart.current);
    if (idx == null) {
      hopRaf.current = null;
      hopStart.current = null;
      lastFrameIdx.current = null;
      setFrame(IDLE_FRAME);
      setEntering(false);
      return;
    }
    if (idx !== lastFrameIdx.current) {
      lastFrameIdx.current = idx;
      setFrame(HOP_FRAMES[idx]);
    }
    hopRaf.current = requestAnimationFrame(stepHop);
  }

  function pickLine() {
    const { line, nextState } = pickBunsonLine(facts, lines, lineStateRef.current);
    lineStateRef.current = nextState;
    return line;
  }

  // The visual bubble and the screen-reader announcement are deliberately two
  // separate pieces of state, not one. The visual bubble gets a fresh `key`
  // every accepted click so its entrance animation replays (a re-click while
  // already speaking only changes text, and `animate-in` classes only fire on
  // mount) — but re-inserting `role="status"` *with* its content already
  // present is exactly the unreliable case for screen-reader announcements
  // (many ATs, VoiceOver especially, only reliably announce a live region
  // whose content changes after it's already in the DOM). So `srText` lives on
  // a persistent, never-remounted, visually hidden node instead: it's set
  // alongside the visual bubble on every click, but since the no-immediate-
  // repeat picker guarantees the text always changes, updating that
  // already-mounted node's content is the reliable path every time.
  function clearAllTimers() {
    if (bubbleExitStartTimer.current) clearTimeout(bubbleExitStartTimer.current);
    if (bubbleUnmountTimer.current) clearTimeout(bubbleUnmountTimer.current);
    if (speakEndTimer.current) clearTimeout(speakEndTimer.current);
  }

  useEffect(() => {
    return () => {
      cancelHop();
      clearAllTimers();
    };
  }, []);

  function handleClick() {
    // Click always wins: stop taking new hops immediately (locoPausedRef) and
    // cancel anything already in flight rather than letting it finish — a
    // barely-perceptible snap next to everything else that starts at the same
    // instant (bubble appearing, crossfade beginning), and far simpler than
    // coordinating "wait for landing" against the speaking transition.
    locoPausedRef.current = true;
    cancelLocoRef.current();
    cancelHop(); // a re-click during the once-ever entering hop must not let it keep overwriting `frame`

    if (!hasInteractedRef.current) {
      hasInteractedRef.current = true;
      if (!reducedMotionRef.current) startChaseRef.current();
    }

    bubbleKeyRef.current += 1;
    lookUpFacts();
    const line = pickLine();
    setBubble(line);
    setSrText(line);
    setExiting(false);

    if (!revealed) {
      // First click ever: rise from a peek to fully revealed. This never
      // reverses — he never sinks back below the fold after this.
      setRevealed(true);
      if (!reducedMotionRef.current) {
        setEntering(true);
        lastFrameIdx.current = 0;
        setFrame(HOP_FRAMES[0]); // committed in this click's own render, not 90ms later
        hopStart.current = performance.now();
        hopRaf.current = requestAnimationFrame(stepHop);
      } else {
        // No hop under reduced motion — go straight to the speaking pose.
        setEntering(false);
        setFrame(IDLE_FRAME);
      }
    } else {
      // Already revealed: no hop-in-place, straight to speaking.
      setEntering(false);
      setFrame(IDLE_FRAME);
    }

    clearAllTimers();
    bubbleExitStartTimer.current = setTimeout(() => {
      setSrText(null);
      setExiting(true);
    }, BUBBLE_MS);
    bubbleUnmountTimer.current = setTimeout(() => {
      setBubble(null);
      setExiting(false);
    }, BUBBLE_MS + BUBBLE_EXIT_MS);
    speakEndTimer.current = setTimeout(() => {
      locoPausedRef.current = false;
      scheduleLocoRef.current();
    }, RESUME_LOCO_MS);
  }

  const visibleHeight = speaking ? SPEAK_HEIGHT_PX : revealed ? GROUND_PX : PEEK_PX;
  const hitboxTop = speaking ? SPEAK_TOP_PX : ART_TOP_PX;

  return (
    <div
      ref={wrapperRef}
      data-bunson-corner
      className="pointer-events-none fixed bottom-[var(--bottom-bar-h,0px)]"
      style={
        {
          // No explicit z-index on purpose: Bunson is DOM-last in the app
          // shell, so he paints above plain in-flow content by default, but
          // anything the page deliberately layers (a dropdown's z-10, the
          // top-bar menu's z-20, a dialog's z-50) keeps winning over him
          // automatically — no ladder to remember to climb.
          right: REST_INSET,
          "--bubble-shift": `${BUBBLE_REST_SHIFT_PX}px`,
        } as CSSProperties
      }
    >
      {/* Persistent, never-remounted live region for the announcement — see
          the comment above clearAllTimers for why this has to be separate
          from the visual bubble below (which intentionally *does* remount
          every click, for its entrance animation). */}
      <div role="status" className="sr-only">
        {srText}
      </div>
      {bubble && (
        <div
          key={bubbleKeyRef.current}
          aria-hidden="true"
          className={
            "pointer-events-none absolute left-[calc(50%+var(--bubble-shift))] -translate-x-1/2 origin-bottom rounded-2xl border border-border bg-card p-3 text-sm text-foreground shadow-lg duration-200 " +
            (exiting
              ? "animate-out fade-out-0 zoom-out-95 slide-out-to-bottom-2 fill-mode-forwards"
              : "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2")
          }
          style={{
            bottom: `calc(100% - ${BUBBLE_ANCHOR_TOP_PX - BUBBLE_LIFT_PX}px)`,
            width: BUBBLE_WIDTH_PX,
          }}
        >
          {bubble}
          <div
            className="absolute -bottom-1.5 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-border bg-card"
            style={{
              left: `clamp(36px, calc(50% - var(--bubble-shift)), calc(100% - 36px))`,
            }}
          />
        </div>
      )}
      {/* A hard clip, not a translateY guess: the box below the fold is simply
          not there, so the visible sliver always lines up flush with the true
          bottom edge instead of floating above it. Three height tiers, each
          derived from that pose's own alpha bbox — peek, fully revealed, and
          (taller) speaking — so the same guarantee holds at every one, not
          just at rest. */}
      <div
        className="relative pointer-events-none overflow-hidden transition-[height] duration-300 ease-out"
        style={{ height: visibleHeight, width: SPRITE_SIZE }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- small local pixel-art frames, cycled via JS; next/image's srcset blurs pixel art */}
        <img
          src={frame}
          alt=""
          width={SPRITE_SIZE}
          height={SPRITE_SIZE}
          style={{
            display: "block",
            // LOCO_FRAMES face right; mirrored for leftward travel. Idle and
            // the entering hop are front-facing enough that flipping them
            // when `frame` isn't a loco frame is a harmless no-op.
            transform: locoDirection === -1 ? "scaleX(-1)" : undefined,
          }}
          className={
            "pointer-events-none [image-rendering:pixelated] drop-shadow-md transition-opacity duration-300 ease-out " +
            (speaking ? "opacity-0" : "opacity-100")
          }
        />
        {/* Always mounted (not just while speaking) so it's already decoded
            before the first click and so its opacity transition has a real
            "before" value to animate from. Both this and the layer above
            fade in opposite directions — periscope's silhouette is
            different enough from idle's that a fade-in-only would leave
            idle's outline poking out at the midpoint. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
        <img
          src={PERISCOPE_FRAME}
          alt=""
          width={SPRITE_SIZE}
          height={SPRITE_SIZE}
          style={{ display: "block" }}
          className={
            "pointer-events-none absolute left-0 top-0 [image-rendering:pixelated] drop-shadow-md transition-opacity duration-300 ease-out " +
            (speaking ? "opacity-100" : "opacity-0")
          }
        />
      </div>
      {/* Click target bounded to the current pose's own bbox (not the
          mostly-transparent 136x136 canvas) so Bunson doesn't steal clicks
          from page UI as he follows the cursor along the bottom edge. */}
      <button
        type="button"
        onClick={handleClick}
        aria-label={`Say hi to ${mascot.name}, the household's rabbit mascot`}
        className="pointer-events-auto absolute rounded-md outline-none transition-[top,height] duration-300 ease-out focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{
          left: ART_LEFT_PX,
          top: hitboxTop,
          width: ART_WIDTH_PX,
          height: Math.max(0, visibleHeight - hitboxTop),
        }}
      />
    </div>
  );
}
