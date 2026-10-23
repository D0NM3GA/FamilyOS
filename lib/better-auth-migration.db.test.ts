import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 40.1 against a real database: `npm run test:db`. The Better Auth 1.7 migration rewrites
 * every Microsoft account's id to the `oid` claim of its stored ID token, decoded in SQL. This
 * runs that migration's own decoding function (read from the migration file) on made-up tokens:
 * every base64url padding case, the URL-safe characters, and a token with no `oid`.
 */
const RUN = import.meta.env.MODE === "db";

const MIGRATION = path.resolve(__dirname, "..", "prisma", "migrations", "20261027120000_better_auth_1_7", "migration.sql");

function jwtClaimFunction(): string {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("-- BEGIN jwt_claim");
  const end = sql.indexOf("-- END jwt_claim");
  if (start < 0 || end < 0) throw new Error("jwt_claim markers not found in the migration");
  return sql.slice(sql.indexOf("\n", start) + 1, end);
}

const b64url = (json: object) => Buffer.from(JSON.stringify(json)).toString("base64url");
const token = (payload: object) => `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(payload)}.signature`;

/** Decodes `claim` from each token with the migration's function, in one session (pg_temp). */
async function decode(tokens: string[], claim = "oid"): Promise<(string | null)[]> {
  return prisma.$transaction(async (tx) => {
    // pg_temp lives as long as the (pooled) connection, so an earlier test may have made it.
    await tx.$executeRawUnsafe("DROP FUNCTION IF EXISTS pg_temp.jwt_claim(text, text)");
    await tx.$executeRawUnsafe(jwtClaimFunction());
    const out: (string | null)[] = [];
    for (const t of tokens) {
      const [row] = await tx.$queryRawUnsafe<{ value: string | null }[]>(`SELECT pg_temp.jwt_claim($1, $2) AS value`, t, claim);
      out.push(row.value);
    }
    return out;
  });
}

describe.skipIf(!RUN)("Better Auth 1.7 migration: the oid backfill (database)", { timeout: 60_000 }, () => {
  test("reads oid whatever the payload's padding", async () => {
    const oid = "00000000-0000-4000-8000-000000000001";
    // Payloads of different lengths leave 0, 2 and 3 characters over in base64.
    const payloads = [{ oid }, { oid, a: "x" }, { oid, ab: "xy" }, { oid, abc: "xyz" }];
    // Unpadded base64url leaves 0, 2 or 3 characters in its last group; cover each.
    expect(new Set(payloads.map((p) => b64url(p).length % 4))).toEqual(new Set([0, 2, 3]));
    expect(await decode(payloads.map(token))).toEqual(payloads.map(() => oid));
  });

  test("handles base64url's - and _", async () => {
    // "?>" and "~~" encode to characters that differ between base64 and base64url.
    const payload = { oid: "00000000-0000-4000-8000-000000000002", n: "?>?>~~~~" };
    expect(b64url(payload)).toMatch(/[-_]/);
    expect(await decode([token(payload)])).toEqual([payload.oid]);
  });

  test("is null when the token has no oid", async () => {
    expect(await decode([token({ sub: "pairwise-sub" })])).toEqual([null]);
  });

  test("is null, not an error, for a token that isn't a JWT", async () => {
    // Bad base64, a payload that isn't JSON, a payload that's JSON but not an object, no dots.
    const notJson = `x.${Buffer.from("not json").toString("base64url")}.y`;
    const array = `x.${Buffer.from("[1,2]").toString("base64url")}.y`;
    expect(await decode(["a.!!!.b", notJson, array, "nodots"])).toEqual([null, null, null, null]);
  });
});
