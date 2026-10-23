import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Test support for sign-in tests that drive Better Auth's own HTTP handler (`npm run test:db`):
 * a scratch database, migrated, that the app's modules are pointed at and that's dropped after;
 * and a browser's cookie jar. Setup only happens while there's no household, so these tests
 * can't share the dev database.
 */

export const ORIGIN = new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000").origin;
export const RP_ID = new URL(ORIGIN).hostname;

/** A browser's cookies, enough for Better Auth's session and passkey-challenge cookies. */
export class CookieJar {
  private cookies = new Map<string, string>();
  take(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  has(fragment: string) {
    return [...this.cookies.keys()].some((k) => k.includes(fragment));
  }
  /** A copy without the cookies whose names contain `fragment` (e.g. signed out, mid-ceremony). */
  without(fragment: string) {
    const copy = new CookieJar();
    copy.cookies = new Map([...this.cookies].filter(([k]) => !k.includes(fragment)));
    return copy;
  }
}

/** Creates `<prefix>_<time>`, migrates it, and points DATABASE_URL (and lib/prisma) at it. */
export function scratchDatabase(prefix: string) {
  const devUrl = process.env.DATABASE_URL!;
  const dbName = `${prefix}_${Date.now()}`;
  const u = new URL(devUrl);
  u.pathname = `/${dbName}`;
  const scratchUrl = u.toString();

  async function admin(sql: string) {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: devUrl }) });
    try {
      await client.$executeRawUnsafe(sql);
    } finally {
      await client.$disconnect();
    }
  }

  return {
    async create() {
      await admin(`CREATE DATABASE "${dbName}"`);
      execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: scratchUrl }, stdio: "ignore" });
      process.env.DATABASE_URL = scratchUrl;
      delete globalThis.__prisma;
    },
    async drop(prisma?: { $disconnect(): Promise<void> }) {
      await prisma?.$disconnect();
      process.env.DATABASE_URL = devUrl;
      await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    },
  };
}

type Handler = { handler: (request: Request) => Promise<Response> };

/** One request to Better Auth's handler, as `jar`'s browser. */
export async function authCall(auth: Handler, jar: CookieJar, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: init.method ?? "GET",
      headers: { cookie: jar.header(), origin: ORIGIN, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  jar.take(res);
  return res;
}
