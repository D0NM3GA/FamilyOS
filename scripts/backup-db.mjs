#!/usr/bin/env node
// Dumps the household database via `docker compose exec pg_dump`, in Postgres's
// custom (-Fc) format — self-compressed, restorable with `pg_restore --clean --if-exists`.
// See README.md "Backups" for the restore command. Run: npm run db:backup

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Matches docker-compose.yml's postgres service directly — not read from .env, since
// the container only honors POSTGRES_USER/_DB on a fresh volume anyway (see
// docker-compose.yml's comment), so a script-level override would silently disagree
// with what's actually running.
const user = "familycrm";
const db = "familycrm_dev";

// Anchor to the repo root (this script's parent dir), not process.cwd() — so running
// it from anywhere still finds docker-compose.yml and writes to the same backups/.
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backupsDir = join(repoRoot, "backups");
mkdirSync(backupsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
const finalPath = join(backupsDir, `${db}-${stamp}.dump`);
const tmpPath = `${finalPath}.tmp`;

function cleanupTmp() {
  try {
    unlinkSync(tmpPath);
  } catch {
    // best effort — may not exist yet
  }
}

const pgDump = spawn(
  "docker",
  ["compose", "exec", "-T", "postgres", "pg_dump", "-U", user, "-Fc", "-d", db],
  { cwd: repoRoot, stdio: ["ignore", "pipe", "inherit"] },
);

const out = createWriteStream(tmpPath, { flags: "wx" });
pgDump.stdout.pipe(out);

out.on("error", (err) => {
  console.error(`Couldn't write ${tmpPath}:`, err.message);
  process.exitCode = 1;
});

pgDump.on("error", (err) => {
  console.error("Failed to start `docker compose exec` — is Docker running?", err);
  process.exitCode = 1;
});

pgDump.on("close", (code) => {
  out.close(() => {
    if (code === 0) {
      try {
        renameSync(tmpPath, finalPath);
        console.log(`Backup written: ${finalPath}`);
      } catch (err) {
        console.error(`pg_dump succeeded but the backup couldn't be finalized:`, err.message);
        process.exitCode = 1;
      }
    } else {
      cleanupTmp();
      console.error(`pg_dump exited with code ${code} — no backup written.`);
      process.exitCode = 1;
    }
  });
});
