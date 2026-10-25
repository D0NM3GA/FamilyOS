import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MASCOT_ART_VERSION, mascotArt } from "./bunson-art";
import { HOP_FRAME_COUNT } from "./bunson-hop";
import { IDLE_LIFE_FRAME_COUNT } from "./bunson-idle";
import { LOCO_FRAME_COUNT } from "./bunson-loco";

describe("Bunson's sprite addresses", () => {
  it("carry the art version, so new art isn't hidden behind a browser's saved copy", () => {
    expect(mascotArt("bunson-idle")).toBe(`/mascot/bunson-idle.png?v=${MASCOT_ART_VERSION}`);
  });

  it("only name files that exist", () => {
    const files = new Set(readdirSync(join(process.cwd(), "public/mascot")));
    const names = [
      "bunson-idle",
      "bunson-periscope",
      "bunson-turn",
      ...Array.from({ length: IDLE_LIFE_FRAME_COUNT }, (_, i) => `bunson-life-${i}`),
      ...Array.from({ length: HOP_FRAME_COUNT }, (_, i) => `bunson-hop-${i}`),
      ...Array.from({ length: LOCO_FRAME_COUNT }, (_, i) => `bunson-loco-${i}`),
    ];
    for (const name of names) {
      expect(files.has(mascotArt(name).slice("/mascot/".length).split("?")[0])).toBe(true);
    }
  });
});
