import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Phase 58: looks work by changing variables on [data-app-root], so these can't creep back. Read
 * from the source files, like lib/forms-guard.test.ts.
 */
const ROOT = path.resolve(__dirname, "..");

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : filesUnder(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const SOURCE = [...filesUnder(path.join(ROOT, "app")), ...filesUnder(path.join(ROOT, "components")), path.join(ROOT, "app/globals.css")].map((file) => ({
  file: path.relative(ROOT, file).split(path.sep).join("/"),
  lines: fs.readFileSync(file, "utf8").split("\n"),
}));

describe("what a look can change stays changeable", () => {
  test("the theme block holds no fixed palette colors", () => {
    const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const theme = css.slice(css.indexOf("@theme inline"), css.indexOf(":root {")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(theme).toContain("--color-ink");
    expect(theme).not.toMatch(/--color-[\w-]+:(?!\s*var\()/);
    expect(theme).not.toMatch(/--font-[\w-]+:(?!\s*var\(--face-)/);
  });

  test("code reads the inner variable, because --color-* resolves once on :root", () => {
    const hits = SOURCE.flatMap(({ file, lines }) =>
      lines.flatMap((line, i) => (/var\(--color-/.test(line) && !line.includes("never var(--color-") ? [`${file}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  test("text on a main button or the bar is its own token, not white", () => {
    const hits = SOURCE.filter(({ file }) => !file.startsWith("app/print") && !file.includes("/pet/")).flatMap(({ file, lines }) =>
      lines.flatMap((line, i) => (/\bbg-(brand|chrome)\b/.test(line) && /\btext-white\b/.test(line) ? [`${file}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  test("nothing on the bar is white, even a child or a class split across lines", () => {
    const hits = SOURCE.filter(({ file }) => ["top-bar", "nav-rail", "bell", "app-launcher"].some((name) => file === `app/(app)/${name}.tsx`)).flatMap(({ file, lines }) =>
      lines.flatMap((line, i) => (/\b(text|placeholder)-white\b/.test(line) ? [`${file}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  test("hand-written cards and main buttons carry the name a look's CSS grabs", () => {
    const hits = SOURCE.filter(({ file }) => !file.startsWith("app/print") && !file.includes("/pet/") && !/dev-preview|app\/(sign-in|setup|invite|not-provisioned|profiles)/.test(file)).flatMap(({ file, lines }) =>
      lines.flatMap((line, i) =>
        [...line.matchAll(/(["`])((?:(?!\1).)*?)\1/g)].flatMap(([, , text]) => {
          const words = text.split(/\s+/);
          const isButton = words.includes("bg-brand") && words.includes("text-on-brand");
          const isCard = words.includes("bg-card") && ((words.includes("border-2") && words.some((w) => w === "border-ink" || w === "border-border")) || words.includes("ring-border")) && words.some((w) => /^rounded-(xl|2xl|3xl)$/.test(w));
          return (isButton && !words.includes("ui-btn")) || (isCard && !words.includes("ui-card")) ? [`${file}:${i + 1}`] : [];
        }),
      ),
    );
    expect(hits).toEqual([]);
  });
});
