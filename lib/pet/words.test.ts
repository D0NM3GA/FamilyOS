import { describe, expect, it } from "vitest";
import { FORMS_PER_STAGE, SPECIES, STAGES } from "./state";
import { formName, SPECIES_NAMES } from "./words";

describe("form names", () => {
  it("gives every form of every species its own name, so the collection book never repeats one", () => {
    for (const species of SPECIES) {
      const names = STAGES.filter((stage) => stage !== "egg").flatMap((stage) =>
        Array.from({ length: FORMS_PER_STAGE[stage] }, (_, form) => formName(species, stage, form)),
      );
      expect(names).toHaveLength(10);
      expect(new Set(names).size, species).toBe(names.length);
      // None fell back to the species name, which is what a missing name would show.
      expect(names, species).not.toContain(SPECIES_NAMES[species]);
    }
  });
});
