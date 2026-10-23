/**
 * Phase 38: reads a .tsx file's text for the two form rules lib/forms-guard.test.ts holds every
 * file to (and tests on small made-up files, so the reading itself can't quietly break):
 *
 * 1. A server action's submit button is busy-aware: React sends every submit, so a double tap
 *    would run the action twice. SubmitButton / ConfirmSubmit (components/submit.tsx), or a
 *    button whose own `disabled` reads a pending flag. Plain buttons are fine in forms that post
 *    to a URL (a download, a GET search), which the browser handles itself.
 * 2. A destructive action asks first: ConfirmSubmit, ConfirmButton or RemoveAndMove in its form,
 *    a component that asks before running it, or ConfirmAction / window.confirm right before a
 *    handler calls it.
 *
 * Regexes over source, not a parser: good enough for this codebase's JSX, and the tests below
 * pin down what they catch.
 */

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** Whether `index` falls inside an import statement (a multi-line one too). */
function inImport(text: string, index: number): boolean {
  return [...text.matchAll(/^import\b[\s\S]*?from\s+["'][^"']+["'];?/gm)].some((m) => index >= m.index && index < m.index + m[0].length);
}

/** A JSX opening tag from its `<` to its closing `>`, skipping `>` inside `{…}` (arrow functions). */
function openingTag(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** The JSX element whose opening tag contains `index`: its name and where it starts. */
function enclosingTag(text: string, index: number): { name: string; start: number } | null {
  const last = [...text.slice(0, index).matchAll(/<([A-Za-z][A-Za-z0-9.]*)\b/g)].at(-1);
  return last ? { name: last[1], start: last.index } : null;
}

/** The <form>, <Form> or <ActionForm> element `index` sits inside, from its opening tag to its close. */
function enclosingForm(text: string, index: number): string | null {
  const open = [...text.slice(0, index).matchAll(/<(form|Form|ActionForm)\b/g)].at(-1);
  if (!open) return null;
  const close = text.indexOf(`</${open[1]}>`, open.index);
  if (close !== -1 && close < index) return null;
  return text.slice(open.index, close === -1 ? undefined : close);
}

/** A form that posts to a URL (route handler or GET search) rather than to a server action. */
const postsToUrl = (form: string) => /\baction=(?:"\/|\{`\/)/.test(openingTag(form, 0));

/** Rule 1: the lines of plain submit buttons in server-action forms ("file:line"). */
export function plainSubmits(file: string, text: string): string[] {
  return [...text.matchAll(/<button\b/g)].flatMap((m) => {
    const tag = openingTag(text, m.index);
    const type = tag.match(/\btype=(?:"(\w+)"|'(\w+)'|\{["'](\w+)["']\})/);
    const kind = type ? (type[1] ?? type[2] ?? type[3]) : "submit"; // HTML's default
    if (kind !== "submit") return [];
    if (/\bdisabled=\{[^}]*\b(pending|isPending|busy|saving)\b/.test(tag)) return [];
    const form = enclosingForm(text, m.index);
    if (!form || postsToUrl(form)) return [];
    return [`${file}:${lineOf(text, m.index)}`];
  });
}

const ASKS_IN_FORM = /<(ConfirmSubmit|ConfirmButton|RemoveAndMove)\b|confirm\(/;
const ASKS_IN_HANDLER = /<ConfirmAction\b|confirm\(/;
// Components that take the action as a prop and ask before running it.
const ASKING_COMPONENTS: Record<string, (tag: string) => boolean> = {
  RemoveAndMove: () => true,
  // Phase 40.2c: asks with ConfirmSubmit, then shows the reset's link once.
  ResetPasskeys: () => true,
  SmallActionButton: (tag) => /\bconfirmText=/.test(tag),
};

/** The names of destructive server actions a `"use server"` file exports. */
export function destructiveActions(text: string): string[] {
  if (!/^["']use server["']/m.test(text)) return [];
  const verb = "(?:delete|remove|veto|disconnect|forget|clear|unlink|leave|reset|revoke)[A-Za-z]*";
  return [...text.matchAll(new RegExp(`export (?:async function (${verb})|const (${verb})\\s*=\\s*async)`, "g"))].map((m) => m[1] ?? m[2]);
}

/** Rule 2: where a file runs one of `names` without asking first ("file:line name"). */
export function unaskedUses(file: string, text: string, names: string[]): string[] {
  return names.flatMap((name) =>
    // A use is a call, a .bind or a `{name}` prop; not prose like yes="Yes, disconnect".
    [...text.matchAll(new RegExp(`\\b${name}\\b(?=\\s*(?:\\(|\\.bind\\b|\\}))`, "g"))]
      .filter((m) => !inImport(text, m.index))
      .flatMap((m) => {
        const where = `${file}:${lineOf(text, m.index)} ${name}`;
        const tag = enclosingTag(text, m.index);
        if (tag && /^(form|Form|ActionForm)$/.test(tag.name) && openingTag(text, tag.start).length > m.index - tag.start) {
          return ASKS_IN_FORM.test(enclosingForm(text, m.index) ?? "") ? [] : [where];
        }
        if (tag && tag.name in ASKING_COMPONENTS && openingTag(text, tag.start).length > m.index - tag.start) {
          return ASKING_COMPONENTS[tag.name](openingTag(text, tag.start)) ? [] : [where];
        }
        // Called from a handler: the asking has to be right there, in the few lines above.
        const lead = text.slice(0, m.index).split("\n").slice(-12).join("\n");
        return ASKS_IN_HANDLER.test(lead) ? [] : [where];
      }),
  );
}
