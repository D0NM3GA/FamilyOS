import type { CareOutcome } from "./care";
import { FOODS, type Food, type PetSpot, type Quirk, type Toy } from "./personality";
import type { Rng } from "./random";
import type { Species } from "./state";

/**
 * Phase 47: how the pet game talks. The rules (docs/BUILD.md, "The pet's voice"):
 *
 * - The pet never speaks English. Like a Pokémon saying its own name, each species has one
 *   sound ("blup", "pip", "mrrp") and the narrator says what it does. Show, don't label: "Pip
 *   flops over for a belly rub", not "Pip is happy".
 * - Two voices. Buttons, settings and errors are plain and short. The pet's lines are where the
 *   play goes: concrete, a bit silly, never cute-for-its-own-sake.
 * - Personality shows in the words, the way Animal Crossing villagers sound like their type: a
 *   bouncy pet's lines bounce, a shy one's peek.
 * - Lots of short lines, picked so the same one doesn't come twice in a row (`pickLine`).
 * - Written for a 7-year-old to read alone: short sentences, everyday words, few exclamation
 *   marks, no em dashes, no "Uh oh", no grown-up idioms.
 * - The world has one fixed place: Egg Island. Eggs come from there, and pets go back there.
 *
 * Placeholders: {name}, {sound}, {Sound} (capitalized), {food}, {toy}. Pure and client-safe.
 */

export const SOUNDS: Record<Species, string> = { blob: "blup", bird: "pip", critter: "mrrp" };

export const FOOD_NAMES: Record<Food, string> = {
  berries: "berries",
  "rice-ball": "a rice ball",
  pancake: "a pancake",
  carrot: "a carrot",
  fish: "a fish stick",
};

export const TOY_NAMES: Record<Toy, string> = { ball: "ball", plush: "plush", bubbles: "bubbles", drum: "drum", kite: "kite" };

export type LineContext = { name: string; species: Species; food?: Food; toy?: Toy };

/** Fills a line's placeholders. */
export function fill(line: string, context: LineContext): string {
  const sound = SOUNDS[context.species];
  return line
    .replaceAll("{name}", context.name)
    .replaceAll("{Sound}", sound[0].toUpperCase() + sound.slice(1))
    .replaceAll("{sound}", sound)
    .replaceAll("{food}", context.food ? FOOD_NAMES[context.food] : "dinner")
    .replaceAll("{toy}", context.toy ? TOY_NAMES[context.toy] : "toy");
}

/** One line from a pool, never the one said last if there's another to say. */
export function pickLine(pool: readonly string[], rng: Rng, last?: string | null): string {
  const options = pool.length > 1 ? pool.filter((line) => line !== last) : pool;
  return options[Math.floor(rng() * options.length)] ?? pool[0];
}

/** What's in the bowl at a meal: often its favorite, so there's a fair chance to notice. */
export function serveFood(favorite: Food, rng: Rng): Food {
  return rng() < 0.35 ? favorite : FOODS[Math.floor(rng() * FOODS.length)];
}

/* What it does when you look after it. */

export const MEAL_LINES = [
  "Nom nom nom. {name} licks the bowl clean.",
  "{name} eats {food} in three big bites.",
  "{Sound}! {name} wolfs it down and looks for more.",
  "{name} chews very slowly, like a food critic.",
  "Crumbs everywhere. {name} doesn't mind.",
];

/** When the meal happens to be its favorite. */
export const FAVORITE_MEAL_LINES = [
  "It's {food}! {name} does a happy dance before every bite.",
  "Is that {food}? {name}'s eyes go wide. Best. Dinner. Ever.",
];

export const SNACK_LINES = [
  "Crunch! {name} wants another one.",
  "{name} hides half the snack for later. Then eats it.",
  "{Sound} {sound}! Snack time is the best time.",
  "{name} catches the snack in mid-air.",
];

export const CLEAN_LINES = [
  "Scrub, scrub, done. The room smells like soap.",
  "All clean. {name} sniffs the floor to check.",
  "Mess gone. {name} looks very proud of you.",
];

export const MEDICINE_LINES = ["{name} makes a face, then gulps it down.", "Yuck, says {name}'s face. Gulp."];

export const CURED_LINES = ["The color's back in {name}'s cheeks.", "{name} sneezes once, then bounces up. All better.", "{Sound}! {name} feels like itself again."];

export const STILL_SICK_LINES = ["{name} feels a bit better. One more dose should do it.", "Better, but still wobbly. One more dose."];

export const SAY_NO_LINES = ["{name} stops fussing and sits up straight.", "{name} huffs, then settles down.", "No more fuss. {name} pretends that never happened."];

/** Petting, by spot. A favorite spot gets its own lines. */
export const PET_LINES: Record<PetSpot, readonly string[]> = {
  head: ["{name} closes its eyes and hums.", "Pat pat. {name} tilts its head into your hand."],
  cheeks: ["{name} squishes its cheek into your hand.", "Squish. {name} giggles."],
  belly: ["{name} flops over, giggling.", "Belly rub! {name}'s foot starts kicking."],
  back: ["{name} does a happy wiggle.", "{name} arches its back like a cat."],
};

export const FAVORITE_SPOT_LINES = ["That's the spot. {name} goes all floppy.", "{Sound}… {name} melts into a puddle of happy.", "{name} leans in and won't let you stop."];

