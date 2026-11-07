#!/usr/bin/env node
/**
 * Phase 61c: migrations, then the app's own database login (scripts/app-role.mjs). The migrate
 * image runs this (docker-compose.prod.yml), and so do CI, the browser tests' fresh database and
 * the auth tests' scratch ones, since grants live in each database.
 *
 *   MIGRATE_DATABASE_URL  the owner: runs migrations and grants (prisma.config.ts reads it)
 *   DATABASE_URL          the app's login: made or updated here with exactly what the app needs
 *
 * With only DATABASE_URL (or both naming the same login), it migrates and says there's no
 * separate app role, as before Phase 61. No dependency beyond Prisma's CLI: the SQL goes to
 * `prisma db execute --stdin`, never on a command line, so the password isn't in a process list.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { appRoleSql } from "./app-role.mjs";

// Node reads .env itself in development; a container passes real env vars and has no .env.
if (existsSync(".env")) process.loadEnvFile(".env");

const appUrl = process.env.DATABASE_URL;
if (!appUrl) {
  console.error("migrate: DATABASE_URL isn't set.");
  process.exit(1);
}
const ownerUrl = process.env.MIGRATE_DATABASE_URL || appUrl;
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const env = { ...process.env, MIGRATE_DATABASE_URL: ownerUrl, CHECKPOINT_DISABLE: "1" };

function prisma(args, input) {
  const r = spawnSync(process.execPath, [prismaCli, ...args], { env, input, stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"] });
  if (r.error) console.error(`migrate: couldn't run prisma: ${r.error.message}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

prisma(["migrate", "deploy"]);

let plan;
try {
  plan = appRoleSql(appUrl, ownerUrl);
} catch (err) {
  console.error(`migrate: ${err.message}`);
  process.exit(1);
}
if (plan.skip) {
  console.log(`migrate: ${plan.skip}`);
} else {
  prisma(["db", "execute", "--stdin"], plan.roleSql);
  prisma(["db", "execute", "--stdin"], plan.grantSql);
  console.log(`migrate: the app's login (${plan.role}) can read and write data, and nothing else.`);
}
