import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 47.4: the chore presents are a secret for the kids to find (the owner's call). So the
 * places a kid sees chores, rewards and the mascot never mention the pet: no word, no link,
 * no import. The pet's own code may read chores; nothing here may point back.
 */
const ROOT = path.resolve(__dirname, "../..");
const KEPT_QUIET = [
  "app/(app)/chores",
  "app/(app)/points",
  "app/(app)/big-home.tsx",
  "components/tasks",
  "components/bunson.tsx",
  "components/bunson-moment.tsx",
  "lib/tasks",
  "lib/store",
  "lib/bunson-moments.ts",
  "lib/bunson-lines.ts",
  "lib/bunson-facts.ts",
];

function sources(entry: string): string[] {
  const full = path.join(ROOT, entry);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => sources(path.join(entry, name)));
}

describe("the chore-present secret", () => {
  it("isn't mentioned where kids see chores, rewards or the mascot", () => {
    const leaks = KEPT_QUIET.flatMap(sources)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))
      .filter((file) => /\bpets?\b|lib\/pet\b|["'`]\/pet\b|PetGift|petGift/i.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(leaks).toEqual([]);
  });
});
