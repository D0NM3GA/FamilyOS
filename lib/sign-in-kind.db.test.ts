import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { microsoftLinkedUserIds, signInKind } from "./sign-in-kind";

/**
 * Phase 40.1b against a real database: `npm run test:db`. Who has a Microsoft account linked,
 * from the account rows. Throwaway users, deleted afterwards.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("sign-in kind (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const microsoft = `e2e-kind-ms-${t}`;
  const passkey = `e2e-kind-pk-${t}`;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: microsoft, name: "Dad", email: `dad-kind-${t}@example.com` } });
    await prisma.user.create({ data: { id: passkey, name: "Grandma", email: `grandma-kind-${t}@example.com` } });
    await prisma.account.create({ data: { userId: microsoft, providerId: "microsoft", accountId: `00000000-0000-4000-8000-${String(t).slice(-12).padStart(12, "0")}` } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [microsoft, passkey] } } });
  });

  test("finds the users with a Microsoft account, ignoring PIN profiles", async () => {
    expect(await microsoftLinkedUserIds([microsoft, passkey, null])).toEqual(new Set([microsoft]));
  });

  test("asks nothing for nobody", async () => {
    expect(await microsoftLinkedUserIds([])).toEqual(new Set());
    expect(await microsoftLinkedUserIds([null, null])).toEqual(new Set());
  });

  test("names each kind", async () => {
    expect(await signInKind({ authUserId: microsoft })).toBe("microsoft");
    expect(await signInKind({ authUserId: passkey })).toBe("own");
    expect(await signInKind({ authUserId: null })).toBe("pin");
  });
});
