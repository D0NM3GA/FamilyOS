import { describe, expect, test } from "vitest";
import { buildHub, type HubFacts } from "./settings-hub";

const NOW = new Date("2026-10-22T12:00:00Z");
const base: HubFacts = {
  adult: true,
  admin: true,
  ownSignIn: true,
  passkeySignIn: true,
  microsoftOwner: false,
  phones: 0,
  passkeys: 1,
  hasPin: false,
  homeCalendarPicked: false,
  familyCalendarName: null,
  people: 2,
  bigButtons: 0,
  homeSet: false,
  invitesWaiting: 0,
  look: { appName: "ParkerOS", rewardMany: "stickers", mascot: "Bunson" },
  appsHidden: 0,
  alertsTeams: false,
  alertsEmail: false,
  outlookOn: false,
  outlookSync: null,
  lastBackup: null,
  now: NOW,
};

const tiles = (f: Partial<HubFacts> = {}) => buildHub({ ...base, ...f }).flatMap((g) => g.tiles);
const tile = (id: string, f: Partial<HubFacts> = {}) => tiles(f).find((t) => t.id === id);

describe("the Settings hub", () => {
  test("kids get no tiles at all", () => {
    expect(buildHub({ ...base, adult: false, admin: false })).toEqual([]);
  });

  test("an admin sees every group, each saying who it changes things for", () => {
    const groups = buildHub(base);
    expect(groups.map((g) => g.id)).toEqual(["you", "family", "look", "connect"]);
    for (const g of groups) expect(g.scope).toMatch(/changes/i);
    expect(groups[0].scope).toBe("Only changes things for you");
  });

  test("a grown-up who isn't an admin never sees the family's admin tiles", () => {
    const ids = tiles({ admin: false }).map((t) => t.id);
    expect(ids).not.toContain("household");
    expect(ids).not.toContain("sign-in");
    expect(ids).not.toContain("make-it-yours");
    expect(ids).not.toContain("apps");
    expect(ids).not.toContain("alerts");
    expect(ids).toEqual(expect.arrayContaining(["notifications", "starting-views", "data"]));
    expect(buildHub({ ...base, admin: false }).find((g) => g.id === "family")?.scope).toBe("Changes things for everyone");
  });

  test("personal tiles follow how you signed in", () => {
    expect(tile("passkeys", { passkeySignIn: false })).toBeUndefined();
    expect(tile("lock", { ownSignIn: false })).toBeUndefined();
    expect(tile("calendar-on-home")).toBeUndefined();
    expect(tile("calendar-on-home", { microsoftOwner: true })?.status).toEqual({ text: "Your main calendar", tone: "neutral" });
    expect(tile("calendar-on-home", { microsoftOwner: true, familyCalendarName: "Family" })?.status?.text).toBe("The family's usual one");
    expect(tile("calendar-on-home", { microsoftOwner: true, homeCalendarPicked: true })?.status?.tone).toBe("ok");
  });

  test("statuses say the consequence in words, and flag what needs a look", () => {
    expect(tile("passkeys")?.status).toEqual({ text: "Only one: add a spare", tone: "attention" });
    expect(tile("passkeys", { passkeys: 2 })?.status).toEqual({ text: "2 passkeys", tone: "ok" });
    expect(tile("lock")?.status).toEqual({ text: "Anyone can open it", tone: "attention" });
    expect(tile("household")?.status).toEqual({ text: "2 people · no home location", tone: "attention" });
    expect(tile("household", { homeSet: true, people: 1 })?.status).toEqual({ text: "1 person", tone: "neutral" });
    expect(tile("sign-in", { invitesWaiting: 1 })?.status).toEqual({ text: "1 invite waiting", tone: "attention" });
    expect(tile("alerts")?.status).toEqual({ text: "Only the bell: no Teams or email", tone: "attention" });
    expect(tile("alerts", { alertsTeams: true, alertsEmail: true })?.status).toEqual({ text: "On: Teams and email", tone: "ok" });
    expect(tile("notifications", { phones: 2 })?.status).toEqual({ text: "On for 2 phones", tone: "ok" });
    expect(tile("apps", { appsHidden: 2 })?.status?.text).toBe("2 hidden");
  });

  test("backups: none, recent, and stale", () => {
    expect(tile("data")?.status).toEqual({ text: "No backup yet", tone: "attention" });
    const recent = new Date(NOW.getTime() - 3 * 86_400_000);
    expect(tile("data", { lastBackup: { at: recent, label: "3 days ago" } })?.status).toEqual({ text: "Last backup: 3 days ago", tone: "ok" });
    const old = new Date(NOW.getTime() - 45 * 86_400_000);
    expect(tile("data", { lastBackup: { at: old, label: "Sep 7, 2026" } })?.status?.tone).toBe("attention");
  });

  test("the Outlook tile only where Microsoft and Calendar are both on", () => {
    expect(tile("outlook")).toBeUndefined();
    expect(tile("outlook", { outlookOn: true })?.status).toEqual({ text: "Not set up", tone: "neutral" });
    expect(tile("outlook", { outlookOn: true, outlookSync: { error: true } })?.status?.tone).toBe("attention");
  });

  test("every description says something beyond its title", () => {
    for (const t of tiles({ microsoftOwner: true, outlookOn: true })) {
      expect(t.description.toLowerCase()).not.toBe(t.title.toLowerCase());
      expect(t.description.length).toBeGreaterThan(t.title.length + 20);
    }
  });
});
