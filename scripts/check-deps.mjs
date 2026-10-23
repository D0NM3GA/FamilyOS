// Checks package-lock.json before it's trusted (README "Dependencies"): `npm run deps:check`.
//
// The 7-day cooldown in .npmrc only applies when npm resolves a version itself; `npm ci`
// installs whatever the lockfile says. So a lockfile changed anywhere else (another machine,
// a cloud session, a bot) is checked here before it's merged. Fails when:
// - a package.json version isn't exact (no ^, ~, ranges or tags);
// - a package isn't from registry.npmjs.org, or has no sha512 integrity;
// - a package has an install script that package.json "allowScripts" doesn't name
//   (approved at its exact version, or denied);
// - a version was published less than MIN_DAYS ago (default 7, as in .npmrc), or the
//   registry no longer has it (pulled releases are often the malicious ones).
// Node built-ins only; reads the registry, writes nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const minDays = Number(process.env.MIN_DAYS ?? 7);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const problems = [];

const exact = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
for (const field of ["dependencies", "devDependencies", "overrides"]) {
  for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
    if (!exact.test(spec)) problems.push(`package.json ${field}: ${name} is "${spec}", not an exact version`);
  }
}

const allow = pkg.allowScripts ?? {};
const versions = new Map();
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.link) continue;
  const name = path.replace(/^.*node_modules\//, "");
  if (!entry.resolved?.startsWith("https://registry.npmjs.org/")) problems.push(`${name}@${entry.version}: resolved from ${entry.resolved ?? "nowhere"}`);
  if (!entry.integrity?.startsWith("sha512-")) problems.push(`${name}@${entry.version}: no sha512 integrity`);
  if (entry.hasInstallScript && allow[`${name}@${entry.version}`] !== true && allow[name] !== false) {
    problems.push(`${name}@${entry.version}: has an install script that allowScripts doesn't approve (at this version) or deny`);
  }
  if (!versions.has(name)) versions.set(name, new Set());
  versions.get(name).add(entry.version);
}

const names = [...versions.keys()];

// Phase 41: CI fetches ~800 full documents in one go, so a busy registry (429) or a dropped
// connection gets a few tries with growing waits before it counts as a problem.
async function packument(name) {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2f")}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return await res.json();
      // Only a busy or failing registry is worth another go; a 404 is an answer.
      if (attempt >= 4 || !(res.status === 429 || res.status >= 500)) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 4 || /^HTTP \d/.test(err.message)) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
  }
}

let next = 0;
async function worker() {
  while (next < names.length) {
    const name = names[next++];
    try {
      const doc = await packument(name);
      for (const v of versions.get(name)) {
        if (!doc.versions?.[v]) problems.push(`${name}@${v}: no longer on the registry`);
        const published = Date.parse(doc.time?.[v] ?? "");
        const days = (Date.now() - published) / 86_400_000;
        if (!(days >= minDays)) problems.push(`${name}@${v}: published ${Number.isFinite(days) ? `${days.toFixed(1)} days` : "at an unknown time"} ago (under ${minDays})`);
      }
    } catch (err) {
      problems.push(`${name}: couldn't check the registry (${err.message})`);
    }
  }
}
await Promise.all(Array.from({ length: 16 }, worker));

const count = [...versions.values()].reduce((n, s) => n + s.size, 0);
if (problems.length) {
  console.error(`deps:check found ${problems.length} problem(s) in ${count} package versions:`);
  for (const p of problems.sort()) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`deps:check: ${count} package versions OK (exact pins, registry + sha512, install scripts reviewed, all older than ${minDays} days).`);
