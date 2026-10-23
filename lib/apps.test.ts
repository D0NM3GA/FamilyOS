import { describe, expect, it } from "vitest";
import {
  APP_GROUPS,
  APPS,
  RAIL_FIRST,
  SWITCHABLE_APPS,
  activeAppId,
  appsOffFor,
  cleanDisabledApps,
  isAdultOnlyApp,
  isAppOn,
  isLinkOn,
  offLinkPrefixes,
  railApps,
  switchApp,
  visibleApps,
} from "./apps";

describe("the fixed app order", () => {
  it("lists the day first, people near the top, admin last", () => {
    expect(APPS.map((a) => a.id)).toEqual(["home", "people", "calendar", "chores", "meds", "groceries", "school", "money", "store", "cars", "garage", "data", "settings"]);
  });

  it("hides grown-up apps from kids, keeping the order", () => {
    expect(visibleApps(false, []).map((a) => a.id)).toEqual(["home", "people", "calendar", "chores", "meds", "groceries", "school", "store"]);
  });

  it("shows everything to adults", () => {
    expect(visibleApps(true, [])).toHaveLength(APPS.length);
  });
});

describe("railApps", () => {
  const adult = visibleApps(true, []);
  const ids = (xs: { id: string }[]) => xs.map((a) => a.id);

  it("shows the first few and folds the rest behind Show more, in order", () => {
    const folded = railApps(adult, "home", false);
    expect(ids(folded.first)).toEqual(ids(adult.slice(0, RAIL_FIRST)));
    expect(folded).toMatchObject({ more: [], folded: true });
    expect(ids(railApps(adult, "home", true).more)).toEqual(ids(adult.slice(RAIL_FIRST)));
  });

  it("keeps the app you are in visible while folded", () => {
    expect(ids(railApps(adult, "cars", false).more)).toEqual(["cars"]);
    expect(ids(railApps(adult, "people", false).more)).toEqual([]);
  });

  it("just shows a short list whole (a kid has eight apps)", () => {
    const kid = railApps(visibleApps(false, []), null, false);
    expect(kid.folded).toBe(false);
    expect(kid.first).toHaveLength(8);
    expect(kid.more).toEqual([]);
  });
});

describe("activeAppId", () => {
  it.each([
    ["/", "home"],
    ["/chores", "chores"],
    ["/chores/new", "chores"],
    ["/points", "store"],
    ["/points/export/x", "store"],
    ["/vehicles", "cars"],
    ["/vehicles/new", "cars"],
    ["/vehicles/abc123", "cars"],
    ["/vehicles/supplies", "garage"],
    ["/vehicles/supplies/new", "garage"],
    ["/settings/household", "settings"],
    ["/school/feeds", "school"],
    ["/finances", "money"],
    ["/finances/abc/settings", "money"],
    ["/search", null],
    ["/peoplex", null],
  ])("%s → %s", (path, id) => {
    expect(activeAppId(path)).toBe(id);
  });
});

