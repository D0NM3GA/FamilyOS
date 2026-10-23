#!/usr/bin/env node
// Runs the dev server over HTTPS on a real hostname, so phones on the LAN can use the
// camera scanner (getUserMedia needs a secure context) and sign in with Microsoft (Entra
// only allows http for localhost). Phase 10.5; setup steps in README.md "Testing on phones".
// Run: npm run dev:lan
//
// Reads .env.lan (gitignored):
//   DEV_LAN_HOST   the hostname phones use, e.g. dev.example.com (DNS -> this PC)
//   DEV_HTTPS_KEY  path to that hostname's private key (PEM)
//   DEV_HTTPS_CERT path to its certificate chain (PEM, full chain)
//   DEV_LAN_PORT   optional, default 3000
// and points Better Auth and Next's dev-origin check at https://DEV_LAN_HOST:PORT. Use
// that one address on every device, the PC included: sign-in cookies belong to it.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const envFile = join(repoRoot, ".env.lan");
if (!existsSync(envFile)) {
  console.error("Missing .env.lan. See README.md \"Testing on phones\".");
  process.exit(1);
}
process.loadEnvFile(envFile);

const { DEV_LAN_HOST: host, DEV_HTTPS_KEY: key, DEV_HTTPS_CERT: cert } = process.env;
const port = process.env.DEV_LAN_PORT ?? "3000";
for (const [name, value] of Object.entries({ DEV_LAN_HOST: host, DEV_HTTPS_KEY: key, DEV_HTTPS_CERT: cert })) {
  if (!value) {
    console.error(`${name} is not set in .env.lan.`);
    process.exit(1);
  }
}
for (const file of [key, cert]) {
  if (!existsSync(file)) {
    console.error(`Not found: ${file}`);
    process.exit(1);
  }
}

// Set before Next starts, so they win over .env (Next never overrides a set variable).
process.env.BETTER_AUTH_URL = `https://${host}:${port}`;
process.env.DEV_ALLOWED_ORIGINS = host;
// The dev sign-in (lib/dev-auth.ts) trusts the Host header, which anyone on the network can
// set to "localhost". This server is reachable from the network, so it never has it.
process.env.DEV_AUTH = "";

const next = join(repoRoot, "node_modules", "next", "dist", "bin", "next");
const child = spawn(
  process.execPath,
  [next, "dev", "--port", port, "--experimental-https", "--experimental-https-key", key, "--experimental-https-cert", cert],
  { cwd: repoRoot, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
