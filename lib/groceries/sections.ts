/**
 * Store sections (Phase 22). A household starts with these; the family can change them
 * (Phase 37's Store sections page). `guessSection` suggests one for a brand-new Pantry item
 * from its name. It's a suggestion applied once on create; whatever the family picks
 * afterwards sticks (nothing re-guesses).
 *
 * Guesses name a starting section by its `key`, which the seeded row keeps as
 * ProductGroup.starterKey: the family can rename "Pet" to "Dog stuff" and dog food still lands
 * there. A starting section the family removed simply isn't guessed any more. The list itself
 * lives in lib/starting-sections.ts, a kernel file, because the household backup needs it too.
 */

import { STARTING_SECTIONS, type StarterKey } from "@/lib/starting-sections";

export { STARTING_SECTIONS, type StarterKey };

// Order matters: the first section with a matching word wins, so the specific ones come
// before the broad ones ("dog treats" is Pet, not Snacks; "ice cream" is Frozen, not Dairy;
// "peanut butter" is Pantry, not Dairy).
const KEYWORDS: [StarterKey, string[]][] = [
  ["pet", ["dog", "cat", "kitten", "puppy", "pet", "litter", "kibble", "fish food", "bird seed"]],
  ["baby", ["diaper", "nappy", "wipes", "formula", "baby"]],
  ["frozen", ["frozen", "ice cream", "popsicle", "ice", "pizza rolls", "waffles"]],
  ["bath", ["shampoo", "conditioner", "soap", "body wash", "toothpaste", "toothbrush", "floss", "deodorant", "lotion", "razor", "sunscreen", "tampon", "pads", "mouthwash"]],
  ["household", ["paper towel", "toilet paper", "napkin", "trash bag", "garbage bag", "detergent", "dish", "sponge", "foil", "plastic wrap", "ziploc", "bleach", "cleaner", "battery", "batteries", "light bulb", "paper plate", "cup"]],
  ["pantry", ["peanut butter", "jam", "jelly", "pasta", "rice", "flour", "sugar", "oil", "vinegar", "cereal", "oats", "oatmeal", "soup", "beans", "sauce", "spice", "salt", "pepper", "honey", "syrup", "coffee", "tea", "canned", "broth", "ketchup", "mustard", "mayo"]],
  ["dairy", ["milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "egg", "sour cream", "cottage"]],
  ["meat", ["chicken", "beef", "pork", "turkey", "bacon", "sausage", "ham", "steak", "ground", "fish", "salmon", "shrimp", "hot dog", "lunch meat", "deli"]],
  ["bakery", ["bread", "bagel", "bun", "roll", "tortilla", "muffin", "croissant", "cake", "donut", "pita"]],
  ["drinks", ["juice", "soda", "water", "lemonade", "sparkling", "pop", "gatorade", "beer", "wine", "kombucha"]],
  ["snacks", ["chip", "cracker", "goldfish", "cookie", "pretzel", "popcorn", "granola bar", "candy", "chocolate", "fruit snack", "nuts", "trail mix"]],
  ["produce", ["apple", "banana", "orange", "grape", "berry", "berries", "lettuce", "spinach", "kale", "tomato", "potato", "onion", "garlic", "carrot", "celery", "cucumber", "pepper", "avocado", "lemon", "lime", "broccoli", "corn", "melon", "peach", "pear", "salad", "mushroom", "zucchini", "herbs", "cilantro"]],
];

function hasWord(text: string, word: string): boolean {
  // Whole words, allowing a plural "s"/"es": "apples" matches "apple"; "grapefruit" doesn't match "grape".
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}(e?s)?($|[^a-z])`).test(text);
}

/** A starting section's key for a new item, or null when nothing obvious matches. */
export function guessSection(name: string): StarterKey | null {
  const text = name.toLowerCase();
  for (const [section, words] of KEYWORDS) {
    if (words.some((w) => hasWord(text, w))) return section;
  }
  return null;
}

/** Up to this many sections; far more than any store has aisles. */
export const MAX_SECTIONS = 40;

/**
 * The walking order after moving one section a step up or down, or null when it can't move
 * (already first or last, or not in the list). The page writes the whole order back, so
 * sections that shared a sortOrder (an old backup's default 0) come out tidy.
 */
export function moveSection(order: string[], id: string, direction: "up" | "down"): string[] | null {
  const from = order.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= order.length) return null;
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** "18 items", "1 item", "No items". */
export function itemCount(n: number): string {
  return n === 0 ? "No items" : `${n} item${n === 1 ? "" : "s"}`;
}
