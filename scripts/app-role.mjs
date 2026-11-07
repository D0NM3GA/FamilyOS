/**
 * Phase 61c: the SQL that gives the app its own database login, able to read and write data and
 * nothing else (the project's least-privilege rule). Pure, so it's unit-tested
 * (lib/app-role.test.ts); scripts/migrate.mjs runs it after `prisma migrate deploy`.
 *
 * The app's role (DATABASE_URL's user) gets SELECT, INSERT, UPDATE and DELETE on every table,
 * USAGE and SELECT on sequences, read-only on _prisma_migrations (the app's own backup file
 * records the last migration), and no CREATE anywhere (Postgres 15+ doesn't give PUBLIC CREATE on
 * the public schema). Default privileges FOR the owner cover tables later migrations make. Grants
 * live in each database, so whatever makes a database runs this, not a bare `migrate deploy`.
 */

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** The parts of a postgres URL this needs, decoded (a password may be percent-encoded). */
export function urlParts(raw) {
  const u = new URL(raw);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    schema: u.searchParams.get("schema") || "public",
    hostname: u.hostname,
    port: u.port,
  };
}

const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;
// standard_conforming_strings is on (the default since Postgres 9.1): only quotes need doubling.
const quoteLiteral = (text) => `'${text.replace(/'/g, "''")}'`;

/**
 * What to run as the owner, or why not. `skip` when both URLs are the same login (an install
 * that hasn't split them yet): nothing changes for it.
 */
export function appRoleSql(appUrl, ownerUrl) {
  const app = urlParts(appUrl);
  const owner = urlParts(ownerUrl);
  if (app.user === owner.user) return { skip: `DATABASE_URL and MIGRATE_DATABASE_URL use the same login (${owner.user}): no separate app role.` };
  const where = (p) => `${p.hostname}:${p.port || "5432"}/${p.database}`;
  if (where(app) !== where(owner)) throw new Error(`DATABASE_URL (${where(app)}) and MIGRATE_DATABASE_URL (${where(owner)}) must point at the same database.`);
  for (const [what, name] of [["app login", app.user], ["owner login", owner.user], ["schema", app.schema]]) {
    if (!IDENT.test(name)) throw new Error(`The ${what} "${name}" must be lowercase letters, digits and underscores.`);
  }
  if (!app.password) throw new Error("DATABASE_URL needs a password for the app's login.");
  if (app.password.includes("\0")) throw new Error("The app's password can't contain a NUL character.");
  const role = quoteIdent(app.user);
  const ownerRole = quoteIdent(owner.user);
  const schema = quoteIdent(app.schema);
  // Two scripts, run one after the other: the password goes alone in a statement with almost no
  // way to fail, because Postgres logs the whole text of a failing statement, and a failing grant
  // in the same script would put the password in the database's log.
  const roleSql = [
    // Check, then create: not atomic, but migrate runs once per start (and tests one at a time).
    `DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(app.user)}) THEN CREATE ROLE ${role} LOGIN; END IF; END $role$;`,
    `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quoteLiteral(app.password)};`,
  ].join("\n");
  const grantSql = [
    `REVOKE CREATE ON SCHEMA ${schema} FROM ${role};`,
    `GRANT USAGE ON SCHEMA ${schema} TO ${role};`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${role};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role};`,
    `REVOKE INSERT, UPDATE, DELETE ON TABLE ${schema}."_prisma_migrations" FROM ${role};`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${role};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA ${schema} GRANT USAGE, SELECT ON SEQUENCES TO ${role};`,
  ].join("\n");
  return { roleSql, grantSql, role: app.user };
}
