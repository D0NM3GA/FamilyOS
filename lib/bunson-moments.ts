import { DEFAULT_REWARD_WORDS, rewardCount, type RewardWords } from "@/lib/reward-words";

/**
 * Phase 19.5: what Bunson says in his "moments" (greetings, empty pages, oops pages). Pure
 * strings, no prisma — importable from any domain zone, unlike lib/bunson-facts.ts.
 *
 * Tone (owner's call): Duolingo-style comedic nagging is fine, the kids love it. Bunson is
 * never sad and never guilt-trips for real.
 */
/** `stickers` is the points still on offer from pending chores (1 point = 1 sticker); the
 * corner-bubble facts only know counts, so it's optional there. */
export type ChoreProgress = { pending: number; done: number; stickers?: number };

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The current hour (0-23) in a time zone — the household's, so "Morning" means morning there. */
export function currentHour(timeZone: string | undefined, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now);
  return Number(hour) % 24;
}

/** Today's chore progress for one person, from board instances already in hand (no query). */
export function choreProgressFor(
  personId: string,
  board: { overdue: BoardLike[]; dueToday: BoardLike[] },
): ChoreProgress {
  const mine = (i: BoardLike) => i.assignedTo?.id === personId;
  const pending = [...board.overdue, ...board.dueToday].filter((i) => mine(i) && i.status === "PENDING");
  return {
    pending: pending.length,
    done: board.dueToday.filter((i) => mine(i) && i.status === "DONE").length,
    stickers: pending.reduce((sum, i) => sum + i.definition.points, 0),
  };
}

type BoardLike = { status: string; assignedTo: { id: string } | null; definition: { points: number } };

export function timeOfDayGreeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

/**
 * The Home greeting: the viewer's name plus one useful line about their day. `chores` is null
 * when the family turned Chores off (Settings → Apps): no teasing about an empty list then.
 */
export function greetingLine(firstName: string, hour: number, chores: ChoreProgress | null, words: RewardWords = DEFAULT_REWARD_WORDS): string {
  const hello = `${timeOfDayGreeting(hour)}, ${firstName}!`;
  if (!chores) return `${hello} Good to see you.`;
  if (chores.pending > 0) {
    return chores.stickers
      ? `${hello} ${rewardCount(chores.stickers, words)} to grab today.`
      : `${hello} ${plural(chores.pending, "chore")} to do today.`;
  }
  if (chores.done > 0) return `${hello} All your chores are done. Show-off. 😎`;
  return `${hello} Nothing on your list today. Suspicious. 🤔`;
}

/** A personal nag for the corner bubble, or null when there's nothing to say. */
export function personalChoreFact(firstName: string, chores: ChoreProgress): string | null {
  if (chores.pending > 0) {
    return `Psst, ${firstName}. ${plural(chores.pending, "chore")} still waiting. I can see ${chores.pending === 1 ? "it" : "them"} from here. 👀`;
  }
  if (chores.done > 0) return `All your chores are done, ${firstName}. Show-off. 😎`;
  return null;
}

export const MOMENT_LINES = {
  choresDone: "All done for today! Go do something fun.",
  medsDone: "All taken today! Gold star for everyone.",
  groceriesEmpty: "Nothing on the list. The fridge must be happy.",
  oops: "Oops, wrong tunnel. Let's hop back home.",
  notFound: "Hmm, I dug here and found nothing. Wrong tunnel?",
  storeHello: "Welcome to the shop! What'll it be today?",
  // Phase 26, money pages: only ever encouraging. No line for over budget (the plain
  // status says it); spending is nobody's chore to be nagged about.
  budgetStart: "Give a few categories a number and I'll keep an eye on them for you.",
  budgetUnder: "came in under budget last month. Nicely done!",
  // Phase 33: same rule. Only a drop gets a line, never a rise.
  trendsLower: "came in lower last month than the month before. Nice!",
  trendsEmpty: "Once some money moves through this jar, I'll show you where it went, month by month.",
  // Phase 34: same rule again. A climb gets a cheer; a dip gets nothing.
  worthEmpty: "Connect the bank feed in Settings, or add your home or car below, and I'll add it all up.",
  worthUp: "Net worth went up since last month. Look at you climb!",
} as const;
