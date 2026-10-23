import { memo } from "react";
import type { Weather } from "@/lib/pet/behavior";
import type { RoomSlot } from "@/lib/pet/items";
import { ROOM_W, SLOT_ANCHORS, type Season, type Sky } from "@/lib/pet/room";

/**
 * Phase 47: the pet's room, side on: a wall with a window onto the real sky and weather, a
 * shelf, a wooden floor, the bed, food bowl and toy box that every room has, and whatever
 * decorations are in its slots. The pet, toys and buttons sit on top (pet-screen.tsx), placed
 * in the same 400 × 260 frame as percentages. Drawn in-house; swappable like the pet.
 */

const ROOM_H = 260;
const FLOOR_Y = 175;

const POOP_SPOTS = [
  { x: 150, y: 238 },
  { x: 182, y: 250 },
  { x: 228, y: 244 },
  { x: 120, y: 252 },
];

const SKY: Record<Sky, [string, string]> = {
  dawn: ["#ffc8a2", "#ffeacb"],
  day: ["#7cc8ff", "#d8f1ff"],
  dusk: ["#ff9e7a", "#8f78e0"],
  night: ["#17223f", "#2e3f6b"],
};

const ink = { stroke: "#1f2933", strokeWidth: 2, strokeLinejoin: "round" as const };

function Decoration({ id }: { id: string }) {
  switch (id) {
    case "plant":
      return (
        <g>
          <path d="M -10 0 L -12 -16 L 12 -16 L 10 0 Z" fill="#e07a4f" {...ink} />
          <path d="M 0 -16 C -4 -30 -16 -32 -18 -40 C -6 -38 0 -30 0 -16 C 0 -32 8 -42 16 -44 C 14 -34 6 -28 0 -16" fill="#6cc551" {...ink} />
        </g>
      );
    case "cushion":
      return <ellipse cx={0} cy={-8} rx={24} ry={9} fill="#ff8fb1" {...ink} />;
    case "beanbag":
      return <path d="M -26 0 C -30 -24 -10 -34 0 -34 C 14 -34 30 -22 26 0 Z" fill="#a68bff" {...ink} />;
    case "poster":
      return (
        <g>
          <rect x={-24} y={-56} width={48} height={56} rx={3} fill="#2e3f6b" {...ink} />
          <path d="M 0 -42 l 4 9 l 10 1 l -7 7 l 2 10 l -9 -5 l -9 5 l 2 -10 l -7 -7 l 10 -1 Z" fill="#ffd23f" />
          <circle cx={-14} cy={-12} r={1.5} fill="#fff" />
          <circle cx={15} cy={-48} r={1.2} fill="#fff" />
        </g>
      );
    case "clock":
      return (
        <g>
          <path d="M -18 -30 L 0 -50 L 18 -30 L 18 0 L -18 0 Z" fill="#b5835a" {...ink} />
          <circle cx={0} cy={-18} r={10} fill="#fffaf0" {...ink} strokeWidth={1.5} />
          <path d="M 0 -18 v -6 M 0 -18 h 5" stroke="#1f2933" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M -4 0 v 10 M 4 0 v 14" stroke="#1f2933" strokeWidth="1.2" />
        </g>
      );
    case "lamp":
      return (
        <g>
          <rect x={-10} y={-4} width={20} height={4} rx={2} fill="#5b6670" />
          <path d="M 0 -4 V -26" stroke="#5b6670" strokeWidth="3" />
          <path d="M -14 -24 L -9 -40 L 9 -40 L 14 -24 Z" fill="#ffd23f" {...ink} />
        </g>
      );
    case "fishbowl":
      return (
        <g>
          <circle cx={0} cy={-14} r={14} fill="#bfe6ff" opacity={0.9} {...ink} />
          <path d="M -4 -14 q 6 -6 10 0 q -4 6 -10 0 l -5 -4 v 8 Z" fill="#ff8a3d" />
        </g>
      );
    case "flowers":
      return (
        <g>
          <rect x={-26} y={-8} width={52} height={8} rx={2} fill="#b5835a" {...ink} />
          {[-18, -6, 6, 18].map((x, i) => (
            <g key={x}>
              <path d={`M ${x} -8 V -18`} stroke="#4f9a57" strokeWidth="2" />
              <circle cx={x} cy={-21} r={4.5} fill={["#ff6b57", "#ffd23f", "#ff8fb1", "#a68bff"][i]} {...ink} strokeWidth={1.2} />
            </g>
          ))}
        </g>
      );
    case "fairy-lights":
      return (
        <g>
          <path d="M -40 -60 Q -20 -48 0 -56 Q 20 -64 40 -52" stroke="#5b6670" strokeWidth="1.5" fill="none" />
          {[-34, -22, -10, 2, 14, 26, 36].map((x, i) => (
            <circle key={x} cx={x} cy={-56 + (i % 2 === 0 ? 4 : -2)} r={3} fill={["#ffd23f", "#ff8fb1", "#4fb3ff", "#a3d95b"][i % 4]} className="pet-twinkle" />
          ))}
        </g>
      );
    case "rocket":
      return (
        <g>
          <path d="M 0 -48 C 10 -38 10 -16 8 -6 L -8 -6 C -10 -16 -10 -38 0 -48 Z" fill="#fffaf0" {...ink} />
          <circle cx={0} cy={-28} r={4} fill="#4fb3ff" {...ink} strokeWidth={1.2} />
          <path d="M -8 -14 L -14 0 L -6 -6 Z M 8 -14 L 14 0 L 6 -6 Z" fill="#ff6b57" {...ink} strokeWidth={1.2} />
        </g>
      );
    case "rainbow":
      return (
        <g>
          <rect x={-26} y={-50} width={52} height={40} rx={3} fill="#fffaf0" {...ink} />
          {["#ff6b57", "#ffd23f", "#a3d95b", "#4fb3ff"].map((color, i) => (
            <path key={color} d={`M ${-18 + i * 4} -16 A ${18 - i * 4} ${18 - i * 4} 0 0 1 ${18 - i * 4} -16`} stroke={color} strokeWidth="3.5" fill="none" />
          ))}
        </g>
      );
    default:
      return null;
  }
}

