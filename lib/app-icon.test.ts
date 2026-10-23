import { describe, expect, it } from "vitest";
import { appIconResponse, iconTag } from "./app-icon";
import { DEFAULT_LOOK, type FamilyLook } from "./family-look";

const bunny: FamilyLook = { ...DEFAULT_LOOK, appIcon: "BUNNY" };
const letter: FamilyLook = { ...DEFAULT_LOOK, appIcon: "LETTER", appName: "ParkerOS" };

describe("Phase 39: the icon's ETag", () => {
  it("changes with what the icon is drawn from", async () => {
    expect(await iconTag(bunny, 32)).not.toBe(await iconTag(bunny, 192));
    expect(await iconTag(bunny, 32)).not.toBe(await iconTag(letter, 32));
    expect(await iconTag(letter, 32)).not.toBe(await iconTag({ ...letter, appName: "SmithOS" }, 32));
    expect(await iconTag(letter, 32)).not.toBe(await iconTag({ ...letter, themeColor: "forest" }, 32));
  });

  it("ignores what the bunny doesn't use", async () => {
    expect(await iconTag(bunny, 32)).toBe(await iconTag({ ...bunny, themeColor: "forest", appName: "SmithOS" }, 32));
    expect(await iconTag(letter, 32)).toBe(await iconTag({ ...letter, appName: "Parker family" }, 32)); // same letter P
  });

  it("is a quoted, strong tag", async () => {
    expect(await iconTag(bunny, 32)).toMatch(/^"v\d+-bunny-[0-9a-f]{12}-32"$/);
  });
});

describe("Phase 39: the icon route's answer", () => {
  it("is a 304 when the browser already has it", async () => {
    const tag = await iconTag(letter, 32);
    for (const ifNoneMatch of [tag, `W/${tag}`, `"other", ${tag}`, "*"]) {
      const res = await appIconResponse(letter, 32, ifNoneMatch);
      expect(res.status).toBe(304);
      expect(res.headers.get("etag")).toBe(tag);
      expect(res.headers.get("cache-control")).toBe("public, no-cache");
    }
  });

  it("is the PNG otherwise, always revalidated", async () => {
    const res = await appIconResponse(letter, 32, `"stale"`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, no-cache");
    expect(res.headers.get("etag")).toBe(await iconTag(letter, 32));
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
  });
});
