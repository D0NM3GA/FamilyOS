import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Phase 69a: a form's error is announced to screen readers. Every place that shows an action's
 * error (`state.error && …`, a message's `.error`, or `if (state.error) return <…>`) renders it with
 * role="alert", on that line or the element opening right after, so it's read out when it appears.
 */
const ROOT = path.resolve(__dirname, "..");

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" || e.name === "node_modules" ? [] : files(rel);
    return /\.tsx$/.test(e.name) ? [rel] : [];
  });
}

describe("form errors are announced", () => {
  test("each error a form shows has role=alert", () => {
    const missing: string[] = [];
    for (const file of [...files("app"), ...files("components")]) {
      const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/(?<![!\w.])(\w+\??\.)?error &&/.test(line) && !/\.error\) return </.test(line)) return;
        const shown = [line, lines[i + 1] ?? "", lines[i + 2] ?? ""].join("\n");
        if (!/role="alert"/.test(shown)) missing.push(`${file}:${i + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
