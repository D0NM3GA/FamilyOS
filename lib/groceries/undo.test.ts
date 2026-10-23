import { describe, expect, it } from "vitest";
import { UNDO_TTL_MS, openRemoved, sealRemoved, type RemovedRow } from "./undo";

const row: RemovedRow = { productId: "milk", quantity: 2, done: false, addedById: "ivy", requestedById: "ivy", kidPick: true };
const at = new Date("2026-10-09T12:00:00Z");
const later = (ms: number) => new Date(at.getTime() + ms);

describe("the list's Undo token", () => {
  it("gives back exactly the row that was taken off", () => {
    const token = sealRemoved(row, "home", at);
    expect(openRemoved(token, "home", later(6000))).toEqual(row);
  });

  it("only works for the family it came from", () => {
    expect(openRemoved(sealRemoved(row, "home", at), "next-door", later(1000))).toBeNull();
  });

  it("goes stale after a while", () => {
    const token = sealRemoved(row, "home", at);
    expect(openRemoved(token, "home", later(UNDO_TTL_MS))).toEqual(row);
    expect(openRemoved(token, "home", later(UNDO_TTL_MS + 1))).toBeNull();
    expect(openRemoved(token, "home", later(-1))).toBeNull();
  });

  it("can't be edited: a kid can't clear their own pick's veto flag", () => {
    const token = sealRemoved(row, "home", at);
    const [body, mac] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.r.kidPick = false;
    const forged = `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${mac}`;
    expect(openRemoved(forged, "home", later(1000))).toBeNull();
    expect(openRemoved(`${body}.${mac.slice(0, -1)}${mac.endsWith("0") ? "1" : "0"}`, "home", later(1000))).toBeNull();
  });

  it("shrugs off junk", () => {
    for (const junk of ["", ".", "abc", "abc.", ".abc", "a.b.c", "😀.😀"]) {
      expect(openRemoved(junk, "home", at)).toBeNull();
    }
  });
});
