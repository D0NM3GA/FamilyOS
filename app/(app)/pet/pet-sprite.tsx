import type { Mood, Pose } from "@/lib/pet/motion";
import type { Species, Stage } from "@/lib/pet/state";

/**
 * Phase 47: the pet, drawn from parts (body, eyes, mouth, ears or wings, a hat) so a mood or
 * pose is a small change, not a new picture. Everything that would change if this were swapped
 * for sprite sheets later comes in as a prop; nothing outside knows how a pet is drawn.
 * Animations are CSS classes (app/globals.css, `pet-*`), which reduced motion turns into a
 * still pose.
 */


type Palette = { body: string; belly: string; accent: string };

/** Splendid first, scruffy last: brighter and tidier forms for better care. */
const PALETTES: Record<Species, readonly Palette[]> = {
  blob: [
    { body: "#7ee0b5", belly: "#c9f5e3", accent: "#2fa77a" },
    { body: "#8fd3ff", belly: "#d4eeff", accent: "#3a8fd1" },
    { body: "#c3b4ff", belly: "#e7e0ff", accent: "#7d67d6" },
    { body: "#b9b39b", belly: "#dcd8c6", accent: "#7d7760" },
  ],
  bird: [
    { body: "#ffcf4d", belly: "#fff0bf", accent: "#f08a24" },
    { body: "#ff9db5", belly: "#ffd9e3", accent: "#e0567a" },
    { body: "#9bd1a0", belly: "#d6eed8", accent: "#4f9a57" },
    { body: "#b8a99a", belly: "#ddd3c8", accent: "#7f6f60" },
  ],
  critter: [
    { body: "#f2b48c", belly: "#fde3d0", accent: "#c76f3d" },
    { body: "#d9c7f2", belly: "#f1e9fb", accent: "#9271c4" },
    { body: "#c9d6e3", belly: "#ebf0f5", accent: "#6f87a0" },
    { body: "#a99a8c", belly: "#d6ccc2", accent: "#6d5f52" },
  ],
};

const STAGE_SCALE: Record<Stage, number> = { egg: 0.7, baby: 0.6, child: 0.75, teen: 0.9, adult: 1 };

/** Which palette a stage and form use: babies are always the bright one. */
function paletteFor(species: Species, stage: Stage, form: number): Palette {
  const palettes = PALETTES[species];
  if (stage === "baby" || stage === "egg") return palettes[0];
  const forms = stage === "child" ? 2 : stage === "teen" ? 3 : 4;
  // Spread a stage's forms across the four palettes, splendid to scruffy.
  return palettes[Math.round((form / Math.max(1, forms - 1)) * (palettes.length - 1))];
}

function Eyes({ mood, look }: { mood: Mood; look: { x: number; y: number } }) {
  const dx = look.x * 2;
  const dy = look.y * 1.5;
  if (mood === "asleep" || mood === "petted") {
    // Closed: a sleepy line, or happy upturned arcs when petted.
    const path = mood === "asleep" ? "M -12 -4 h 7 M 5 -4 h 7" : "M -12 -3 q 3.5 -5 7 0 M 5 -3 q 3.5 -5 7 0";
    return <path d={path} stroke="#1f2933" strokeWidth="2.2" strokeLinecap="round" fill="none" />;
  }
  if (mood === "sick") {
    return (
      <g stroke="#1f2933" strokeWidth="2" strokeLinecap="round">
        <path d="M -11 -7 l 5 5 M -6 -7 l -5 5 M 6 -7 l 5 5 M 11 -7 l -5 5" />
      </g>
    );
  }
  const big = mood === "excited" ? 5.2 : 4.4;
  return (
    <g className="pet-blink">
      <ellipse cx={-8.5} cy={-4} rx={big} ry={big + 0.8} fill="#fff" />
      <ellipse cx={8.5} cy={-4} rx={big} ry={big + 0.8} fill="#fff" />
      <circle cx={-8.5 + dx} cy={-3.5 + dy} r={2.6} fill="#1f2933" />
      <circle cx={8.5 + dx} cy={-3.5 + dy} r={2.6} fill="#1f2933" />
      <circle cx={-7.6 + dx} cy={-4.6 + dy} r={0.9} fill="#fff" />
      <circle cx={9.4 + dx} cy={-4.6 + dy} r={0.9} fill="#fff" />
    </g>
  );
}

