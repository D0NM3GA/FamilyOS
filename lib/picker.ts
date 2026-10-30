/**
 * Phase 57.3: the logic behind components/picker.tsx, a searchable list for the few long or rich
 * choices (time zone, a receipt line's item, Merge into, money categories). Pure, so it's tested
 * without a browser.
 */
export type PickerOption = {
  value: string;
  label: string;
  /** Shown before the label (a category's emoji). */
  emoji?: string | null;
  /** A second, smaller line (a time zone's offset). Matched too. */
  detail?: string;
  /** A heading the option sits under ("On this trip"). Groups keep the order they first appear in. */
  group?: string;
  /** More words that should find it (a zone's region), not shown. */
  keywords?: string;
};

/** How many rows are drawn at most; past that the list says to keep typing. */
export const PICKER_ROW_CAP = 50;

/** Lower case, accents off, and `_`, `/` and `-` read as spaces: "São_Paulo" finds "sao paulo". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The options that match what was typed, best first, at most `cap`, and how many more matched.
 * Every typed word must appear somewhere in the label, detail or keywords. A label that starts
 * with the query comes first, then one with a word starting with it, then the rest, each in
 * the list's own order. An empty query keeps the list as it is.
 */
export function filterOptions(options: readonly PickerOption[], query: string, cap = PICKER_ROW_CAP): { shown: PickerOption[]; more: number } {
  const q = normalize(query);
  if (!q) return { shown: options.slice(0, cap), more: Math.max(0, options.length - cap) };
  const words = q.split(" ");
  const ranked: { option: PickerOption; rank: number; index: number }[] = [];
  options.forEach((option, index) => {
    const label = normalize(option.label);
    const hay = `${label} ${normalize(option.detail ?? "")} ${normalize(option.keywords ?? "")}`;
    if (!words.every((w) => hay.includes(w))) return;
    const rank = label.startsWith(q) ? 0 : ` ${label}`.includes(` ${words[0]}`) ? 1 : 2;
    ranked.push({ option, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return { shown: ranked.slice(0, cap).map((r) => r.option), more: Math.max(0, ranked.length - cap) };
}

/** The shown options under their headings, groups in the order they first appear. */
export function groupOptions(shown: readonly PickerOption[]): { group: string | null; options: PickerOption[] }[] {
  const out: { group: string | null; options: PickerOption[] }[] = [];
  for (const option of shown) {
    const group = option.group ?? null;
    const last = out.find((g) => g.group === group);
    if (last) last.options.push(option);
    else out.push({ group, options: [option] });
  }
  return out;
}

/** The highlighted row after a key: arrows step without wrapping, Home and End jump; -1 is none. */
export function moveActive(active: number, key: string, count: number): number {
  if (count === 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return Math.min(active + 1, count - 1);
  if (key === "ArrowUp") return Math.max(active - 1, 0);
  return active;
}
