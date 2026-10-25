import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MASCOT_ART_VERSION, mascotArt } from "./bunson-art";

describe("Bunson's sprite addresses", () => {
  it("carry the art version, so new art isn't hidden behind a browser's saved copy", () => {
    expect(mascotArt("bunson-idle")).toBe(`/mascot/bunson-idle.png?v=${MASCOT_ART_VERSION}`);
  });

  it("only name files that exist", () => {
    const files = new Set(readdirSync(join(process.cwd(), "public/mascot")));
    for (const name of ["bunson-idle", "bunson-periscope", ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [`bunson-hop-${i}`, `bunson-loco-${i}`])]) {
      expect(files.has(mascotArt(name).slice("/mascot/".length).split("?")[0])).toBe(true);
    }
  });
});
