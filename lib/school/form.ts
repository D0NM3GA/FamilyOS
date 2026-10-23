import { z } from "zod";
import { parseLocalDate } from "@/lib/format";

/**
 * Form parsing for School (Phase 18). Pure: FormData in, validated fields or one error out.
 * Dates are "YYYY-MM-DD" from <input type="date">, stored as the server's local midnight
 * like every other date in the app.
 */

type Result<T> = { ok: true; fields: T } | { ok: false; error: string };

const text = (max: number) => z.string().trim().max(max).transform((s) => s || null);
const get = (fd: FormData, name: string) => String(fd.get(name) ?? "");

function optionalDate(raw: string): Date | null | "invalid" {
  if (!raw.trim()) return null;
  return parseLocalDate(raw.trim()) ?? "invalid";
}

function optionalNumber(raw: string, max: number): number | null | "invalid" {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : "invalid";
}

const profileSchema = z.object({
  schoolName: z.string().trim().min(1, "School name is required").max(120),
  grade: text(20),
  schoolYear: text(20),
  transportNotes: text(500),
  lunchNotes: text(500),
  scheduleNotes: text(2000),
  notes: text(2000),
});
export type ProfileFields = z.infer<typeof profileSchema>;

export function parseProfileForm(fd: FormData): Result<ProfileFields> {
  const parsed = profileSchema.safeParse(Object.fromEntries(Object.keys(profileSchema.shape).map((k) => [k, get(fd, k)])));
  return parsed.success ? { ok: true, fields: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
}

export const TASK_KINDS = ["FORM", "FEE", "SUPPLIES", "OTHER"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export type TaskFields = {
  title: string;
  kind: TaskKind;
  kidPersonId: string | null;
  ownerPersonId: string | null;
  dueDate: Date | null;
  amountCents: number | null;
  notes: string | null;
};

export function parseTaskForm(fd: FormData): Result<TaskFields> {
  const title = get(fd, "title").trim();
  if (!title) return { ok: false, error: "What needs doing?" };
  if (title.length > 200) return { ok: false, error: "That title is too long." };
  const kind = get(fd, "kind") as TaskKind;
  if (!TASK_KINDS.includes(kind)) return { ok: false, error: "Pick a kind." };
  const dueDate = optionalDate(get(fd, "dueDate"));
  if (dueDate === "invalid") return { ok: false, error: "Enter a valid date." };
  const amount = optionalNumber(get(fd, "amount").replace(/[$,]/g, ""), 100_000);
  if (amount === "invalid") return { ok: false, error: "Enter an amount like 12.50." };
  return {
    ok: true,
    fields: {
      title,
      kind,
      kidPersonId: get(fd, "kidPersonId") || null,
      ownerPersonId: get(fd, "ownerPersonId") || null,
      dueDate,
      amountCents: amount === null ? null : Math.round(amount * 100),
      notes: get(fd, "notes").trim().slice(0, 2000) || null,
    },
  };
}

export const ASSIGNMENT_STATUSES = ["TODO", "DONE", "MISSING"] as const;
export type AssignmentStatusValue = (typeof ASSIGNMENT_STATUSES)[number];

export type AssignmentFields = {
  className: string;
  title: string;
  dueDate: Date | null;
  status: AssignmentStatusValue;
  score: number | null;
  maxScore: number | null;
  notes: string | null;
};

export function parseAssignmentForm(fd: FormData): Result<AssignmentFields> {
  const className = get(fd, "className").trim();
  const title = get(fd, "title").trim();
  if (!className) return { ok: false, error: "Which class is it for?" };
  if (!title) return { ok: false, error: "What's the assignment?" };
  if (className.length > 80 || title.length > 200) return { ok: false, error: "That's too long." };
  const status = (get(fd, "status") || "TODO") as AssignmentStatusValue;
  if (!ASSIGNMENT_STATUSES.includes(status)) return { ok: false, error: "Pick a status." };
  const dueDate = optionalDate(get(fd, "dueDate"));
  if (dueDate === "invalid") return { ok: false, error: "Enter a valid date." };
  const score = optionalNumber(get(fd, "score"), 10_000);
  const maxScore = optionalNumber(get(fd, "maxScore"), 10_000);
  if (score === "invalid" || maxScore === "invalid") return { ok: false, error: "Scores are numbers, 0 or more." };
  if ((score === null) !== (maxScore === null)) return { ok: false, error: "Enter both the score and what it's out of, or neither." };
  if (maxScore === 0) return { ok: false, error: "\"Out of\" must be more than 0." };
  return {
    ok: true,
    fields: { className, title, dueDate, status, score, maxScore, notes: get(fd, "notes").trim().slice(0, 2000) || null },
  };
}
