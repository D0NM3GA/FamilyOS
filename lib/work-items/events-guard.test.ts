import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Phase 59.1c: WorkItemEvent.itemId has no foreign key (it points into one of three tables), so
 * nothing in the database removes an item's history with it. Every delete of a chore instance, a
 * piece of schoolwork or a school form, and of the rows that cascade to them (a chore's
 * definition, a student's school profile), must clean up its events in code nearby, or be listed
 * here with the reason it doesn't need to. Read from the source, like lib/forms-guard.test.ts.
 */
const ROOT = path.resolve(__dirname, "../..");

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" || e.name === "node_modules" ? [] : filesUnder(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const DELETES =
  /\b(taskInstance|schoolAssignment|schoolTask|schoolProfile|taskDefinition)\.(delete|deleteMany)\(|DELETE FROM "?(task_instance|school_task|school_assignment|school_profile|task_definition)\b/g;
const CLEANS = /deleteEventsFor\(|workItemEvent\.deleteMany\(|DELETE FROM "?work_item_event\b/;

/** A delete may skip the cleanup for these reasons ("file" or "file:what it deletes"). */
const NO_EVENTS: Record<string, string> = {
  "app/(app)/meds/actions.ts:taskInstance": "medicine doses are never given history (only chores, schoolwork and forms are)",
};

function deletesWithoutCleanup(): string[] {
  const files = ["app", "lib", "prisma"].flatMap((d) => filesUnder(path.join(ROOT, d)));
  return files.flatMap((file) => {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    return [...text.matchAll(DELETES)].flatMap((m) => {
      const what = m[1] ?? m[3];
      if (NO_EVENTS[`${rel}:${what}`] || NO_EVENTS[rel]) return [];
      // The cleanup sits in the same few lines: before (a wipe that clears the household's
      // history first) or after (the same transaction, right below).
      const line = text.slice(0, m.index).split("\n").length;
      const near = text.split("\n").slice(Math.max(0, line - 16), line + 12).join("\n");
      return CLEANS.test(near) ? [] : [`${rel}:${line} ${what}`];
    });
  });
}

describe("work item history", () => {
  test("finds the deletes (the scan itself works)", () => {
    const text = fs.readFileSync(path.join(ROOT, "app/(app)/school/actions.ts"), "utf8");
    expect([...text.matchAll(DELETES)].length).toBeGreaterThanOrEqual(2);
  });

  test("every delete of a chore, schoolwork or form cleans up its history", () => {
    expect(deletesWithoutCleanup()).toEqual([]);
  });

  test("the reasons list only names files that exist", () => {
    for (const key of Object.keys(NO_EVENTS)) expect(fs.existsSync(path.join(ROOT, key.split(":")[0]))).toBe(true);
  });
});