function Window({ sky, weather, season }: { sky: Sky; weather: Weather; season: Season }) {
  const [top, bottom] = SKY[sky];
  const night = sky === "night";
  return (
    <g>
      <defs>
        <linearGradient id="pet-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <clipPath id="pet-window">
          <rect x={152} y={24} width={96} height={76} rx={4} />
        </clipPath>
      </defs>
      <rect x={152} y={24} width={96} height={76} rx={4} fill="url(#pet-sky)" />
      <g clipPath="url(#pet-window)">
        {night ? (
          <>
            <circle cx={222} cy={44} r={9} fill="#fff6d6" />
            <circle cx={226} cy={41} r={8} fill={top} />
            {[[170, 40], [190, 56], [236, 70], [176, 76]].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={1.2} fill="#fff" className="pet-twinkle" />
            ))}
          </>
        ) : (
          weather === "clear" && <circle cx={222} cy={46} r={10} fill="#ffd23f" />
        )}
        {(weather === "cloudy" || weather === "rain" || weather === "snow") && (
          <g fill={night ? "#5b6670" : "#ffffff"} opacity={0.9}>
            <ellipse cx={180} cy={44} rx={18} ry={9} />
            <ellipse cx={196} cy={40} rx={14} ry={10} />
            <ellipse cx={226} cy={56} rx={16} ry={8} />
          </g>
        )}
        {weather === "rain" && (
          <g stroke="#4fb3ff" strokeWidth="1.6" strokeLinecap="round" className="pet-rain">
            {[160, 172, 184, 196, 208, 220, 232, 244].map((x, i) => (
              <path key={x} d={`M ${x} ${50 + (i % 3) * 12} l -3 8`} />
            ))}
          </g>
        )}
        {weather === "snow" && (
          <g fill="#ffffff" className="pet-snow">
            {[160, 174, 188, 202, 216, 230, 244].map((x, i) => (
              <circle key={x} cx={x} cy={48 + (i % 3) * 14} r={2} />
            ))}
          </g>
        )}
        {season === "autumn" && weather !== "snow" && (
          <g className="pet-leaves">
            <ellipse cx={170} cy={70} rx={3} ry={2} fill="#e07a4f" transform="rotate(30 170 70)" />
            <ellipse cx={232} cy={86} rx={3} ry={2} fill="#f2b33d" transform="rotate(-20 232 86)" />
          </g>
        )}
        {season === "spring" && (
          <g>
            <path d="M 248 30 Q 230 34 214 30" stroke="#7f6f60" strokeWidth="2" fill="none" />
            {[230, 220, 238].map((x) => (
              <circle key={x} cx={x} cy={32} r={3} fill="#ffb3c8" />
            ))}
          </g>
        )}
        {/* The hills outside. */}
        <path d="M 152 100 Q 180 82 206 92 Q 230 80 248 92 V 100 Z" fill={night ? "#24395c" : season === "winter" ? "#f2f6fa" : season === "autumn" ? "#d8a65a" : "#8fd36b"} />
      </g>
      <rect x={152} y={24} width={96} height={76} rx={4} fill="none" stroke="#fffaf0" strokeWidth="6" />
      <path d="M 200 24 V 100 M 152 62 H 248" stroke="#fffaf0" strokeWidth="4" />
      <rect x={152} y={24} width={96} height={76} rx={4} fill="none" {...ink} />
      <rect x={142} y={100} width={116} height={8} rx={2} fill="#fffaf0" {...ink} />
      {season === "winter" && <path d="M 144 100 q 10 -5 20 0 q 14 -6 26 0 q 20 -6 40 0 q 12 -5 26 0" fill="#ffffff" />}
    </g>
  );
}

