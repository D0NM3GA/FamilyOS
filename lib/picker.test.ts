import { describe, expect, it } from "vitest";
import { PICKER_ROW_CAP, filterOptions, groupOptions, moveActive, normalize, pickerRows, type PickerOption } from "./picker";

const zones: PickerOption[] = ["America/Chicago", "America/New_York", "America/Sao_Paulo", "Europe/London", "Asia/Tokyo"].map((z) => ({
  value: z,
  label: z.replace(/_/g, " "),
}));

describe("the picker's matching", () => {
  it("ignores case, accents and the separators in zone names", () => {
    expect(normalize("América/São_Paulo")).toBe("america sao paulo");
    expect(filterOptions(zones, "SAO pa").shown.map((o) => o.value)).toEqual(["America/Sao_Paulo"]);
  });

  it("finds a zone by its city, and needs every typed word", () => {
    expect(filterOptions(zones, "chic").shown.map((o) => o.value)).toEqual(["America/Chicago"]);
    expect(filterOptions(zones, "new york").shown.map((o) => o.value)).toEqual(["America/New_York"]);
    expect(filterOptions(zones, "york paris").shown).toEqual([]);
  });

  it("puts a label that starts with the query first, then a word that starts with it", () => {
    const opts: PickerOption[] = [{ value: "a", label: "Oat milk" }, { value: "b", label: "Milk" }, { value: "c", label: "Buttermilk" }];
    expect(filterOptions(opts, "milk").shown.map((o) => o.value)).toEqual(["b", "a", "c"]);
  });

  it("matches the detail and keywords too", () => {
    const opts: PickerOption[] = [{ value: "x", label: "Groceries", emoji: "🛒", keywords: "food supermarket" }];
    expect(filterOptions(opts, "supermarket").shown).toHaveLength(1);
  });

  it("shows everything for an empty query, up to the cap, and counts the rest", () => {
    const many = Array.from({ length: PICKER_ROW_CAP + 7 }, (_, i) => ({ value: String(i), label: `Item ${i}` }));
    const { shown, more } = filterOptions(many, "  ");
    expect(shown).toHaveLength(PICKER_ROW_CAP);
    expect(more).toBe(7);
  });
});

describe("groups and keys", () => {
  it("keeps groups in the order they first appear", () => {
    const g = groupOptions([
      { value: "s", label: "Skip" },
      { value: "1", label: "Milk", group: "On this trip" },
      { value: "2", label: "Eggs", group: "Everything else" },
      { value: "3", label: "Bread", group: "On this trip" },
    ]);
    expect(g.map((x) => [x.group, x.options.map((o) => o.value)])).toEqual([
      [null, ["s"]],
      ["On this trip", ["1", "3"]],
      ["Everything else", ["2"]],
    ]);
  });

  it("steps with the arrows without wrapping, and jumps with Home and End", () => {
    expect(moveActive(-1, "ArrowDown", 3)).toBe(0);
    expect(moveActive(2, "ArrowDown", 3)).toBe(2);
    expect(moveActive(0, "ArrowUp", 3)).toBe(0);
    expect(moveActive(1, "Home", 3)).toBe(0);
    expect(moveActive(0, "End", 3)).toBe(2);
    expect(moveActive(0, "ArrowDown", 0)).toBe(-1);
  });
});

describe("opening the list", () => {
  it("always shows the current choice before anything's typed, even past the row cap", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ value: String(i), label: `Zone ${i}` }));
    const chosen = many[80];
    const { shown, more } = pickerRows(many, null, chosen, 10);
    expect(shown[0]).toBe(chosen);
    expect(shown).toHaveLength(10);
    expect(more).toBe(90);
    // Already within the cap: left where it is.
    expect(pickerRows(many, null, many[3], 10).shown.indexOf(many[3])).toBe(3);
    // Once something's typed, it's only there if it matches.
    expect(pickerRows(many, "zone 5", chosen, 10).shown).not.toContain(chosen);
  });
});