describe("apps on and off (Phase 36)", () => {
  it("lets a family switch everything but Home, People, Data and Settings (Garage goes with Cars)", () => {
    const ids = APPS.map((a) => a.id);
    expect(SWITCHABLE_APPS.every((id) => ids.includes(id))).toBe(true);
    expect(ids.filter((id) => !(SWITCHABLE_APPS as readonly string[]).includes(id))).toEqual(["home", "people", "garage", "data", "settings"]);
  });

  it("reads the stored list leniently: unknown, always-on and repeated ids drop out, fixed order", () => {
    expect(cleanDisabledApps(["store", "home", "nope", "chores", "store", "garage"])).toEqual(["chores", "store"]);
    expect(cleanDisabledApps(null)).toEqual([]);
    expect(cleanDisabledApps(undefined)).toEqual([]);
  });

  it("isAppOn: off when listed, always-on apps can't be turned off, Garage follows Cars", () => {
    expect(isAppOn(["chores"], "chores")).toBe(false);
    expect(isAppOn(["chores"], "meds")).toBe(true);
    expect(isAppOn(["home", "settings", "people", "data"], "home")).toBe(true);
    expect(isAppOn(["home", "settings", "people", "data"], "settings")).toBe(true);
    expect(isAppOn(["cars"], "garage")).toBe(false);
    expect(isAppOn([], "garage")).toBe(true);
    // A garage entry on its own means nothing: it has no switch.
    expect(isAppOn(["garage"], "garage")).toBe(true);
    expect(isAppOn([], "something-new")).toBe(true);
  });

  it("switchApp turns one on or off and keeps the list clean", () => {
    expect(switchApp([], "money", false)).toEqual(["money"]);
    expect(switchApp(["money"], "money", false)).toEqual(["money"]);
    expect(switchApp(["store", "money"], "money", true)).toEqual(["store"]);
    expect(switchApp(["home", "cars"], "chores", false)).toEqual(["chores", "cars"]);
  });

  it("visibleApps leaves turned-off apps out for everyone, in order", () => {
    expect(visibleApps(true, ["chores", "cars"]).map((a) => a.id)).toEqual(["home", "people", "calendar", "meds", "groceries", "school", "money", "store", "data", "settings"]);
    expect(visibleApps(false, ["store", "money"]).map((a) => a.id)).toEqual(["home", "people", "calendar", "chores", "meds", "groceries", "school"]);
    expect(visibleApps(true, [...SWITCHABLE_APPS]).map((a) => a.id)).toEqual(["home", "people", "data", "settings"]);
  });

  it("offLinkPrefixes agrees with isLinkOn for links into every app", () => {
    const disabled = ["store", "cars", "money"];
    const { exact, startsWith } = offLinkPrefixes(disabled);
    const offByPrefix = (href: string) => exact.includes(href) || startsWith.some((p) => href.startsWith(p));
    const hrefs = ["/", "/points", "/points#orders", "/vehicles/abc", "/vehicles/supplies", "/finances/j1/bills", "/chores?person=a", "/data", "/people/x", "/search?q=x"];
    for (const href of hrefs) expect(offByPrefix(href)).toBe(!isLinkOn(disabled, href));
    expect(offLinkPrefixes([])).toEqual({ exact: [], startsWith: [] });
  });

  it("isLinkOn: a link is off when the app it lands in is", () => {
    expect(isLinkOn(["meds"], "/meds")).toBe(false);
    expect(isLinkOn(["meds"], "/chores?person=abc")).toBe(true);
    expect(isLinkOn(["cars"], "/vehicles/abc#recalls")).toBe(false);
    expect(isLinkOn(["cars"], "/vehicles/supplies")).toBe(false);
    expect(isLinkOn(["store"], "/points#orders")).toBe(false);
    expect(isLinkOn([...SWITCHABLE_APPS], "/people/abc")).toBe(true);
    expect(isLinkOn([...SWITCHABLE_APPS], "/search?q=x")).toBe(true);
  });
});

describe("the grown-up apps", () => {
  it("are Money, Cars (with Garage), Data and Settings", () => {
    expect(APPS.filter((a) => isAdultOnlyApp(a.id)).map((a) => a.id)).toEqual(["money", "cars", "garage", "data", "settings"]);
    expect(isAdultOnlyApp("chores")).toBe(false);
    expect(isAdultOnlyApp("nope")).toBe(false);
  });

  it("appsOffFor: a kid's mixed pages leave out the grown-up apps' links too", () => {
    const kid = appsOffFor(false, ["meds"]);
    for (const href of ["/vehicles/abc", "/vehicles/supplies", "/finances/j1", "/meds"]) expect(isLinkOn(kid, href)).toBe(false);
    for (const href of ["/chores", "/points#orders", "/people/x"]) expect(isLinkOn(kid, href)).toBe(true);
    expect(isAppOn(kid, "cars")).toBe(false);
    expect(isAppOn(kid, "garage")).toBe(false);
    expect(appsOffFor(true, ["meds"])).toEqual(["meds"]);
  });
});

describe("the launcher's groups", () => {
  it("read in the same order as the rail", () => {
    const grouped = APP_GROUPS.flatMap((g) => APPS.filter((a) => a.group === g.id));
    expect(grouped.map((a) => a.id)).toEqual(APPS.map((a) => a.id));
  });
});