/** Memoized: the room only changes with its own props, not when the pet moves or looks around. */
export const PetRoom = memo(function PetRoom({
  sky,
  weather,
  season,
  awake,
  decor,
  poops,
}: {
  sky: Sky;
  weather: Weather;
  season: Season;
  awake: boolean;
  decor: Partial<Record<RoomSlot, string>>;
  poops: number;
}) {
  const lampSlot = (Object.keys(decor) as RoomSlot[]).find((slot) => decor[slot] === "lamp");
  return (
    <svg viewBox={`0 0 ${ROOM_W} ${ROOM_H}`} className="absolute inset-0 size-full" aria-hidden="true">
      {/* Wall, with soft stripes, and the floor. */}
      <rect width={ROOM_W} height={FLOOR_Y} fill="#fbeedb" />
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={i * 40 + 14} y={0} width={12} height={FLOOR_Y} fill="#f6e3c8" />
      ))}
      <rect y={FLOOR_Y} width={ROOM_W} height={ROOM_H - FLOOR_Y} fill="#e7c08e" />
      {[195, 218, 241].map((y) => (
        <path key={y} d={`M 0 ${y} H ${ROOM_W}`} stroke="#d4a874" strokeWidth="1.5" />
      ))}
      <rect y={FLOOR_Y - 6} width={ROOM_W} height={8} fill="#fffaf0" stroke="#1f2933" strokeWidth="1.5" />

      <Window sky={sky} weather={weather} season={season} />

      {/* The shelf. */}
      <rect x={290} y={93} width={90} height={7} rx={2} fill="#b5835a" {...ink} />
      <path d="M 300 100 l 6 10 M 370 100 l -6 10" stroke="#1f2933" strokeWidth="2" />

      {/* The rug, food bowl, toy box and bed every room has. */}
      <ellipse cx={190} cy={228} rx={86} ry={20} fill="#ffd9a8" stroke="#f2b36b" strokeWidth="3" />
      <g transform="translate(26 236)">
        <path d="M -16 0 Q -14 12 0 12 Q 14 12 16 0 Z" fill="#4fb3ff" {...ink} />
        <ellipse cx={0} cy={0} rx={16} ry={4} fill="#d97d3a" {...ink} strokeWidth={1.5} />
      </g>
      <g transform="translate(112 206)">
        <rect x={-22} y={-26} width={44} height={28} rx={3} fill="#ff6b57" {...ink} />
        <rect x={-24} y={-30} width={48} height={8} rx={2} fill="#ffd23f" {...ink} />
        <circle cx={-8} cy={-12} r={3} fill="#fffaf0" />
        <circle cx={8} cy={-12} r={3} fill="#fffaf0" />
      </g>
      <g transform="translate(345 232)">
        <rect x={-46} y={-26} width={92} height={22} rx={8} fill="#8fd3ff" {...ink} />
        <rect x={-46} y={-40} width={14} height={36} rx={5} fill="#b5835a" {...ink} />
        <ellipse cx={-22} cy={-26} rx={14} ry={7} fill="#fffaf0" {...ink} strokeWidth={1.5} />
      </g>

      {Object.entries(decor).map(([slot, id]) => {
        const anchor = SLOT_ANCHORS[slot as RoomSlot];
        return anchor && id ? (
          <g key={slot} transform={`translate(${anchor.x} ${anchor.y})`}>
            <Decoration id={id} />
          </g>
        ) : null;
      })}

      {POOP_SPOTS.slice(0, poops).map(({ x, y }) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <path d="M -9 0 Q -10 -6 -4 -7 Q -6 -13 0 -14 Q 6 -13 4 -7 Q 10 -6 9 0 Z" fill="#8a5a3b" {...ink} strokeWidth={1.5} />
          <path d="M -3 -18 q 2 -3 0 -6 M 3 -19 q 2 -3 0 -6" stroke="#5b6670" strokeWidth="1.2" fill="none" className="pet-stink" />
        </g>
      ))}

      {!awake && <rect width={ROOM_W} height={ROOM_H} fill="#141a33" opacity={0.5} />}
      {!awake && lampSlot && (
        <circle cx={SLOT_ANCHORS[lampSlot].x} cy={SLOT_ANCHORS[lampSlot].y - 30} r={70} fill="#ffd23f" opacity={0.18} />
      )}
    </svg>
  );
});
