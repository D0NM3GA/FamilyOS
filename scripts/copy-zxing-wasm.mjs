#!/usr/bin/env node
// Copies the barcode decoder's WebAssembly binary into public/zxing/ (Phase 10.5), so the
// camera scanner loads it from this app instead of the jsDelivr CDN barcode-detector uses
// by default: no third-party request at scan time. The filename carries zxing-wasm's
// version, so a dependency bump never serves a stale binary from a browser cache, and the
// hash is checked against the one the library itself expects.
// Runs on postinstall, predev and prebuild; the output is gitignored.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from "zxing-wasm/reader";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(repoRoot, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm");
const outDir = join(repoRoot, "public", "zxing");
const name = `zxing_reader-${ZXING_WASM_VERSION}.wasm`;

const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
if (hash !== ZXING_WASM_SHA256) {
  console.error(`zxing_reader.wasm hash ${hash} doesn't match zxing-wasm ${ZXING_WASM_VERSION}'s ${ZXING_WASM_SHA256}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const old of readdirSync(outDir)) if (old !== name) unlinkSync(join(outDir, old));
copyFileSync(source, join(outDir, name));
