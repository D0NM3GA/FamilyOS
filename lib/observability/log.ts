import { scrubText } from "./scrub";

/**
 * Phase 61: the server's log lines, one JSON object each on stdout or stderr, so `docker logs`
 * can be searched and filtered (`jq 'select(.level=="error")'`). No Sentry or Prisma import,
 * so anything on the server can use it. Fields are ids, counts and fixed words only: never a
 * name, email or amount (the type allows no objects, so nothing large lands in a line by
 * accident). In the browser (captureError on an error page) the line goes to the console.
 */

export type LogFields = Record<string, string | number | boolean | null | undefined>;
type Level = "info" | "warn" | "error";

const MAX_TEXT = 300;

/** One short, scrubbed line about an error: its class, and for Prisma errors only the code (their messages print the query's values). */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err === "string" ? clip(scrubText(err)) : "unknown error";
  // err.name first: Prisma's errors set it, and it survives a bundler renaming classes.
  const name = (err.name && err.name !== "Error" ? err.name : err.constructor?.name) || "Error";
  if (name.startsWith("PrismaClient")) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? `${name} ${code}` : name;
  }
  return clip(`${name}: ${scrubText(err.message)}`);
}

function clip(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT - 1)}…` : one;
}

/** The JSON line for one event (pure, for tests). String fields are scrubbed and clipped. */
export function logLine(level: Level, event: string, fields: LogFields = {}, now: Date = new Date()): string {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    clean[key] = typeof value === "string" ? clip(scrubText(value)) : value;
  }
  return JSON.stringify({ time: now.toISOString(), level, event, ...clean });
}

function write(level: Level, event: string, fields?: LogFields) {
  const line = logLine(level, event, fields);
  // captureError also runs in the browser (error pages), where there's no process.stdout.
  const stream = typeof process === "undefined" ? undefined : level === "info" ? process.stdout : process.stderr;
  if (stream?.write) stream.write(`${line}\n`);
  else if (level === "info") console.info(line);
  else console.error(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
