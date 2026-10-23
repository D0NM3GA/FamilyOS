import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetAppTokenCache } from "@/lib/graph/app-token";
import { sendToPerson } from "./family-app";
import { chooseJarChat } from "./jar-chat";

/**
 * Phase 50 against a real database (`npm run test:db`), with Microsoft faked: a person's chat with
 * the family's Teams app is found once and kept, found again when Teams says it's gone, and a jar's
 * chat is only ever one from the member's own list.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("the family's Teams app (database)", () => {
  const env = { ...process.env };
  const ids = { h: "", mom: "", jar: "" };

  beforeAll(async () => {
    Object.assign(process.env, { MICROSOFT_CLIENT_ID: "app-id", MICROSOFT_TENANT_ID: "tenant-id", MICROSOFT_CLIENT_SECRET: "secret" });
    const h = await prisma.household.create({ data: { name: `e2e teams ${Date.now()}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } });
    await prisma.householdAlerts.create({ data: { householdId: h.id, teamsManifestId: `m-${h.id}`, teamsAppId: "catalog-1" } });
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family" } });
    Object.assign(ids, { h: h.id, mom: mom.id, jar: jar.id });
  });
  beforeEach(() => resetAppTokenCache());
  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    process.env = { ...env };
  });

  /** Graph and Bot Connector, faked: installs, the person's chat, and sends that answer `send`. */
  function microsoft(send: (chatId: string) => number) {
    const sent: string[] = [];
    let chats = 0;
    const fetchFn = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = decodeURIComponent(String(input));
      if (url.startsWith("https://login.microsoftonline.com/")) return Response.json({ access_token: "t", expires_in: 3600 });
      if (url.includes("/teamwork/installedApps/") && url.endsWith("/chat")) return Response.json({ id: `19:chat-${++chats}@unq.gbl.spaces` });
      if (url.includes("/teamwork/installedApps")) return init.method === "POST" ? new Response(null, { status: 201 }) : Response.json({ value: [{ id: "install-1" }] });
      const chatId = /conversations\/([^/]+)\/activities/.exec(url)?.[1] ?? "";
      sent.push(chatId);
      return new Response(null, { status: send(chatId) });
    }) as unknown as typeof fetch;
    return { fetchFn, sent };
  }

  test("the first message finds the person's chat and keeps it; the next one uses it", async () => {
    const m = microsoft(() => 201);
    await sendToPerson(ids.mom, "aad-mom", "catalog-1", { type: "message" }, { fetchFn: m.fetchFn });
    await sendToPerson(ids.mom, "aad-mom", "catalog-1", { type: "message" }, { fetchFn: m.fetchFn });
    expect(m.sent).toEqual(["19:chat-1@unq.gbl.spaces", "19:chat-1@unq.gbl.spaces"]);
    expect(await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.mom } })).toMatchObject({ teamsInstallId: "install-1", teamsChatId: "19:chat-1@unq.gbl.spaces" });
  });

  test("when Teams says the chat is gone, it's found again and the message tried once more", async () => {
    await prisma.alertPrefs.update({ where: { personId: ids.mom }, data: { teamsChatId: "19:stale@unq.gbl.spaces" } });
    const m = microsoft((chatId) => (chatId === "19:stale@unq.gbl.spaces" ? 404 : 201));
    await sendToPerson(ids.mom, "aad-mom", "catalog-1", { type: "message" }, { fetchFn: m.fetchFn });
    expect(m.sent).toEqual(["19:stale@unq.gbl.spaces", "19:chat-1@unq.gbl.spaces"]);
    expect((await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.mom } })).teamsChatId).toBe("19:chat-1@unq.gbl.spaces");
  });

  test("a jar's chat must be one from the member's own list, freshly read", async () => {
    const list = async () => ({
      ok: true as const,
      chats: [{ id: "19:parkers@thread.v2", topic: "The Parkers", members: [{ name: "Dad Parker", outside: false }, { name: "Mom Parker", outside: false }] }],
    });
    const install = vi.fn(async () => {});
    const jar = { id: ids.jar, householdId: ids.h };

    const stranger = await chooseJarChat(jar, "19:someone-elses@thread.v2", { list, install });
    expect(stranger).toEqual({ ok: false, error: "That chat isn't one of your group chats anymore. Choose again." });
    expect(install).not.toHaveBeenCalled();
    expect((await prisma.moneyJar.findUniqueOrThrow({ where: { id: ids.jar } })).teamsChatId).toBeNull();

    expect(await chooseJarChat(jar, "19:parkers@thread.v2", { list, install })).toEqual({ ok: true, name: "The Parkers" });
    expect(install).toHaveBeenCalledWith("19:parkers@thread.v2", "catalog-1");
    expect(await prisma.moneyJar.findUniqueOrThrow({ where: { id: ids.jar } })).toMatchObject({ teamsChatId: "19:parkers@thread.v2", teamsChatName: "The Parkers" });

    const cut = async () => ({ ok: false as const, needsGrant: true, error: "Listing your Teams chats needs one more permission." });
    expect(await chooseJarChat(jar, "19:parkers@thread.v2", { list: cut, install })).toMatchObject({ ok: false });
  });
});