function Mouth({ mood, species }: { mood: Mood; species: Species }) {
  if (species === "bird") {
    const open = mood === "eating" || mood === "excited";
    return (
      <g fill="#f08a24" stroke="#c4650f" strokeWidth="0.8" strokeLinejoin="round">
        <path d={open ? "M -4 3 L 4 3 L 0 7 Z" : "M -4 3 L 4 3 L 0 8 Z"} />
        {open && <path d="M -4 9 L 4 9 L 0 12 Z" />}
      </g>
    );
  }
  const d =
    mood === "sad" || mood === "sick"
      ? "M -5 8 q 5 -4 10 0"
      : mood === "eating"
        ? "M -3.5 5 a 3.5 3.5 0 1 0 7 0 a 3.5 3.5 0 1 0 -7 0"
        : mood === "excited" || mood === "happy" || mood === "petted"
          ? "M -6 4 q 6 7 12 0"
          : "M -4 5 q 4 3 8 0";
  return <path d={d} stroke="#1f2933" strokeWidth="2" strokeLinecap="round" fill={mood === "eating" ? "#7a2e2e" : "none"} />;
}

function Hat({ hat }: { hat: string | null }) {
  switch (hat) {
    case "party-hat":
      return (
        <g transform="translate(4 -40) rotate(12)">
          <path d="M -8 10 L 0 -12 L 8 10 Z" fill="#ff6b57" stroke="#1f2933" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx={0} cy={-12} r={3} fill="#ffd23f" stroke="#1f2933" strokeWidth="1.2" />
          <circle cx={-2} cy={2} r={1.5} fill="#ffd23f" />
          <circle cx={3} cy={-3} r={1.3} fill="#4fb3ff" />
        </g>
      );
    case "bow":
      return (
        <g transform="translate(12 -30)" stroke="#1f2933" strokeWidth="1.2" fill="#ff8fb1">
          <path d="M 0 0 L -9 -6 L -9 6 Z" />
          <path d="M 0 0 L 9 -6 L 9 6 Z" />
          <circle r={2.6} />
        </g>
      );
    case "crown":
      return (
        <path
          d="M -11 -30 L -11 -42 L -5 -35 L 0 -44 L 5 -35 L 11 -42 L 11 -30 Z"
          fill="#ffd23f"
          stroke="#1f2933"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      );
    case "sunglasses":
      return (
        <g fill="#1f2933">
          <rect x={-15} y={-9} width={12} height={8} rx={3} />
          <rect x={3} y={-9} width={12} height={8} rx={3} />
          <path d="M -3 -6 h 6" stroke="#1f2933" strokeWidth="1.5" />
        </g>
      );
    case "flower-crown":
      return (
        <g transform="translate(0 -28)">
          {[-14, -7, 0, 7, 14].map((x, i) => (
            <circle key={x} cx={x} cy={Math.abs(x) / 3} r={3.5} fill={["#ff8fb1", "#ffd23f", "#a68bff", "#ffd23f", "#ff8fb1"][i]} stroke="#1f2933" strokeWidth="0.8" />
          ))}
        </g>
      );
    default:
      return null;
  }
}

/** Phase 56: the crack grows a piece with each tap, left to right across the egg. */
const EGG_CRACKS = ["M -25 2 l 6 -5 l 4 6", "M -15 3 l 5 -7 l 5 6", "M -5 2 l 5 -6 l 4 5", "M 4 1 l 5 -6 l 5 7", "M 14 2 l 5 -5 l 6 4"];