export const TOY_LINES: Record<Toy, readonly string[]> = {
  ball: ["{name} chases the ball and brings it back. Mostly.", "Bonk. {name} heads the ball across the room."],
  plush: ["{name} gives the plush a very serious hug.", "{name} tells the plush a secret."],
  bubbles: ["{name} pops every bubble it can reach.", "One bubble lands on {name}'s nose. Pop!"],
  drum: ["Bom. Bom-bom. {name} has rhythm.", "{name} drums so hard it falls over."],
  kite: ["{name} runs back and forth with the kite string.", "The kite goes up. {name} goes up a tiny bit too."],
};

export const FAVORITE_TOY_LINES = ["The {toy}! {name} won't let go of it.", "{name} loves the {toy} more than anything."];

/** What it says to the outcomes that aren't a plain "ok". */
export const OUTCOME_LINES: Record<Exclude<CareOutcome, "ok" | "cured" | "still-sick">, readonly string[]> = {
  "not-hatched": ["The egg wobbles. Not yet.", "Tap tap. Something taps back."],
  full: ["{name} pushes the bowl away. Too full.", "{name} pats its round tummy. No room."],
  "too-many-snacks": ["Too many snacks. {name} has a tummy ache.", "{name} groans and holds its tummy. Medicine might help."],
  "nothing-to-clean": ["Already spotless.", "{name} looks around. Nothing to clean."],
  "not-sick": ["{name} isn't sick. It sticks its tongue out at the spoon.", "No medicine needed. {name} feels fine."],
  "nothing-to-scold": ["{name} wasn't doing anything. It looks confused.", "{name} blinks at you. What did it do?"],
  confused: ["{name} really needs something. Look at what it's asking for.", "That's not a fuss. {name} needs help."],
  wriggled: ["{name} wriggles away, giggling. Enough cuddles for now.", "Too much! {name} rolls out of reach."],
  "too-tired": ["{name} yawns. Too tired to play.", "{name} lies down on the toy instead. Nap first."],
};

/* How it is, in the line under the room. Several each, picked by the minute so it holds still. */

export const MOOD_LINES = {
  egg: ["The egg is warm. Sometimes it wobbles.", "Tap tap. Something inside taps back.", "The egg rocks a little. Almost time."],
  asleep: ["Lights out. {name} is curled up asleep.", "Shh. {name} is dreaming about {food}.", "{name} is asleep, snoring very small snores."],
  sick: ["{name} looks pale and wobbly. Time for medicine.", "{name} sneezes. And again. Medicine, please."],
  napping: ["{name} is having a nap. Shh.", "{name} fell asleep on the rug."],
  hungry: ["{name}'s tummy is rumbling.", "{name} keeps staring at the bowl.", "{name} is chewing on nothing. Hungry?"],
  bored: ["{name} is poking the floor. Bored?", "{name} sighs a very big sigh.", "{name} rolls the same way, then back. Bored."],
  messy: ["Something smells. {name} is pretending not to notice.", "Somebody made a mess. It wasn't {name}. It was {name}."],
  fussing: ["{name} is fussing, but the bowl's full and the toys are right there.", "{name} is whining about nothing much."],
  sleepy: ["{name} yawns a giant yawn.", "{name}'s eyes keep closing."],
} as const;

export const HAPPY_LINES: Record<Quirk, readonly string[]> = {
  sleepy: ["{name} is happy and a bit yawny.", "{name} is cozy. It might nap. Or not."],
  bouncy: ["{name} can't stop bouncing.", "Boing. Boing. {name} is in a good mood.", "{Sound}! {name} hops in a circle."],
  shy: ["{name} peeks out at you and waves.", "{name} hums quietly to itself."],
  "show-off": ["{name} is striking a pose. Very impressive.", "{name} does a spin, then checks you saw it."],
};

/* Eggs, goodbyes and the memory book. Pets come from Egg Island and go back there. */

export const HATCH_INTRO = "Three eggs came over from Egg Island. Which one is yours?";
export const HATCH_PENDING = "Keeping it warm…";

export const GOODBYE_INTRO = "{name} has gone back to Egg Island.";
export const GOODBYE_AFTER = "{name}'s page is in your memory book. A new egg is waiting.";

/* Mini-games: how a round went, by how well it went. */

export const GAME_RESULT_LINES = {
  low: ["{name} had fun anyway. {Sound}!", "Not your best round. {name} loved it anyway.", "{name} wants a rematch."],
  mid: ["Nice one. {name} wants to go again.", "{name} does a little victory hop.", "Good round! {name} is grinning."],
  high: ["Amazing! {name} can't stop bouncing.", "{Sound} {sound} {sound}! {name} thinks you're a legend.", "Best round ever. {name} is doing laps of the room."],
} as const;

export const GAME_REPLAY_LINES = ["Just for fun this time. {name} still loved it.", "{name} played this one a minute ago, but who's counting?"];
export const GAME_TIRED_LINES = ["{name} flops over. Worn out. Nap time.", "{name} yawns mid-game. That's enough for now."];

export const HIDE_SEEK_MISS = ["Not behind there.", "Nope. Just dust bunnies.", "Empty! Where could {name} be?"];
export const HIDE_SEEK_FOUND = ["Found you!", "There's {name}!", "Got you! {name} giggles."];
