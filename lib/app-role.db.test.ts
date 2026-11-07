import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 61c against a real database (`npm run test:db`): the app's own login reads and writes
 * data and can't change the database's shape. Runs only where DATABASE_URL and
 * MIGRATE_DATABASE_URL are different logins (CI, and development set up as .env.example says).
 */
const RUN = import.meta.env.MODE === "db";
const split = (() => {
  const app = process.env.DATABASE_URL;
  const owner = process.env.MIGRATE_DATABASE_URL;
  return Boolean(app && owner && new URL(app).username !== new URL(owner).username);
})();

const refused = async (sql: string) => {
  try {
    await prisma.$executeRawUnsafe(sql);
    return null;
  } catch (err) {
    // Prisma wraps the driver's error (P2010); Postgres's own wording says whether it was rights.
    return /permission denied|must be owner/.test(String(err)) ? "42501" : String(err).slice(0, 200);
  }
};

describe.skipIf(!RUN || !split)("the app's database login (database)", () => {
  test("can't create, drop or empty tables, or rewrite the migration history", async () => {
    for (const sql of [
      "CREATE TABLE app_role_probe (id int)",
      "DROP TABLE rate_limit",
      "TRUNCATE rate_limit",
      "ALTER TABLE rate_limit ADD COLUMN probe int",
      `DELETE FROM "_prisma_migrations"`,
    ]) {
      // insufficient_privilege: refused for rights, not a typo or a dropped connection.
      expect(await refused(sql), sql).toBe("42501");
    }
  });

  test("does what the app itself does: read the migration history, lock, read and write", async () => {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "_prisma_migrations"`);
    expect(Number(rows[0].n)).toBeGreaterThan(0);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('app-role-probe'))`;
    });
    const key = `app-role-probe-${Date.now()}`;
    await prisma.rateLimit.create({ data: { id: key, key, count: 1, lastRequest: BigInt(Date.now()) } });
    await prisma.rateLimit.update({ where: { key }, data: { count: 2 } });
    await prisma.rateLimit.delete({ where: { key } });
  });
});
