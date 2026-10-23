import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

/**
 * Phase 41: drops the browser tests' database and makes it again, empty (e2e/serve.mjs runs this,
 * then migrates it). Not `prisma db execute`, which runs its script in a transaction, where
 * DROP DATABASE isn't allowed. Connects to the server's own "postgres" database to do it.
 */
const dbName = process.env.E2E_DATABASE_NAME ?? "";
const adminUrl = process.env.E2E_ADMIN_URL ?? "";
// serve.mjs has checked this already; it's checked again here because this drops a database.
if (!/^[a-z0-9_]+_e2e$/.test(dbName) || !adminUrl) {
  console.error(`reset-database: refusing to drop "${dbName}" (only a database named *_e2e, from e2e/serve.mjs).`);
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  try {
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
