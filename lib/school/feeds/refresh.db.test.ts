import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import type { FetchResult } from "./fetch";
import { claimStaleFeeds, feedAad, refreshFeed } from "./refresh";

/**
 * School feed refresh against a real database, with a stubbed fetch (Phase 18.5):
 * `npm run test:db`. Skipped by plain `npm test`. A throwaway household.
 */
const RUN = import.meta.env.MODE === "db";

const ics = (summary: string, day = "20261012") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\nBEGIN:VEVENT\r\nUID:e1\r\nDTSTART;VALUE=DATE:${day}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe.skipIf(!RUN)("school feed refresh (database)", () => {
  const ids = {} as { h: string; feed: string };
  const now = new Date("2026-09-25T12:00:00Z");

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e feeds ${Date.now()}`, timezone: "America/New_York" } });
    const id = `feed-${Date.now()}`;
    const secret = encryptSecret("https://school.example/cal.ics", feedAad(id));
    await prisma.schoolFeed.create({
      data: {
        id,
        householdId: h.id,
        name: "Lincoln",
        encryptedValue: new Uint8Array(secret.encryptedValue),
        iv: new Uint8Array(secret.iv),
        authTag: new Uint8Array(secret.authTag),
        urlHash: `hash-${id}`,
        host: "school.example",
      },
    });
    Object.assign(ids, { h: h.id, feed: id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const events = () => prisma.schoolFeedEvent.findMany({ where: { feedId: ids.feed } });
  const feed = () => prisma.schoolFeed.findUniqueOrThrow({ where: { id: ids.feed } });

  test("a stale feed is claimed once, fetched with its decrypted address, and its events stored", async () => {
    expect(await claimStaleFeeds(ids.h, now)).toEqual([ids.feed]);
    expect(await claimStaleFeeds(ids.h, now)).toEqual([]); // leased
    let seen: string | null = null;
    const r = await refreshFeed(ids.feed, {
      now,
      fetcher: async (url): Promise<FetchResult> => {
        seen = url.toString();
        return { status: "ok", body: ics("Fall break"), etag: '"v1"', lastModified: null };
      },
    });
    expect(r).toEqual({ ok: true, events: 1 });
    expect(seen).toBe("https://school.example/cal.ics");
    expect((await events()).map((e) => [e.title, e.allDay, e.startsAt.toISOString()])).toEqual([["Fall break", true, "2026-10-12T00:00:00.000Z"]]);
    expect(await feed()).toMatchObject({ leaseUntil: null, lastError: null, etag: '"v1"' });
    expect(await claimStaleFeeds(ids.h, now)).toEqual([]); // fresh now
  });

  test("304 keeps the events and sends the etag; a changed feed replaces them", async () => {
    let conditional: unknown = null;
    await refreshFeed(ids.feed, {
      now: new Date(now.getTime() + 60_000),
      fetcher: async (_u, c) => {
        conditional = c;
        return { status: "unchanged" };
      },
    });
    expect(conditional).toMatchObject({ etag: '"v1"' });
    expect(await events()).toHaveLength(1);

    await refreshFeed(ids.feed, { now, fetcher: async () => ({ status: "ok", body: ics("Picture day", "20261020"), etag: null, lastModified: null }) });
    expect((await events()).map((e) => e.title)).toEqual(["Picture day"]);
  });

  test("a fetch error or unreadable body keeps the old events and records fixed text", async () => {
    await refreshFeed(ids.feed, { now, fetcher: async () => ({ status: "error", reason: "nope" }) });
    expect((await feed()).lastError).toBe("nope");
    await refreshFeed(ids.feed, { now, fetcher: async () => ({ status: "ok", body: "BEGIN:VCALENDAR\r\ngarbage", etag: null, lastModified: null }) });
    expect(await events()).toHaveLength(1);
    expect((await feed()).leaseUntil).toBeNull();
  });

  test("a ciphertext moved to another row doesn't decrypt", async () => {
    const other = await prisma.schoolFeed.create({
      data: { ...(await feed()), id: `moved-${Date.now()}`, urlHash: `other-${Date.now()}`, etag: null, lastModified: null },
    });
    const r = await refreshFeed(other.id, { now, fetcher: async () => ({ status: "unchanged" }) });
    expect(r.ok).toBe(false);
    expect((await prisma.schoolFeed.findUniqueOrThrow({ where: { id: other.id } })).lastError).toMatch(/can't be read/);
  });

  test("removing a feed removes its events", async () => {
    await prisma.schoolFeed.delete({ where: { id: ids.feed } });
    expect(await events()).toHaveLength(0);
  });
});
