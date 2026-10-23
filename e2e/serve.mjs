// Phase 41: the browser tests' server (Playwright's webServer runs this). In order:
//
// 1. a fresh database: E2E_DATABASE_URL, whose name must end in "_e2e" (so it can never be the
//    dev database), dropped and made again, then migrated;
// 2. a production build (`npm run build`: `next build` and the standalone copy) and the
//    standalone server, as the production image runs it (Phase 43), on http://localhost:3100.
//
// Both steps run with an environment of their own: Next and Prisma read .env for anything not
// already set, so every setting that would reach the owner's real services or data is set here
// explicitly (empty means off): the database, the dev sign-in, background jobs, Microsoft, an OIDC
// provider, alert email, phone push, receipt reading, Sentry (inlined at build time, and the build
// plugin's release), the contact address. The two keys are made fresh for each run unless CI
// passes its own: nothing a test writes is ever under a real key.
//
// The order matters: the server remembers "this install is set up" for as long as it runs, so the
// database must be fresh before the server starts, not after (Fable's scope review).
//
// E2E_SKIP_BUILD=1 reuses the last build (it must have been made by this script).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const PORT = process.env.E2E_PORT ?? "3100";
const ORIGIN = `http://localhost:${PORT}`;

// Only the two database addresses come from the env files (and only when not already set), so a
// local run finds its test database without reading anything else there. The files a production
// build reads, in Next's order (the first that has it wins).
const ENV_FILES = [".env.production.local", ".env.local", ".env.production", ".env"];
function fromDotenv(key) {
  if (process.env[key] !== undefined) return process.env[key];
  for (const name of ENV_FILES) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m?.[1] === key) return m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
  return undefined;
}

const dbUrl = fromDotenv("E2E_DATABASE_URL");
if (!dbUrl) {
  console.error('E2E_DATABASE_URL isn\'t set. Point it at a database just for these tests (README "Testing").');
  process.exit(1);
}
const url = new URL(dbUrl);
const dbName = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z0-9_]+_e2e$/.test(dbName)) {
  console.error(`E2E_DATABASE_URL's database is "${dbName}": it must end in "_e2e", since these tests drop it and make it again.`);
  process.exit(1);
}
const devUrl = fromDotenv("DATABASE_URL");
if (devUrl) {
  const dev = new URL(devUrl);
  if (dev.host === url.host && dev.pathname === url.pathname) {
    console.error("E2E_DATABASE_URL is the same database as DATABASE_URL. Give the tests one of their own.");
    process.exit(1);
  }
}

const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: dbUrl,
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString("base64url"),
  INTEGRATION_ENCRYPTION_KEY: process.env.INTEGRATION_ENCRYPTION_KEY || randomBytes(32).toString("base64"),
  DEV_AUTH: "",
  BACKGROUND_JOBS: "0",
  MICROSOFT_CLIENT_ID: "",
  MICROSOFT_CLIENT_SECRET: "",
  MICROSOFT_TENANT_ID: "",
  OIDC_DISCOVERY_URL: "",
  OIDC_CLIENT_ID: "",
  OIDC_CLIENT_SECRET: "",
  OIDC_NAME: "",
  ALERT_MAILBOX: "",
  // Phase 45.2: with no keys, an http address and no contact address, the server makes no
  // phone-alert keys of its own either, so phone push stays off in the browser tests.
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  VAPID_SUBJECT: "",
  DOCINTEL_ENDPOINT: "",
  SENTRY_DSN: "",
  // The build's Sentry plugin would otherwise make a release in the family's Sentry project.
  SENTRY_AUTH_TOKEN: "",
  SENTRY_ORG: "",
  SENTRY_PROJECT: "",
  // Goes out in User-Agent headers (lib/user-agent.ts): the generic fallback instead.
  CONTACT_EMAIL: "",
  NWS_CONTACT_EMAIL: "",
  TRUSTED_PROXIES: "",
  // The browser's zone, not .env's: a server rendering times in another zone than the page
  // hydrates in is a hydration mismatch, a console error.
  TZ: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  NEXT_TELEMETRY_DISABLED: "1",
  CHECKPOINT_DISABLE: "1",
};

// Each tool's own entry point, run by this Node: no shell (and no .cmd shims on Windows).
const tool = {
  prisma: join(root, "node_modules", "prisma", "build", "index.js"),
  next: join(root, "node_modules", "next", "dist", "bin", "next"),
  standaloneAssets: join(root, "scripts", "standalone-assets.mjs"),
  tsx: join(root, "node_modules", "tsx", "dist", "cli.mjs"),
};
function run(name, args, { extraEnv = {}, ...options } = {}) {
  const r = spawnSync(process.execPath, [tool[name], ...args], { cwd: root, env: { ...env, ...extraEnv }, stdio: "inherit", ...options });
  if (r.error) console.error(`e2e/serve.mjs: couldn't run ${name}: ${r.error.message}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 1. A fresh database (e2e/reset-database.ts), then its tables.
const admin = new URL(dbUrl);
admin.pathname = "/postgres";
admin.search = "";
run("tsx", ["e2e/reset-database.ts"], { extraEnv: { E2E_ADMIN_URL: admin.toString(), E2E_DATABASE_NAME: dbName } });
run("prisma", ["migrate", "deploy"]);

// 2. Build and start.
if (process.env.E2E_SKIP_BUILD !== "1") {
  run("next", ["build"]);
  run("standaloneAssets", []);
}
// The standalone server reads PORT and HOSTNAME; the variables set here win over the .env a local
// build copies into .next/standalone.
const server = spawn(process.execPath, [join(root, ".next", "standalone", "server.js")], {
  cwd: root,
  env: { ...env, PORT, HOSTNAME: "localhost" },
  stdio: "inherit",
});
const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
