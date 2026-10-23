// Keeps the family's real details out of the repo (AGENTS.md "Privacy and naming"):
// `npm run privacy:check` before every commit and PR.
//
// The terms to look for are the family's own (surname, first names, domains, town, school...),
// so they can't live in the repo either. They're read from .git/info/privacy-terms, which git
// never commits and every worktree of the checkout shares, plus PRIVACY_TERMS (comma
// separated) for a machine without that file. One term per line; # starts a comment. A plain
// term matches anywhere, ignoring case ("smith" also catches SmithOS and smithfamily.net); a
// line starting re: is a regular expression, also case-insensitive (re:\bjo\b for a short
// first name that's part of other words).
//
// Checks: every tracked or new (not ignored) text file, the branch name, and the commits on
// this branch that aren't on origin/main yet (messages, author and committer). With --history
// it instead summarizes every commit ever made on any branch (diffs, messages, identities),
// which is what matters before making the repository public. Node built-ins only; writes nothing.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
const root = git("rev-parse", "--show-toplevel");
const termsFile = join(git("rev-parse", "--path-format=absolute", "--git-common-dir"), "info", "privacy-terms");

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

/**
 * The term list as text. PowerShell's `>` saves UTF-16, which read as UTF-8 would match
 * nothing and pass every check without a word, so that's read as UTF-16 and anything else
 * that isn't UTF-8 text stops the check.
 */
function readTerms(path) {
  if (!existsSync(path)) return "";
  const buf = readFileSync(path);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.includes(0)) fail(`${path} isn't UTF-8 text. Save it as UTF-8, one term per line.`);
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  return buf.subarray(bom ? 3 : 0).toString("utf8");
}

