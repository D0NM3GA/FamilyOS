import { describe, expect, it } from "vitest";
import { BULK_MAX, bulkMessage, summarize } from "./bulk";
import { bulkSchema } from "./bulk-schema";

const schema = bulkSchema(["DONE", "SKIP"] as const);

describe("bulk input", () => {
  it("takes 1 to 30 ids, without repeats, and a known action", () => {
    expect(schema.parse({ ids: ["a", "b", "a"], action: "DONE" })).toEqual({ ids: ["a", "b"], action: "DONE" });
    expect(schema.safeParse({ ids: [], action: "DONE" }).success).toBe(false);
    expect(schema.safeParse({ ids: Array.from({ length: BULK_MAX + 1 }, (_, i) => `id${i}`), action: "DONE" }).success).toBe(false);
    expect(schema.safeParse({ ids: ["a"], action: "DELETE" }).success).toBe(false);
    expect(schema.safeParse({ ids: ["x".repeat(65)], action: "DONE" }).success).toBe(false);
  });
});

describe("bulk results", () => {
  it("counts what was done and why the rest was skipped, keeping the highest milestone", () => {
    const r = summarize([{ ok: true }, { ok: true, milestone: 10 }, { ok: true, milestone: 25 }, { ok: false, reason: "already done" }, { ok: false, reason: "changed" }, { ok: false, reason: "already done" }]);
    expect(r).toEqual({ done: 3, skipped: 3, reasons: { "already done": 2, changed: 1 }, milestone: 25 });
    expect(bulkMessage(r)).toBe("Done 3, skipped 3 (2 already that way, 1 changed meanwhile).");
    expect(bulkMessage(summarize([{ ok: true }]), "Skipped")).toBe("Skipped 1.");
  });
});
