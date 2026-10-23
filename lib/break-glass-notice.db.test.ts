import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetBreakGlassCache } from "@/lib/security/break-glass";
import { breakGlassStatus } from "./break-glass-notice";

/** Phase 42.7: every admin hears once when the break-glass entrance starts and once when it ends. */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("break-glass notices (database)", () => {
  const dir = mkdtempSync(join(tmpdir(), "bg-notice-"));
  const file = join(dir, "state.json");
  const ids = { h: "", activation: `bg-test-${Date.now()}` };
  const now = Date.now();

  beforeAll(async () => {
    process.env.BREAK_GLASS_STATE = file;
    const h = await prisma.household.create({ data: { name: `bg-${Date.now()}` } });
    await prisma.person.createMany({
      data: [
        { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true },
        { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true },
        { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true },
      ],
    });
    ids.h = h.id;
  });
  afterAll(async () => {
    await prisma.breakGlassNotice.deleteMany({ where: { householdId: ids.h } });
    await prisma.household.deleteMany({ where: { id: ids.h } });
    rmSync(dir, { recursive: true, force: true });
    delete process.env.BREAK_GLASS_STATE;
  });

  const notices = () => prisma.notification.count({ where: { householdId: ids.h, kind: "SIGN_IN_CHANGED" } });

  test("on: a banner, and each admin told once", async () => {
    writeFileSync(
      file,
      JSON.stringify({ id: ids.activation, secret: "x".repeat(64), startedAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString() }),
    );
    resetBreakGlassCache();
    const first = await Promise.all([breakGlassStatus(ids.h, null, now), breakGlassStatus(ids.h, null, now)]);
    expect(first.every((s) => s?.endsAt.getTime() === now + 3_600_000)).toBe(true);
    expect(await notices()).toBe(2); // two admins, not the kid, and not twice for two pages at once
    expect(await prisma.signInEvent.count({ where: { householdId: ids.h, kind: "BREAK_GLASS_ON" } })).toBe(1);
    await breakGlassStatus(ids.h, null, now + 1000);
    expect(await notices()).toBe(2);
  });

  test("off: no banner, and each admin told once that it's over", async () => {
    rmSync(file);
    resetBreakGlassCache();
    expect(await breakGlassStatus(ids.h, null, now + 2000)).toBeNull();
    expect(await notices()).toBe(4);
    expect((await prisma.breakGlassNotice.findUniqueOrThrow({ where: { id: ids.activation } })).endedAt).not.toBeNull();
    expect(await prisma.signInEvent.count({ where: { householdId: ids.h, kind: "BREAK_GLASS_OFF" } })).toBe(1);
    await breakGlassStatus(ids.h, null, now + 3000);
    expect(await notices()).toBe(4);
  });
});