const lines = [...readTerms(termsFile).split(/\r?\n/), ...(process.env.PRIVACY_TERMS ?? "").split(",")]
  // A comment starts the line or follows a space, so a term can still hold "#" ("Apt #4").
  .map((l) => l.replace(/(^|\s)#.*$/, "$1").trim())
  .filter(Boolean);
// Phase 41: GitHub masks the PRIVACY_TERMS secret only as one whole string, so each plain term of
// it is masked on its own too, in case anything later in the job prints one. Only the secret's:
// a mask command is itself a line of output, and the file's terms are never printed (a runner
// has no such file). Not regular expressions (a mask is literal text, so it would hide the
// pattern, not what it matches) or terms under 4 characters (they'd blank out that text in every
// later line of the log); quiet mode is what keeps those out.
if (process.env.GITHUB_ACTIONS === "true") {
  for (const l of (process.env.PRIVACY_TERMS ?? "").split(",").map((t) => t.trim())) {
    if (l.length >= 4 && !l.startsWith("re:")) console.log(`::add-mask::${l}`);
  }
}
const terms = lines.map((l) => {
  try {
    return { label: l, re: new RegExp(l.startsWith("re:") ? l.slice(3) : escape(l), "i") };
  } catch {
    return fail(`"${l}" in the privacy terms isn't a valid regular expression.`);
  }
});

if (terms.length === 0) {
  console.log(`No privacy terms to check against. Put the family's real names, surname, domains,
emails, town and anything else identifying in ${termsFile}
(one per line, never committed), or set PRIVACY_TERMS.`);
  if (process.argv.includes("--history")) process.exit(0);
}

// Characters nobody can see in an editor or a review (zero-width, soft hyphen, bidi controls,
// byte-order marks): they can hide text or make code read differently than it runs. Source
// writes them as backslash-u escapes instead. Built from code points so this file holds none.
const HIDDEN = new RegExp(
  `[${[[0xad], [0x34f], [0x200b, 0x200c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0xfeff]]
    .map(([lo, hi = lo]) => `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`)
    .join("")}]`,
  "u",
);

const hitsOf = (text) => terms.filter((t) => t.re.test(text)).map((t) => t.label);

// Phase 45.1: the ZIP code table (scripts/build-zip-table.mjs) is every US ZIP code, so it holds
// the family's own if that's on the term list, and says nothing about anyone. Its lines are
// skipped only while the file is exactly this build: any other change to it fails the check
// until this pin is updated on purpose. Its name and hidden characters are still checked.
const ZIP_TABLE = "lib/zip/zcta.json";
const ZIP_TABLE_SHA256 = "75dde98858c22e1cf1646b21df7b5f2b89742f2c858e4e59c5ea7461e27bb82a";
const pinnedTable = (file, buf) =>
  file === ZIP_TABLE && createHash("sha256").update(buf).digest("hex") === ZIP_TABLE_SHA256;

// Phase 41: in CI (or with --quiet) a hit says where, never which term: the log would otherwise
// print the family's own terms, and a public repo's Actions logs are public.
const quiet = process.argv.includes("--quiet") || process.env.CI === "true";
const named = (hits) => (quiet ? `${hits.length} term${hits.length === 1 ? "" : "s"}` : hits.join(", "));

if (process.argv.includes("--history")) await history();
else current();

function current() {
  const problems = [];
  const files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path)) continue; // deleted in the working tree
    const buf = readFileSync(path);
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    if (hitsOf(file).length) problems.push(`${file}: the file name (${named(hitsOf(file))})`);
    if (file === ZIP_TABLE && !pinnedTable(file, buf)) {
      problems.push(`${file}: changed since it was pinned. If you rebuilt it (scripts/build-zip-table.mjs), update ZIP_TABLE_SHA256 in this script`);
    }
    const pinned = pinnedTable(file, buf);
    buf
      .toString("utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const hits = pinned ? [] : hitsOf(line);
        if (hits.length) problems.push(`${file}:${i + 1}: ${named(hits)}`);
        if (HIDDEN.test(line)) problems.push(`${file}:${i + 1}: a hidden character (write it as an escape)`);
      });
  }

  const branch = git("branch", "--show-current");
  if (hitsOf(branch).length) problems.push(`the branch name: ${named(hitsOf(branch))}`);

  let base = "";
  try {
    base = git("merge-base", "HEAD", "origin/main");
  } catch {
    // No origin/main (a fresh clone of a fork, say): only the working tree is checked.
  }
  if (base) {
    const log = git("log", `${base}..HEAD`, "--format=%h%x00%an <%ae>%x00%cn <%ce>%x00%B%x01");
    for (const entry of log.split("\x01").map((e) => e.trim()).filter(Boolean)) {
      const [hash, author, committer, message] = entry.split("\0");
      const hits = hitsOf([author, committer, message].join("\n"));
      if (hits.length) problems.push(`commit ${hash} (message or author): ${named(hits)}`);
    }
  }
  const config = (key) => {
    try {
      return git("config", key);
    } catch {
      return ""; // not set
    }
  };
  const identity = `${config("user.name")} <${config("user.email")}>`;
  if (hitsOf(identity).length) problems.push(`git config user.name/user.email (new commits would carry it): ${named(hitsOf(identity))}`);

  if (problems.length) {
    console.error(`Personal details found (terms from ${quiet ? "the term list" : termsFile}):\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`No personal details found (${terms.length} terms, ${files.length} files, branch, unpushed commits).`);
}

/** Per term: how many commits mention it in their diff, their message, or their identities. */
async function history() {
  const counts = new Map(terms.map((t) => [t.label, { diff: new Set(), message: new Set(), identity: new Set() }]));
  const marker = "\x02commit ";
  // --diff-merges=first-parent: a merge's own changes (conflict resolutions) count too.
  const child = spawn(
    "git",
    ["log", "--all", "-p", "--diff-merges=first-parent", "--no-color", "--no-ext-diff", "--format=%x02commit %h%n%an <%ae>%n%cn <%ce>%n%B%n%x03"],
    { cwd: root },
  );
  let hash = "";
  let part = "diff";
  let header = 0;
  // The ZIP table's own lines are every US ZIP code (see ZIP_TABLE above): not counted here,
  // since the current check pins its content.
  // Only diffs that produce the pinned table itself are skipped; an older revision of it isn't.
  let inTable = false;
  let skipTable = false;
  const pinnedBlob = existsSync(join(root, ZIP_TABLE)) && pinnedTable(ZIP_TABLE, readFileSync(join(root, ZIP_TABLE))) ? git("hash-object", ZIP_TABLE) : "";
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    if (line.startsWith(marker)) {
      hash = line.slice(marker.length);
      part = "identity";
      header = 0;
      inTable = false;
      skipTable = false;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      inTable = line === `diff --git a/${ZIP_TABLE} b/${ZIP_TABLE}`;
      skipTable = false;
    }
    if (inTable && line.startsWith("index ")) {
      const after = line.split(" ")[1]?.split("..")[1] ?? "";
      skipTable = Boolean(pinnedBlob && after && pinnedBlob.startsWith(after));
    }
    if (part === "diff" && skipTable && line.startsWith("+") && !line.startsWith("+++")) continue;
    if (part === "identity" && ++header > 2) part = "message";
    if (line === "\x03") {
      part = "diff";
      continue;
    }
    // Only what a commit adds (and the names of files it touches): unchanged context and
    // removed lines belong to older commits, which are counted on their own.
    if (part === "diff" && !line.startsWith("+")) continue;
    for (const label of hitsOf(line)) counts.get(label)[part].add(hash);
  }
  const total = git("rev-list", "--all", "--count");
  console.log(`History of every branch (${total} commits). Commits that mention each term:`);
  let any = false;
  for (const [label, c] of counts) {
    if (!c.diff.size && !c.message.size && !c.identity.size) continue;
    any = true;
    console.log(`- ${label}: ${c.diff.size} in changes, ${c.message.size} in messages, ${c.identity.size} in author/committer`);
  }
  if (!any) console.log("- none");
  else console.log("Removing these needs a history rewrite or a fresh repository (README \"Privacy\").");
}
