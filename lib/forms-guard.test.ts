import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { destructiveActions, plainSubmits, unaskedUses } from "./forms-guard";

/**
 * Phase 38: every form in the app follows the two rules in lib/forms-guard.ts, read from the
 * source files themselves (like lib/app-guard.test.ts), so a form added later can't forget
 * them. The made-up files first pin down what the reading catches.
 */
const ROOT = path.resolve(__dirname, "..");

function filesUnder(dir: string, ext: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" || e.name === "node_modules" ? [] : filesUnder(p, ext);
    return e.name.endsWith(ext) ? [p] : [];
  });
}

const read = (file: string) => ({ file: path.relative(ROOT, file).split(path.sep).join("/"), text: fs.readFileSync(file, "utf8") });
const TSX = [...filesUnder(path.join(ROOT, "app"), ".tsx"), ...filesUnder(path.join(ROOT, "components"), ".tsx")].map(read);
const DESTRUCTIVE = [...new Set(filesUnder(path.join(ROOT, "app"), ".ts").map(read).flatMap(({ text }) => destructiveActions(text)))];

// Destructive actions that are fine in one tap, and why.
const ONE_TAP_OK: Record<string, string> = {
  unlinkTrip: "undone by linking the trip again",
  unlinkOrder: "undone by linking the charge again",
  deleteJar: "the form makes you type the jar's name",
  forgetRule: "picking Always again brings the rule back",
  deleteBucket: "only removes an empty shelf; one with rewards is refused",
  disconnectCalendar: "the form's checkbox must be ticked, and the action checks it",
  forgetCalendar: "the form's checkbox must be ticked, and the action checks it",
};

describe("reading the files (made-up examples)", () => {
  test("a plain submit button in a server action's form is caught, in every spelling", () => {
    const form = (button: string) => `<form action={save.bind(null, id)}>\n  ${button}\n</form>`;
    expect(plainSubmits("f", form(`<button type="submit">Save</button>`))).toEqual(["f:2"]);
    expect(plainSubmits("f", form(`<button type='submit'>Save</button>`))).toEqual(["f:2"]);
    expect(plainSubmits("f", form(`<button type={"submit"}>Save</button>`))).toEqual(["f:2"]);
    expect(plainSubmits("f", form(`<button onClick={() => a > b}>Save</button>`))).toEqual(["f:2"]); // no type: submit
  });

  test("busy-aware buttons, other buttons and URL forms pass", () => {
    const form = (button: string, action = "{save}") => `<form action=${action}>\n  ${button}\n</form>`;
    expect(plainSubmits("f", form(`<SubmitButton>Save</SubmitButton>`))).toEqual([]);
    expect(plainSubmits("f", form(`<button type="submit" disabled={pending}>Save</button>`))).toEqual([]);
    expect(plainSubmits("f", form(`<button type="button" onClick={go}>More</button>`))).toEqual([]);
    expect(plainSubmits("f", form(`<button type="submit">Download</button>`, `"/api/backup/download" method="post"`))).toEqual([]);
    expect(plainSubmits("f", form(`<button type="submit">Export</button>`, "{`/finances/${id}/export`}"))).toEqual([]);
    expect(plainSubmits("f", `<button onClick={go}>Outside any form</button>`)).toEqual([]);
  });

  test("finds destructive actions in server files only", () => {
    const server = `"use server";\nexport async function removeThing() {}\nexport const deleteOther = async () => {};\nexport async function saveThing() {}`;
    expect(destructiveActions(server)).toEqual(["removeThing", "deleteOther"]);
    expect(destructiveActions(server.replace(`"use server";`, ""))).toEqual([]);
  });

  test("a destructive action that doesn't ask is caught: in a form, as a prop, in a handler", () => {
    const names = ["removeThing"];
    expect(unaskedUses("f", `<form action={removeThing.bind(null, id)}>\n<SubmitButton>Remove</SubmitButton>\n</form>`, names)).toEqual(["f:1 removeThing"]);
    expect(unaskedUses("f", `<SmallActionButton action={removeThing.bind(null, id)} label="Remove" />`, names)).toEqual(["f:1 removeThing"]);
    expect(unaskedUses("f", `<button onClick={() => start(() => removeThing(id))}>Remove</button>`, names)).toEqual(["f:1 removeThing"]);
    // An ask that belongs to some other form doesn't count for a handler.
    expect(unaskedUses("f", `<ConfirmSubmit question="?" yes="Yes">Other</ConfirmSubmit>\n<button onClick={() => removeThing(id)}>Remove</button>`, names)).toEqual(["f:2 removeThing"]);
  });

  test("asking first passes, and prose or imports aren't uses", () => {
    const names = ["removeThing", "disconnect"];
    expect(unaskedUses("f", `<form action={removeThing.bind(null, id)}>\n<ConfirmSubmit question="Remove it?" yes="Remove">Remove</ConfirmSubmit>\n</form>`, names)).toEqual([]);
    expect(unaskedUses("f", `<SmallActionButton action={removeThing.bind(null, id)} confirmText="Sure?" />`, names)).toEqual([]);
    expect(unaskedUses("f", `<RemoveAndMove action={removeThing.bind(null, id)} question="?" />`, names)).toEqual([]);
    expect(unaskedUses("f", `<ConfirmAction question="Remove?" yes="Remove" pending={p}\n  onConfirm={() => run(() => removeThing(id))}>Remove</ConfirmAction>`, names)).toEqual([]);
    expect(unaskedUses("f", `onClick={() => { if (window.confirm("Remove?")) removeThing(id); }}`, names)).toEqual([]);
    expect(unaskedUses("f", `import { removeThing } from "./actions";\n<p yes="Yes, disconnect">x</p>`, names)).toEqual([]);
  });
});

describe("every form in the app", () => {
  test("finds the forms and actions (the walk itself works)", () => {
    expect(TSX.length).toBeGreaterThan(150);
    expect(TSX.filter(({ text }) => text.includes("<SubmitButton")).length).toBeGreaterThan(15);
    expect(DESTRUCTIVE.length).toBeGreaterThan(20);
  });

  test("no plain submit button in a server action's form", () => {
    expect(TSX.flatMap(({ file, text }) => plainSubmits(file, text))).toEqual([]);
  });

  test("every destructive action asks before it runs", () => {
    const names = DESTRUCTIVE.filter((name) => !(name in ONE_TAP_OK));
    expect(TSX.flatMap(({ file, text }) => unaskedUses(file, text, names))).toEqual([]);
  });

  test("the one-tap list only names real actions", () => {
    for (const name of Object.keys(ONE_TAP_OK)) expect(DESTRUCTIVE).toContain(name);
  });
});
