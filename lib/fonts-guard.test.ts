import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/** Fonts come from version-locked packages so a build can't fail on, or change with, Google's. */
const ROOT = path.resolve(__dirname, "..");
const fontsFile = fs.readFileSync(path.join(ROOT, "app/fonts.ts"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const fontPackages = Object.entries<string>(manifest.devDependencies).filter(([name]) => name.startsWith("@fontsource"));

describe("the app's fonts", () => {
  test("nothing loads a font from Google", () => {
    const sources = ["app/layout.tsx", "app/fonts.ts", "app/globals.css"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"));
    for (const source of sources) expect(source).not.toMatch(/next\/font\/google|fonts\.(googleapis|gstatic)\.com/);
  });

  test("every face is a file in an exactly pinned package", () => {
    const paths = [...fontsFile.matchAll(/path: "([^"]+)"/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(fs.existsSync(path.join(ROOT, "app", p)), p).toBe(true);
      const used = fontPackages.find(([name]) => p.includes(`/node_modules/${name}/`));
      expect(used, p).toBeDefined();
      expect(used![1], p).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  test("every font's license ships with the app", () => {
    const licenses = fs.readFileSync(path.join(ROOT, "public/licenses/fonts.txt"), "utf8");
    for (const [name] of fontPackages) expect(licenses, name).toContain(`(${name})`);
  });
});
