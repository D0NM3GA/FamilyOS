import { describe, expect, it } from "vitest";
import { cleanEmoji, cleanListName, emojiSchema, listNameSchema, nameTaken, sameListName } from "./list-names";

// Built from code points so this file holds no invisible characters (AGENTS.md).
const cp = (...points: number[]) => String.fromCodePoint(...points);
const COOK = cp(0x1f469, 0x200d, 0x1f373);
const KEYCAP_ONE = cp(0x31, 0xfe0f, 0x20e3);
const FLAG = cp(0x1f1fa, 0x1f1f8);

describe("Phase 37: list names", () => {
  it("keeps one tidy line", () => {
    expect(cleanListName("  Eating   out\n")).toBe("Eating out");
    expect(cleanListName(`Pe${cp(0x200b)}ts${cp(0x202e)}`)).toBe("Pets");
    expect(cleanListName(`Soft${cp(0xad)}hyphen`)).toBe("Softhyphen");
    expect(cleanListName(`${cp(0xfeff)}Gifts${cp(0x2066)}`)).toBe("Gifts");
  });

  it("keeps the joiner emoji are built with", () => {
    expect(cleanListName(`${COOK} Cooking`)).toBe(`${COOK} Cooking`);
    expect(cleanListName(`${COOK} Cooking`)).toContain(cp(0x200d));
  });

  it("needs 1 to 40 characters", () => {
    expect(listNameSchema.safeParse("   ").success).toBe(false);
    expect(listNameSchema.safeParse(cp(0x200b)).success).toBe(false);
    expect(listNameSchema.safeParse("x".repeat(40)).data).toBe("x".repeat(40));
    expect(listNameSchema.safeParse("x".repeat(41)).error?.issues[0]?.message).toBe("Keep the name to 40 characters.");
    expect(listNameSchema.safeParse(" Bath & body ").data).toBe("Bath & body");
  });

  it("treats names that differ only in case as the same", () => {
    expect(sameListName("Pets", " pets ")).toBe(true);
    expect(sameListName("Pets", "Pet")).toBe(false);
    const rows = [
      { id: "a", name: "Produce" },
      { id: "b", name: "Dairy" },
    ];
    expect(nameTaken("produce", rows)).toBe(true);
    expect(nameTaken("PRODUCE", rows, "a")).toBe(false); // renaming Produce to PRODUCE
    expect(nameTaken("Frozen", rows)).toBe(false);
  });
});

describe("Phase 37: one emoji", () => {
  it.each([
    ["🐾", "🐾"],
    [" 🥬 ", "🥬"],
    ["✈️", "✈️"],
    ["👍🏽", "👍🏽"],
    [COOK, COOK],
    [KEYCAP_ONE, KEYCAP_ONE],
    [FLAG, FLAG],
  ])("accepts %s", (raw, want) => {
    expect(cleanEmoji(raw)).toBe(want);
  });

  it("is optional", () => {
    expect(cleanEmoji("")).toBeNull();
    expect(cleanEmoji("   ")).toBeNull();
    expect(emojiSchema.safeParse("").data).toBeNull();
  });

  it.each([["ab"], ["🐾🐾"], ["🐾x"], ["1"], ["#"], [cp(0x200d)], [`🐾${cp(0x200b)}`], ["<b>"], [cp(0x1f1fa)]])("refuses %s", (raw) => {
    expect(cleanEmoji(raw)).toBeUndefined();
    expect(emojiSchema.safeParse(raw).error?.issues[0]?.message).toBe("Pick one emoji, or leave it empty.");
  });

  // Tag characters (invisible letters) may only spell a subdivision flag like England's.
  const tags = (text: string) => [...text].map((c) => cp(0xe0000 + c.charCodeAt(0))).join("");
  it("takes a subdivision flag", () => {
    const england = `${cp(0x1f3f4)}${tags("gbeng")}${cp(0xe007f)}`;
    expect(cleanEmoji(england)).toBe(england);
  });

  it("refuses tag characters hiding text behind an emoji", () => {
    expect(cleanEmoji(`🙂${tags("hi there")}`)).toBeUndefined();
    expect(cleanEmoji(`${cp(0x1f3f4)}${tags("gbeng")}`)).toBeUndefined();
  });
});
