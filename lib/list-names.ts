import { z } from "zod";

/**
 * Phase 37: names and emoji for the short lists a family edits by hand (Groceries' store
 * sections, a money jar's categories). Pure; shared by both, so the two pages accept the same
 * things and say the same thing when they don't.
 */

export const LIST_NAME_MAX = 40;

// Control characters, plus the invisible and direction-changing ones (soft hyphen, combining
// grapheme joiner, zero-width space and non-joiner, direction marks and embeddings, word
// joiner and invisible operators, byte-order mark), as lib/app-name.ts drops. The zero-width
// joiner stays: emoji like a family or a cook are built with it. Built from code points so
// this file holds none of them.
const INVISIBLE = new RegExp(
  `[\\p{Cc}${[[0xad], [0x34f], [0x200b, 0x200c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0xfeff]]
    .map(([lo, hi = lo]) => `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`)
    .join("")}]`,
  "gu",
);

/**
 * One line, single-spaced, with nothing invisible (INVISIBLE above), since those would make
 * two names look alike or read differently than they're stored.
 */
export function cleanListName(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(INVISIBLE, "").trim();
}

export const listNameSchema = z
  .string()
  .transform(cleanListName)
  .pipe(z.string().min(1, "Give it a name.").max(LIST_NAME_MAX, `Keep the name to ${LIST_NAME_MAX} characters.`));

/** Two names are the same one when they differ only in case ("Pets" and "pets"). */
export function sameListName(a: string, b: string): boolean {
  return cleanListName(a).toLocaleLowerCase("en-US") === cleanListName(b).toLocaleLowerCase("en-US");
}

/** Whether `name` is already used by another row (`exceptId`: the row being renamed). */
export function nameTaken(name: string, rows: { id: string; name: string }[], exceptId?: string): boolean {
  return rows.some((r) => r.id !== exceptId && sameListName(r.name, name));
}

// The joiners an emoji is built from, as code points so this file holds no invisible
// characters: zero-width joiner (family and job emoji), variation selector 16 (emoji style),
// the keycap mark, and the tag letters of subdivision flags.
const ZWJ = 0x200d;
const VS16 = 0xfe0f;
const KEYCAP = 0x20e3;
const isTag = (cp: number) => cp >= 0xe0020 && cp <= 0xe007f;
const isRegional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const MODIFIER = /\p{Emoji_Modifier}/u;
// The longest real emoji (a family, a subdivision flag) is well under this.
const EMOJI_MAX = 32;

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * One emoji, or nothing: "" is no emoji (null); anything else must be a single emoji made only
 * of emoji parts (so no letters, words or hidden text ride along). undefined: not one emoji.
 */
export function cleanEmoji(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  if (s.length > EMOJI_MAX || [...segmenter.segment(s)].length !== 1) return undefined;
  let pictures = 0;
  let regional = 0;
  let keycap = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (PICTOGRAPH.test(ch)) pictures++;
    else if (isRegional(cp)) regional++;
    else if (cp === KEYCAP) keycap = true;
    else if (!(MODIFIER.test(ch) || cp === ZWJ || cp === VS16 || isTag(cp) || /^[0-9#*]$/.test(ch))) return undefined;
  }
  // Tag characters only ever spell a subdivision flag, never text hidden behind an emoji.
  if ([...s].some((ch) => isTag(ch.codePointAt(0)!)) && !isSubdivisionFlag(s)) return undefined;
  // A keycap (1️⃣) is a digit, # or * with the keycap mark; a flag is two regional letters.
  return pictures > 0 || regional === 2 || keycap ? s : undefined;
}

const BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;

/** 🏴 then a short region code in tag letters and digits, then the cancel tag (England, Wales…). */
function isSubdivisionFlag(s: string): boolean {
  const cps = [...s].map((ch) => ch.codePointAt(0)!);
  const code = cps.slice(1, -1);
  return (
    cps[0] === BLACK_FLAG &&
    cps.at(-1) === CANCEL_TAG &&
    code.length >= 2 &&
    code.length <= 7 &&
    code.every((cp) => (cp >= 0xe0061 && cp <= 0xe007a) || (cp >= 0xe0030 && cp <= 0xe0039))
  );
}

export const emojiSchema = z
  .string()
  .max(64)
  .transform((s, ctx) => {
    const emoji = cleanEmoji(s);
    if (emoji === undefined) {
      ctx.addIssue({ code: "custom", message: "Pick one emoji, or leave it empty." });
      return z.NEVER;
    }
    return emoji;
  });
