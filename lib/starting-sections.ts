/**
 * The store sections a household starts with (Phase 22), each with the key its row keeps as
 * ProductGroup.starterKey (Phase 37) so a guess finds it after a rename. A kernel file, not
 * part of lib/groceries, because the household backup (a kernel that may not import a domain)
 * needs it too: to fill in the keys of a file made before Phase 37. Pure.
 */

export const STARTING_SECTIONS = [
  { key: "produce", name: "Produce", emoji: "🥬" },
  { key: "dairy", name: "Dairy", emoji: "🥛" },
  { key: "meat", name: "Meat", emoji: "🥩" },
  { key: "bakery", name: "Bakery", emoji: "🍞" },
  { key: "pantry", name: "Pantry", emoji: "🥫" },
  { key: "frozen", name: "Frozen", emoji: "🧊" },
  { key: "snacks", name: "Snacks", emoji: "🍿" },
  { key: "drinks", name: "Drinks", emoji: "🧃" },
  { key: "household", name: "Household", emoji: "🧽" },
  { key: "bath", name: "Bath & body", emoji: "🧴" },
  { key: "pet", name: "Pet", emoji: "🐾" },
  { key: "baby", name: "Baby", emoji: "🍼" },
] as const;

export type StarterKey = (typeof STARTING_SECTIONS)[number]["key"];

type Section = { id: string; name: string; sortOrder: number; createdAt: string; starterKey?: string | null };

/**
 * Sections with every missing starterKey filled in (null, or the key of the starting section it's
 * still named as), the same rule as the editable_lists migration's backfill: names compared
 * ignoring case, and each key goes to one section only, the first in walking order, never one a
 * section already holds. A section that has the field (even null) keeps it.
 */
export function withStarterKeys<T extends Section>(sections: T[]): (T & { starterKey: string | null })[] {
  const taken = new Set(sections.map((s) => s.starterKey).filter((k): k is string => k != null));
  const claimed = new Map<string, string>(); // section id → key
  const walk = sections
    .filter((s) => s.starterKey === undefined)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const s of walk) {
    const starter = STARTING_SECTIONS.find((st) => st.name.toLowerCase() === s.name.toLowerCase());
    if (!starter || taken.has(starter.key)) continue;
    taken.add(starter.key);
    claimed.set(s.id, starter.key);
  }
  return sections.map((s) => ({ ...s, starterKey: s.starterKey ?? claimed.get(s.id) ?? null }));
}
