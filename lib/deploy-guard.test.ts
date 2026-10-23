import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Phase 46: the published image must never carry anything about one family, and only the publish
 * job may write to the registry. Read from the files themselves, like lib/forms-guard.test.ts,
 * so a later change to the Dockerfile, the compose files or a workflow can't quietly undo it.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const WORKFLOWS = fs.readdirSync(path.join(ROOT, ".github", "workflows")).map((f) => `.github/workflows/${f}`);

/** The .ts and .tsx files under a folder, tests and generated code left out. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === "generated" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test.") ? [p] : [];
  });
}

/** One job's lines from a workflow: from `  <job>:` to the next job (two-space indent) or the end. */
function jobBlock(text: string, job: string): string {
  const start = text.indexOf(`\n  ${job}:\n`);
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("nothing is built into the image", () => {
  test("the Dockerfile takes no build argument but the base image", () => {
    const args = [...read("Dockerfile").matchAll(/^ARG\s+(\w+)/gm)].map((m) => m[1]);
    expect(args).toEqual(["NODE_IMAGE"]);
  });

  test("no compose file passes build arguments", () => {
    for (const file of ["docker-compose.prod.yml", "docker-compose.build.yml", "docker-compose.ci.yml"]) {
      expect(read(file), file).not.toMatch(/^\s+args:/m);
    }
  });

  test("production compose only pulls: no build, so a failed pull can't become a local build", () => {
    expect(read("docker-compose.prod.yml")).not.toMatch(/^\s+build:/m);
  });

  test("no NEXT_PUBLIC_ setting is read anywhere (Next would build it in)", () => {
    const files = ["lib", "app", "components"].flatMap(sourceFiles);
    const roots = ["proxy.ts", "instrumentation.ts", "instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts", "next.config.ts"];
    const offenders = [...files, ...roots].filter((f) => /process\.env(\.|\[\s*["'`])NEXT_PUBLIC_/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("the workflows", () => {
  test("every action is GitHub's own, pinned to a full commit SHA", () => {
    for (const file of WORKFLOWS) {
      for (const [, ref] of read(file).matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)) {
        expect(ref, `${file}: ${ref}`).toMatch(/^actions\/[\w.-]+@[0-9a-f]{40}$/);
      }
    }
  });

  test("only the publish job can write to the registry, with exactly what it needs", () => {
    for (const file of WORKFLOWS) {
      const text = read(file);
      const writes = text.match(/^\s+packages:\s*write/gm) ?? [];
      if (file !== ".github/workflows/container.yml") expect(writes, file).toEqual([]);
    }
    const container = read(".github/workflows/container.yml");
    // The workflow's default stays read-only.
    expect(container).toMatch(/^permissions:\n {2}contents: read\n/m);
    const publish = jobBlock(container, "publish");
    expect(publish).toMatch(/permissions:\n {6}contents: read\n {6}packages: write\n {6}id-token: write\n {6}attestations: write\n/);
    expect(container.match(/packages:\s*write/g)).toHaveLength(1);
    // It runs no project code: no checkout, no npm.
    expect(publish).not.toMatch(/actions\/checkout|npm |npx /);
    expect(publish).toMatch(/if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  });

  test("main runs queue instead of cancelling each other", () => {
    expect(read(".github/workflows/container.yml")).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  });
});
