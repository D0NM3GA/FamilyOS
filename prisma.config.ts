import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Node reads .env itself (no dotenv); a container passes real env vars and has no .env.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Phase 61c: migrations, seeds and test databases run as the owner (MIGRATE_DATABASE_URL);
  // the app itself connects as DATABASE_URL, a login that can only read and write data.
  datasource: {
    url: process.env["MIGRATE_DATABASE_URL"] || process.env["DATABASE_URL"],
  },
});