function Egg({ species, cracks }: { species: Species; cracks: number }) {
  const { body, accent } = PALETTES[species][0];
  return (
    <g>
      <path d="M 0 -34 C 20 -34 26 0 26 10 C 26 26 14 34 0 34 C -14 34 -26 26 -26 10 C -26 0 -20 -34 0 -34 Z" fill="#fffaf0" stroke="#1f2933" strokeWidth="2" />
      <circle cx={-10} cy={-8} r={5} fill={body} />
      <circle cx={9} cy={4} r={7} fill={accent} opacity={0.7} />
      <circle cx={-4} cy={18} r={4} fill={body} />
      {EGG_CRACKS.slice(0, cracks).map((d) => (
        <path key={d} d={d} fill="none" stroke="#1f2933" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </g>
  );
}

function Body({ species, palette, scruffy }: { species: Species; palette: Palette; scruffy: boolean }) {
  const stroke = { stroke: "#1f2933", strokeWidth: 2 };
  switch (species) {
    case "blob":
      return (
        <g>
          {!scruffy && <path d="M 0 -26 q -2 -10 6 -14" stroke={palette.accent} strokeWidth="3" fill="none" strokeLinecap="round" />}
          {!scruffy && <ellipse cx={8} cy={-40} rx={5} ry={3.5} fill="#a3d95b" {...stroke} strokeWidth={1.2} />}
          <path d="M -28 18 C -30 -8 -18 -28 0 -28 C 18 -28 30 -8 28 18 C 26 28 -26 28 -28 18 Z" fill={palette.body} {...stroke} />
          <ellipse cx={0} cy={14} rx={15} ry={9} fill={palette.belly} />
        </g>
      );
    case "bird":
      return (
        <g>
          <path d={scruffy ? "M -4 -26 l -3 -9 l 5 4 l 2 -8 l 3 8 l 4 -5 l -2 10 Z" : "M -2 -26 q 2 -12 10 -12 q -6 5 -4 12 Z"} fill={palette.accent} {...stroke} strokeWidth={1.5} />
          <g className="pet-flap-left"><ellipse cx={-27} cy={6} rx={8} ry={13} fill={palette.accent} {...stroke} transform="rotate(20 -27 6)" /></g>
          <g className="pet-flap-right"><ellipse cx={27} cy={6} rx={8} ry={13} fill={palette.accent} {...stroke} transform="rotate(-20 27 6)" /></g>
          <ellipse cx={0} cy={2} rx={26} ry={28} fill={palette.body} {...stroke} />
          <ellipse cx={0} cy={14} rx={15} ry={12} fill={palette.belly} />
          <path d="M -8 29 v 6 M -11 35 h 6 M 8 29 v 6 M 5 35 h 6" stroke="#f08a24" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "critter":
      return (
        <g>
          <g className="pet-ear-left"><ellipse cx={-11} cy={-36} rx={6} ry={scruffy ? 13 : 17} fill={palette.body} {...stroke} transform={scruffy ? "rotate(-35 -11 -24)" : "rotate(-10 -11 -24)"} /></g>
          <g className="pet-ear-right"><ellipse cx={11} cy={-36} rx={6} ry={17} fill={palette.body} {...stroke} transform="rotate(10 11 -24)" /></g>
          <ellipse cx={-11} cy={-36} rx={2.5} ry={scruffy ? 8 : 11} fill={palette.belly} transform={scruffy ? "rotate(-35 -11 -24)" : "rotate(-10 -11 -24)"} />
          <ellipse cx={11} cy={-36} rx={2.5} ry={11} fill={palette.belly} transform="rotate(10 11 -24)" />
          <ellipse cx={0} cy={4} rx={27} ry={26} fill={palette.body} {...stroke} />
          <ellipse cx={0} cy={15} rx={15} ry={10} fill={palette.belly} />
          <ellipse cx={-12} cy={28} rx={7} ry={4} fill={palette.body} {...stroke} />
          <ellipse cx={12} cy={28} rx={7} ry={4} fill={palette.body} {...stroke} />
        </g>
      );
  }
}

export function PetSprite({
  species,
  stage,
  form,
  mood,
  pose,
  hat = null,
  look = { x: 0, y: 0 },
  cracks = 0,
  className,
}: {
  species: Species;
  stage: Stage;
  form: number;
  mood: Mood;
  pose: Pose;
  hat?: string | null;
  look?: { x: number; y: number };
  /** How far an egg has cracked (Phase 56), 0 for a whole one. */
  cracks?: number;
  className?: string;
}) {
  const scale = STAGE_SCALE[stage];
  const palette = paletteFor(species, stage, form);
  const scruffy = stage !== "baby" && palette === PALETTES[species][PALETTES[species].length - 1];
  return (
    <svg viewBox="-50 -60 100 100" className={className} aria-hidden="true" overflow="visible">
      <ellipse cx={0} cy={33} rx={24 * scale} ry={3.5} fill="#1f2933" opacity={0.15} />
      <g className={`pet-pose pet-pose-${pose}`}>
        <g transform={`translate(0 ${(1 - scale) * 34}) scale(${scale})`}>
          {stage === "egg" ? (
            <Egg species={species} cracks={cracks} />
          ) : (
            <>
              <Body species={species} palette={palette} scruffy={scruffy} />
              <g>
                <Eyes mood={mood} look={look} />
                {(mood === "petted" || mood === "happy" || mood === "excited") && (
                  <g fill="#ff8fb1" opacity={0.6}>
                    <ellipse cx={-16} cy={3} rx={4} ry={2.5} />
                    <ellipse cx={16} cy={3} rx={4} ry={2.5} />
                  </g>
                )}
                {mood === "sick" && <rect x={-26} y={-24} width={52} height={50} rx={24} fill="#a3d95b" opacity={0.25} />}
                <Mouth mood={mood} species={species} />
                <Hat hat={hat} />
              </g>
            </>
          )}
        </g>
      </g>
      {mood === "asleep" && (
        <g className="pet-zzz" fill="#5b6670" fontWeight="800" fontFamily="inherit">
          <text x={22} y={-30} fontSize="10">z</text>
          <text x={30} y={-40} fontSize="13">z</text>
        </g>
      )}
      {mood === "sick" && (
        <g transform="translate(20 -8) rotate(30)">
          <rect x={-2} y={-12} width={4} height={18} rx={2} fill="#fff" stroke="#1f2933" strokeWidth="1" />
          <circle cx={0} cy={7} r={3} fill="#ff6b57" stroke="#1f2933" strokeWidth="1" />
        </g>
      )}
    </svg>
  );
}
