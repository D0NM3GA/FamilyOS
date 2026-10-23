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
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
