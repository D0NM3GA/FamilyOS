import { describe, expect, it } from "vitest";
import { describeEvent, parseItemRef } from "./history";

const e = (itemType: string, action: string, field: string | null, fromValue: string | null, toValue: string | null) => ({ itemType, action, field, fromValue, toValue });

describe("parseItemRef", () => {
  it("reads a type and an id, and nothing else", () => {
    expect(parseItemRef("CHORE:abc123")).toEqual({ type: "CHORE", id: "abc123" });
    expect(parseItemRef("ASSIGNMENT:x_y-z")).toEqual({ type: "ASSIGNMENT", id: "x_y-z" });
    expect(parseItemRef("PERSON:abc")).toBeNull();
    expect(parseItemRef("CHORE:a b")).toBeNull();
    expect(parseItemRef("CHORE:")).toBeNull();
    expect(parseItemRef(undefined)).toBeNull();
  });
});

describe("describeEvent", () => {
  it("says what happened, in the family's words", () => {
    expect(describeEvent(e("CHORE", "STATUS", null, "PENDING", "DONE"))).toBe("marked it done");
    expect(describeEvent(e("ASSIGNMENT", "STATUS", null, "TODO", "DONE"))).toBe("marked it turned in");
    expect(describeEvent(e("CHORE", "ASSIGN", null, null, "Max"))).toBe("gave it to Max (was anyone's)");
    expect(describeEvent(e("CHORE", "ASSIGN", null, "Ivy", "Max"))).toBe("gave it to Max (was Ivy)");
    expect(describeEvent(e("CHORE", "MOVE", null, "2026-11-07", "2026-11-08"))).toBe("moved it from Nov 7 to Nov 8");
    expect(describeEvent(e("ASSIGNMENT", "EDIT", "dueDate", "2026-11-09", null))).toBe("changed the due date from Nov 9 to none");
    expect(describeEvent(e("ASSIGNMENT", "EDIT", "kind", "HOMEWORK", "TEST"))).toBe("changed the type from homework to test");
    expect(describeEvent(e("ASSIGNMENT", "EDIT", "title", "Ch 3", "Chapter 3"))).toBe('changed the name from "Ch 3" to "Chapter 3"');
    expect(describeEvent(e("ASSIGNMENT", "EDIT", "notes", null, null))).toBe("changed the notes");
    expect(describeEvent(e("ASSIGNMENT", "GRADE", null, null, "18/20"))).toBe("graded it 18/20");
    expect(describeEvent(e("ASSIGNMENT", "PUT_BACK", "title", "Chapter 3", "Ch 3"))).toBe('put back the name to "Ch 3"');
    expect(describeEvent(e("ASSIGNMENT", "APPROVE", null, null, null))).toBe("approved the change");
  });
});
