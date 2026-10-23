import { beforeEach, describe, expect, test, vi } from "vitest";

// authorizeExport's only dependency: who the active profile is (null = signed out).
const activeProfile = vi.hoisted(() => ({ current: null as null | { id: string; role: "ADULT" | "KID" | "ADMIN"; householdId: string } }));
const signIn = vi.hoisted(() => ({ own: true, fresh: true }));
vi.mock("@/lib/active-profile", () => ({ getActiveProfile: async () => activeProfile.current, isOwnSignIn: async () => signIn.own }));
vi.mock("@/lib/session", () => ({ signedInRecently: async () => signIn.fresh }));
// Phase 36: which apps the family turned off.
const offApps = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/lib/app-switches", () => ({ appOn: async (_householdId: string, app: string) => !offApps.ids.includes(app) }));

import { authorizeExport, downloadResponse, serveCsvExport, type CsvExport } from "./export";

const request = (site?: string) => new Request("http://localhost:3000/x", { headers: site ? { "sec-fetch-site": site } : {} });
const as = (role: "ADULT" | "KID" | "ADMIN") => ({ id: "p1", role, householdId: "h1" });

beforeEach(() => {
  activeProfile.current = null;
  signIn.own = true;
  signIn.fresh = true;
  offApps.ids = [];
});

describe("authorizeExport", () => {
  test("refuses cross-site requests before anything else", async () => {
    activeProfile.current = as("ADMIN");
    expect((await authorizeExport(request("cross-site"), "adult")).response?.status).toBe(403);
  });

  test("401 when signed out", async () => {
    expect((await authorizeExport(request("same-origin"), "adult")).response?.status).toBe(401);
  });

  test("a signed-out click (a page navigation) is redirected through / instead of downloading an empty 401", async () => {
    const click = new Request("http://localhost:3000/chores/export/chores.csv", {
      headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate" },
    });
    const res = (await authorizeExport(click, "adult")).response;
    expect(res?.status).toBe(303);
    expect(res?.headers.get("location")).toBe("http://localhost:3000/");
  });

  test("kids never; adults get CSVs; only admins get the backup", async () => {
    activeProfile.current = as("KID");
    expect((await authorizeExport(request(), "adult")).response?.status).toBe(403);
    activeProfile.current = as("ADULT");
    expect((await authorizeExport(request(), "adult")).viewer?.id).toBe("p1");
    expect((await authorizeExport(request(), "admin")).response?.status).toBe(403);
    activeProfile.current = as("ADMIN");
    expect((await authorizeExport(request(), "admin")).viewer?.id).toBe("p1");
  });

  describe("Phase 28: sensitive downloads (backups)", () => {
    const post = (extra: Record<string, string> = {}) =>
      new Request("http://localhost:3000/api/backup/download", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-mode": "navigate", ...extra },
      });
    const sensitive = { stepUpPath: "/data" };

    test("only a same-origin POST from our own page", async () => {
      activeProfile.current = as("ADMIN");
      // A GET (not a navigation from a form) and a fetch from another origin are refused outright.
      expect((await authorizeExport(new Request("http://localhost:3000/x", { headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" } }), "admin", sensitive)).response?.status).toBe(403);
      expect((await authorizeExport(post({ origin: "https://evil.example", "sec-fetch-mode": "cors" }), "admin", sensitive)).response?.status).toBe(403);
      // A form post that can't prove it came from our page goes back with a message.
      expect((await authorizeExport(post({ origin: "https://evil.example" }), "admin", sensitive)).response?.headers.get("location")).toBe("http://localhost:3000/data?stepup=blocked");
      expect((await authorizeExport(post(), "admin", sensitive)).viewer?.id).toBe("p1");
    });

    test("a switched profile or a stale sign-in goes back to the page to fix it", async () => {
      activeProfile.current = as("ADMIN");
      signIn.own = false;
      expect((await authorizeExport(post(), "admin", sensitive)).response?.headers.get("location")).toBe("http://localhost:3000/data?stepup=own");
      signIn.own = true;
      signIn.fresh = false;
      expect((await authorizeExport(post(), "admin", sensitive)).response?.headers.get("location")).toBe("http://localhost:3000/data?stepup=fresh");
      expect((await authorizeExport(post({ "sec-fetch-mode": "cors" }), "admin", sensitive)).response?.status).toBe(403);
    });
  });
});

describe("downloadResponse", () => {
  test("sets attachment, no-store and nosniff headers", () => {
    const res = downloadResponse("a,b\r\n", "chores-chores-2026-09-24.csv", "text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="chores-chores-2026-09-24.csv"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("refuses a filename that could inject into the header", () => {
    expect(() => downloadResponse("x", 'a".csv\r\nSet-Cookie: x', "text/csv")).toThrow();
  });
});

describe("serveCsvExport", () => {
  const registry: Record<string, CsvExport> = {
    things: { label: "Things", description: "", build: async (householdId) => `csv for ${householdId}` },
  };
  const params = (file: string) => Promise.resolve({ file });

  test("unknown files, missing .csv, and prototype keys are 404 — even before auth", async () => {
    for (const file of ["nope.csv", "things", "__proto__.csv", "constructor.csv", "toString.csv"]) {
      expect((await serveCsvExport(request(), params(file), "chores", registry)).status).toBe(404);
    }
  });

  test("builds for the viewer's own household", async () => {
    activeProfile.current = as("ADULT");
    const res = await serveCsvExport(request(), params("things.csv"), "chores", registry);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("csv for h1");
  });

  test("kids are refused", async () => {
    activeProfile.current = as("KID");
    expect((await serveCsvExport(request(), params("things.csv"), "chores", registry)).status).toBe(403);
  });

  test("a turned-off app has no downloads (Phase 36), by the app its path belongs to", async () => {
    activeProfile.current = as("ADULT");
    offApps.ids = ["store", "cars"];
    expect((await serveCsvExport(request(), params("things.csv"), "points", registry)).status).toBe(404);
    expect((await serveCsvExport(request(), params("things.csv"), "vehicles", registry)).status).toBe(404);
    expect((await serveCsvExport(request(), params("things.csv"), "chores", registry)).status).toBe(200);
    expect((await serveCsvExport(request(), params("things.csv"), "people", registry)).status).toBe(200);
  });
});
