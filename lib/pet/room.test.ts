import { describe, expect, it } from "vitest";
import { ITEMS } from "./items";
import { DECOR_BOX, dropAt, inDrawingOrder, standOn, SURFACE_SPANS } from "./room";

describe("decorations on the room's surfaces", () => {
  it("keeps the whole of a decoration on its surface, however far it's pushed", () => {
    const left = standOn("poster", "wall", -100, null);
    const right = standOn("poster", "wall", 1000, null);
    expect(left.x - DECOR_BOX.poster[0]).toBeGreaterThanOrEqual(SURFACE_SPANS.wall.from);
    expect(right.x + DECOR_BOX.poster[0]).toBeLessThanOrEqual(SURFACE_SPANS.wall.to);
    expect(left.y).toBe(SURFACE_SPANS.wall.y);
  });

  it("stands a decoration with no spot of its own at the surface's usual one", () => {
    expect(standOn("plant", "sill", null, null)).toEqual({ itemId: "plant", surface: "sill", x: 200, y: 104 });
  });

  it("lets a floor decoration sit nearer or further, but only on the floor", () => {
    expect(standOn("cushion", "floor", 100, 0).y).toBe(SURFACE_SPANS.floor.y);
    expect(standOn("cushion", "floor", 100, 999).y).toBe(SURFACE_SPANS.floor.front);
    expect(standOn("cushion", "floor", 100, 220).y).toBe(220);
    expect(standOn("lamp", "shelf", 330, 999).y).toBe(SURFACE_SPANS.shelf.y);
  });

  it("lands a drop on the nearest surface the decoration fits", () => {
    expect(dropAt("poster", { x: 60, y: 60 })).toMatchObject({ surface: "wall", x: 60 });
    // A poster dropped on the floor still goes up on the wall: it only fits there.
    expect(dropAt("poster", { x: 60, y: 240 })?.surface).toBe("wall");
    expect(dropAt("plant", { x: 200, y: 90 })?.surface).toBe("sill");
    expect(dropAt("plant", { x: 340, y: 80 })?.surface).toBe("shelf");
    expect(dropAt("plant", { x: 120, y: 230 })).toMatchObject({ surface: "floor", x: 120, y: 230 });
    expect(dropAt("ball", { x: 120, y: 230 })).toBeNull();
  });

  it("knows the outline of every decoration", () => {
    for (const item of ITEMS.filter((i) => i.kind === "decor")) expect(DECOR_BOX[item.id], item.id).toBeDefined();
  });

  it("draws the back of the room first", () => {
    const near = standOn("cushion", "floor", 100, 236);
    const far = standOn("beanbag", "floor", 100, 205);
    const wall = standOn("poster", "wall", null, null);
    expect(inDrawingOrder([near, far, wall]).map((item) => item.itemId)).toEqual(["poster", "beanbag", "cushion"]);
  });
});
