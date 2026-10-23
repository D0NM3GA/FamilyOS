import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { LOADING_TITLES, STORE_PATH } from "./loading-titles";

/** Phase 39: the loading screen's titles are the ones the pages really show. */
const page = (route: string) => fs.readFileSync(path.resolve(__dirname, "..", "app", "(app)", ...route.split("/").filter(Boolean), "page.tsx"), "utf8");

describe("loading screen titles", () => {
  test.each(Object.entries(LOADING_TITLES))("%s shows %s", (route, title) => {
    expect(page(route)).toContain(`<PageHeader title="${title}"`);
  });

  test("the Store's title is the reward word", () => {
    expect(page(STORE_PATH)).toMatch(/<h1 className="text-4xl font-extrabold">\s*<RewardWord form="store" \/>/);
  });
});
