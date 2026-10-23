#!/usr/bin/env node
// Phase 43: after `next build`, copies public/ and .next/static into .next/standalone, where the
// standalone server (the production image, `npm start`, the browser tests) serves them from. Next
// leaves that to the deployer. All of public/ is needed at run time, not only as static files
// (lib/app-icon.tsx reads public/icons). Runs as npm's postbuild. Node built-ins only.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const standalone = join(root, ".next", "standalone");
if (!existsSync(standalone)) {
  console.error("No .next/standalone: is output \"standalone\" still set in next.config.ts?");
  process.exit(1);
}
for (const [from, to] of [
  [join(root, "public"), join(standalone, "public")],
  [join(root, ".next", "static"), join(standalone, ".next", "static")],
]) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
