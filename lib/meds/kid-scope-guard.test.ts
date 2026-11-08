import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Phase 66a: someone's medicines are theirs and the grown-ups'. The pages are server components,
 * so this reads them, like the other guards: the Meds page takes `?person=` from grown-ups only
 * (a kid's is always their own), and a person's page loads its Meds summary only for a grown-up
 * or the person themselves. Home's Today card, the calendar and search keep to the same rule.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("kids see only their own medicines", () => {
  test("the Meds page forces a kid's own id", () => {
    const page = read("app/(app)/meds/page.tsx");
    expect(page).toContain("const personFilter = viewerIsAdult ? (await searchParams).person : profile.id;");
    expect(page).not.toMatch(/const \{ person: personFilter \} = await searchParams/);
  });

  test("a person's page shows Meds to a grown-up or the person", () => {
    const page = read("app/(app)/people/[id]/page.tsx");
    expect(page).toContain(`const medsHere = person.isHouseholdMember && on("meds") && (viewerIsAdult || profile.id === person.id);`);
  });

  test("Home, the calendar and search keep a kid to their own doses", () => {
    expect(read("app/(app)/page.tsx")).toContain(`domain: "MED", personId: isAdult(profile) ? undefined : profile.id`);
    expect(read("lib/calendar/queries.ts")).toContain("dosesFor: adult ? undefined : viewer.id");
    expect(read("lib/search.ts")).toContain("...(opts.viewerIsAdult ? {} : { assignees: { some: { id: opts.viewerId ?? \"\" } } })");
  });
});
