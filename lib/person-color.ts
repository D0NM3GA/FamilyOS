import type { PersonColor } from "@/app/generated/prisma/enums";

/** Sticker-book ink: the outline/text color every person color is paired with. */
export const INK = "#1F2933";

/**
 * Phase 19 person colors. Every swatch carries ink text (not white): none of these bright
 * sticker colors pass WCAG AA with white text, and all of them pass with ink — asserted in
 * lib/person-color.test.ts, so a new swatch can't quietly regress that.
 */
export const PERSON_COLORS: Record<PersonColor, { label: string; bg: string }> = {
  SUN: { label: "Sunshine", bg: "#FFD23F" },
  TOMATO: { label: "Tomato", bg: "#FF6B57" },
  SKY: { label: "Sky", bg: "#4FB3FF" },
  LIME: { label: "Lime", bg: "#A3D95B" },
  GRAPE: { label: "Grape", bg: "#A68BFF" },
  PINK: { label: "Bubblegum", bg: "#FF8FB8" },
  ORANGE: { label: "Tangerine", bg: "#FFA14A" },
  TEAL: { label: "Mint", bg: "#3CCFB4" },
};

export const PERSON_COLOR_KEYS = Object.keys(PERSON_COLORS) as PersonColor[];

/** The person's chosen color, or a stable default derived from their id. */
export function personColorKey(person: { id: string; color: PersonColor | null }): PersonColor {
  if (person.color) return person.color;
  let hash = 0;
  for (const ch of person.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PERSON_COLOR_KEYS[hash % PERSON_COLOR_KEYS.length];
}

export function personColor(person: { id: string; color: PersonColor | null }) {
  return { bg: PERSON_COLORS[personColorKey(person)].bg, fg: INK };
}
