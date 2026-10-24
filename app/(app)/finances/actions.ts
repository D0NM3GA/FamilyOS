"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { eligibleMemberWhere, moneyViewer, requireJar } from "@/lib/finance/access";
import { claimSetupToken, SimpleFinError } from "@/lib/finance/simplefin";
import { verifyKey, PrivacyError } from "@/lib/finance/privacy";
import { checkStatement as checkStatementFile, importStatementFile, removeImport, type StatementCheck } from "@/lib/finance/statement-import";
import { resolveIssue, saveConnection } from "@/lib/finance/sync";
import { scheduleJarSync } from "@/lib/finance/schedule";
import { organizeJar } from "@/lib/finance/organize";
import { civilDate, giftGroup, isUnrevealed, parseGiftForm, spreadGiftMarks, visibleOrderWhere, visibleToWhere } from "@/lib/finance/gifts";
import { shiftMonth, todayCivil } from "@/lib/finance/budget";
import { scheduleOrderScan } from "@/lib/finance/order-mail/scan";
import { logJarEvent, merchantLabel } from "@/lib/finance/history";
import { matchOrder, RETAILER_NAME } from "@/lib/finance/order-mail/orders";
import { fingerprint } from "@/lib/crypto";
import { sendJarChatTest } from "@/lib/finance/alerts";
import { chooseJarChat } from "@/lib/teams/jar-chat";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { captureError } from "@/lib/observability";
import { decimalToCents } from "@/lib/money";
import { MAX_MANUAL_BILLS, anchorForEdit, parseManualBillForm } from "@/lib/finance/manual-bills";
import * as holdings from "@/lib/finance/holdings";

/**
 * Phase 25: money jars. Every action re-checks the jar through requireJar (members only,
 * own Microsoft sign-in); ids from the browser are never trusted on their own. Secrets
 * (setup tokens, API keys) are never echoed back, logged or kept in form state.
 */

const MAX_JARS = 20;
const MAX_FILE = 3 * 1024 * 1024;

export type FormState = { error?: string; ok?: string };

const nameSchema = z.string().trim().min(1, "Give it a name.").max(60);
const emojiSchema = z.string().trim().max(8).optional();

const jarPath = (jarId: string) => `/finances/${jarId}`;

export async function createJar(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await moneyViewer();
  if (!viewer) return { error: "Money opens only for grown-ups using their own Microsoft sign-in." };
  const name = nameSchema.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0]?.message };
  const emoji = emojiSchema.safeParse(formData.get("emoji") ?? undefined);
  if ((await prisma.moneyJar.count({ where: { householdId: viewer.householdId } })) >= MAX_JARS) return { error: "That's a lot of jars already." };
  const jar = await prisma.moneyJar.create({
    data: { householdId: viewer.householdId, name: name.data, emoji: emoji.success ? emoji.data || null : null, members: { create: { personId: viewer.id } } },
    select: { id: true },
  });
  redirect(`${jarPath(jar.id)}/settings`);
}

export async function renameJar(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const name = nameSchema.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0]?.message };
  const emoji = emojiSchema.safeParse(formData.get("emoji") ?? undefined);
  await prisma.moneyJar.update({ where: { id: jar.id }, data: { name: name.data, emoji: emoji.success ? emoji.data || null : null } });
  if (name.data !== jar.name) await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "RENAMED", data: { name: name.data } });
  revalidatePath(jarPath(jar.id));
  return { ok: "Saved." };
}

export async function addMember(jarId: string, formData: FormData) {
  const { jar, viewer } = await requireJar(jarId);
  const personId = String(formData.get("personId") ?? "");
  const person = await prisma.person.findFirst({ where: { id: personId, ...eligibleMemberWhere(viewer.householdId) }, select: { id: true, firstName: true } });
  if (person) {
    const already = await prisma.moneyJarMember.findUnique({ where: { jarId_personId: { jarId: jar.id, personId: person.id } } });
    await prisma.moneyJarMember.upsert({ where: { jarId_personId: { jarId: jar.id, personId: person.id } }, create: { jarId: jar.id, personId: person.id }, update: {} });
    if (!already) await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "MEMBER_ADDED", data: { name: person.firstName.slice(0, 60) } });
  }
  revalidatePath(`${jarPath(jar.id)}/settings`);
}

/**
 * Removes a member (or yourself: leaving). A jar always keeps someone who can open it: the
 * check and the delete share a serializable transaction, so two people leaving at once
 * can't both succeed.
 */
export async function removeMember(jarId: string, personId: string): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const removed = await prisma.$transaction(
    async (tx) => {
      const stillAble = await tx.moneyJarMember.count({
        where: { jarId: jar.id, personId: { not: personId }, person: eligibleMemberWhere(viewer.householdId) },
      });
      if (stillAble === 0) return null;
      await tx.moneyJarMember.deleteMany({ where: { jarId: jar.id, personId } });
      // Phase 29: their order emails stop coming into a jar they're no longer in (the orders
      // already read stay: they're the jar's).
      await tx.mailOrderScan.updateMany({ where: { personId, jarId: jar.id }, data: { jarId: null, enabled: false } });
      const gone = await tx.person.findUnique({ where: { id: personId }, select: { firstName: true } });
      return { name: (gone?.firstName ?? "someone").slice(0, 60) };
    },
    { isolationLevel: "Serializable" },
  );
  // Logged after the commit: a failed insert inside a Postgres transaction would abort it.
  if (removed) await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "MEMBER_REMOVED", data: { name: removed.name, left: personId === viewer.id } });
  if (!removed) return { error: "A jar needs at least one person who can open it. Add someone first, or delete the jar." };
  if (personId === viewer.id) redirect("/finances");
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "Removed." };
}

export async function deleteJar(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar } = await requireJar(jarId);
  if (String(formData.get("confirm") ?? "").trim() !== jar.name) return { error: `Type "${jar.name}" to delete this jar.` };
  await prisma.moneyJar.delete({ where: { id: jar.id } });
  redirect("/finances");
}

export async function connectSimpleFin(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const token = String(formData.get("token") ?? "").slice(0, 2048);
  let access: string;
  try {
    access = await claimSetupToken(token);
  } catch (err) {
    return { error: err instanceof SimpleFinError ? err.message : "Couldn't connect. Try again." };
  }
  try {
    await saveConnection(jar.id, "SIMPLEFIN", access, viewer.id);
  } catch {
    // The token is spent once claimed; saving failed after that.
    return { error: "Connected, but couldn't save it. That setup token is now used: make a new one at SimpleFIN and try again." };
  }
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "CONNECTED", data: { provider: "SIMPLEFIN" } });
  await scheduleJarSync(jar.id, { force: true });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "Bank feed connected. The first sync is running; it can take a minute." };
}

export async function connectPrivacy(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const key = String(formData.get("key") ?? "").trim().slice(0, 200);
  if (!/^[A-Za-z0-9-]{16,200}$/.test(key)) return { error: "That doesn't look like a Privacy.com API key." };
  // Phase 30: the same Privacy.com account in two of your jars would count every charge twice.
  // Only jars you're in are checked, so another person's private jar stays invisible.
  const twin = await prisma.jarConnection.findFirst({
    where: { provider: "PRIVACY", fingerprint: fingerprint("privacy", key), jarId: { not: jar.id }, jar: { householdId: viewer.householdId, members: { some: { personId: viewer.id } } } },
    select: { jar: { select: { name: true } } },
  });
  if (twin) return { error: `That Privacy.com account is already in ${twin.jar.name}. Open that jar instead.` };
  try {
    await verifyKey(key);
  } catch (err) {
    return { error: err instanceof PrivacyError ? err.message : "Couldn't check that key. Try again." };
  }
  await saveConnection(jar.id, "PRIVACY", key, viewer.id);
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "CONNECTED", data: { provider: "PRIVACY" } });
  await scheduleJarSync(jar.id, { force: true });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "Privacy.com connected." };
}

export async function disconnect(jarId: string, provider: "SIMPLEFIN" | "PRIVACY") {
  const { jar, viewer } = await requireJar(jarId);
  if (provider !== "SIMPLEFIN" && provider !== "PRIVACY") return;
  const conn = await prisma.jarConnection.findUnique({ where: { jarId_provider: { jarId: jar.id, provider } }, select: { id: true } });
  if (!conn) return;
  await prisma.$transaction([
    prisma.reconcileIssue.deleteMany({ where: { jarId: jar.id, key: `sync:${conn.id}` } }),
    prisma.jarConnection.delete({ where: { id: conn.id } }),
  ]);
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "DISCONNECTED", data: { provider } });
  revalidatePath(jarPath(jar.id), "layout");
}

export async function syncNow(jarId: string): Promise<FormState> {
  const { jar } = await requireJar(jarId);
  const started = await scheduleJarSync(jar.id, { force: true });
  revalidatePath(jarPath(jar.id), "layout");
  if (started) return { ok: "Syncing… refresh in a minute." };
  const failed = await prisma.jarConnection.count({ where: { jarId: jar.id, lastError: { not: null } } });
  return { ok: failed ? "The last try failed; it'll retry within the hour." : "Synced within the last hour (the bank feed allows about one sync an hour)." };
}

/** The file from a statement form: present, not empty, not too big. */
async function statementBytes(formData: FormData): Promise<Uint8Array | string> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return "Pick a statement file (OFX, QFX or CSV).";
  if (file.size > MAX_FILE) return "That file is too big (3 MB max).";
  return new Uint8Array(await file.arrayBuffer());
}

/** The choices the check step sent back (JSON), or nothing. */
function sentChoices(formData: FormData): unknown {
  try {
    const raw = formData.get("choices");
    return typeof raw === "string" && raw.length < 2_000 ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Phase 52: "Check it": what the app understood of a statement file, on a few rows (an OFX or QFX
 * only says how many rows it has). Nothing is saved. Any jar member, like importing.
 */
export async function checkStatement(jarId: string, formData: FormData): Promise<StatementCheck> {
  const { jar } = await requireJar(jarId);
  const bytes = await statementBytes(formData);
  if (typeof bytes === "string") return { kind: "error", error: bytes };
  const accountId = String(formData.get("accountId") ?? "");
  const account = accountId ? await prisma.finAccount.findFirst({ where: { id: accountId, jarId: jar.id }, select: { id: true } }) : null;
  return checkStatementFile(jar.householdId, account?.id ?? null, bytes, sentChoices(formData));
}

/** Phase 25, Phase 52: imports the checked file (a CSV with the confirmed choices) into an account. */
export async function importStatement(jarId: string, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const bytes = await statementBytes(formData);
  if (typeof bytes === "string") return { error: bytes };

  let accountId = String(formData.get("accountId") ?? "");
  if (accountId) {
    const account = await prisma.finAccount.findFirst({ where: { id: accountId, jarId: jar.id }, select: { id: true } });
    if (!account) return { error: "Pick one of this jar's accounts." };
  } else {
    const name = nameSchema.safeParse(formData.get("newAccount"));
    if (!name.success) return { error: "Pick an account, or name a new one." };
    accountId = (await prisma.finAccount.create({ data: { jarId: jar.id, source: "MANUAL", externalId: randomUUID(), name: name.data }, select: { id: true } })).id;
  }
  const outcome = await importStatementFile(jar, accountId, viewer.id, bytes, sentChoices(formData));
  if (!outcome.ok) return { error: outcome.error };
  const { added, already, skipped } = outcome;
  if (added > 0) {
    const account = await prisma.finAccount.findUnique({ where: { id: accountId }, select: { name: true } });
    await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "IMPORTED", data: { count: added, account: (account?.name ?? "an account").slice(0, 60) } });
  }
  revalidatePath(jarPath(jar.id), "layout");
  const skippedText = skipped ? `; ${skipped} row${skipped === 1 ? "" : "s"} couldn't be read` : "";
  return { ok: `Added ${added} transaction${added === 1 ? "" : "s"}${already ? `; ${already} were already here` : ""}${skippedText}.` };
}

/** Phase 52: "Remove this import": every row one statement file brought. Any jar member, asked first. */
export async function removeStatementImport(jarId: string, importId: string): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const removed = await removeImport(jar.id, String(importId).slice(0, 64));
  if (removed == null) return { error: "That import was already removed." };
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "IMPORT_REMOVED", data: { count: removed } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: `Removed ${removed} transaction${removed === 1 ? "" : "s"}.` };
}

export async function answerIssue(jarId: string, issueId: string, answer: "SAME" | "DIFFERENT" | "DISMISSED") {
  const { jar } = await requireJar(jarId);
  if (!["SAME", "DIFFERENT", "DISMISSED"].includes(answer)) return;
  await resolveIssue(jar.id, String(issueId).slice(0, 64), answer);
  revalidatePath(jarPath(jar.id));
  revalidatePath(`${jarPath(jar.id)}/review`);
}

// ---- Phase 26: categories, budget, bills, grocery trips ---------------------------------

const idSchema = z.string().min(1).max(64);
const setCategorySchema = z.object({ txnId: idSchema, categoryId: z.union([z.literal(""), idSchema]), scope: z.enum(["one", "always"]) });

/**
 * Sets one row's category. "always" also teaches the merchant (CategoryRule) and re-runs the
 * tidy pass, which applies it to past and future rows from that merchant that a person
 * hasn't set by hand. "one" touches only this row. Called from the row's panel, which shows
 * the answer (an error keeps the panel open).
 */
export async function setCategory(jarId: string, rawTxnId: string, rawCategoryId: string, rawScope: "one" | "always"): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const input = setCategorySchema.safeParse({ txnId: rawTxnId, categoryId: rawCategoryId, scope: rawScope });
  if (!input.success) return { error: "That didn't look right. Reload and try again." };
  const { txnId, categoryId, scope } = input.data;
  const [txn, category] = await Promise.all([
    prisma.finTransaction.findFirst({ where: { id: txnId, jarId: jar.id, ...visibleToWhere(viewer.id, todayCivil()) }, select: { id: true, merchantKey: true } }),
    categoryId ? prisma.finCategory.findFirst({ where: { id: categoryId, jarId: jar.id }, select: { id: true, name: true } }) : null,
  ]);
  if (!txn) return { error: "That charge isn't here anymore. Reload to see the latest." };
  if (categoryId && !category) return { error: "That category isn't in this jar anymore. Reload and pick again." };
  // "No category" is a person's answer too (PERSON with no category), so the tidy pass leaves it.
  await prisma.finTransaction.update({ where: { id: txn.id }, data: { categoryId: category?.id ?? null, categorySource: "PERSON" } });
  if (scope === "always" && category && txn.merchantKey && txn.merchantKey !== "-") {
    await prisma.categoryRule.upsert({
      where: { jarId_key: { jarId: jar.id, key: txn.merchantKey } },
      create: { jarId: jar.id, key: txn.merchantKey, categoryId: category.id },
      update: { categoryId: category.id },
    });
    await organizeJar(jar.id);
  }
  const always = scope === "always" && Boolean(category) && Boolean(txn.merchantKey) && txn.merchantKey !== "-";
  await logJarEvent(prisma, {
    jarId: jar.id,
    actorId: viewer.id,
    kind: "CATEGORY_SET",
    txnId: txn.id,
    data: { category: category?.name.slice(0, 60) ?? null, always, key: txn.merchantKey.slice(0, 160), label: merchantLabel(txn.merchantKey) },
  });
  revalidatePath(jarPath(jar.id), "layout");
  const name = category?.name ?? "no category";
  return { ok: always ? `Every ${merchantLabel(txn.merchantKey)} charge is ${name} now.` : `Saved: ${name}.` };
}

/** Stops an "always for <merchant>" rule; rows it set go back to being guessed. */
export async function forgetRule(jarId: string, key: string): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const k = z.string().min(1).max(120).safeParse(key);
  if (!k.success) return { error: "That didn't look right. Reload and try again." };
  const { count } = await prisma.categoryRule.deleteMany({ where: { jarId: jar.id, key: k.data } });
  if (count) await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "RULE_FORGOTTEN", data: { key: k.data, label: merchantLabel(k.data) } });
  await organizeJar(jar.id);
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: `${merchantLabel(k.data)} is guessed again.` };
}

const budgetSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[$,]/g, ""))
  .pipe(z.union([z.literal(""), z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, "Use a dollar amount, like 450 or 450.00.")]));

export async function setBudget(jarId: string, categoryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const parsed = budgetSchema.safeParse(String(formData.get("amount") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Use a dollar amount." };
  const raw = parsed.data === "" ? null : decimalToCents(parsed.data);
  const cents = raw ? raw : null; // 0 means no budget
  // Phase 31: saving up runs on the monthly budget, so taking the budget off ends it (and its goal).
  const data = cents == null ? { budgetCents: null, rollover: false, rolloverFrom: null, goalCents: null, goalMonth: null } : { budgetCents: cents };
  const { count } = await prisma.finCategory.updateMany({ where: { id: String(categoryId), jarId: jar.id, kind: "SPEND" }, data });
  if (!count) return { error: "That category isn't in this jar." };
  const cat = await prisma.finCategory.findUnique({ where: { id: String(categoryId) }, select: { name: true } });
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "BUDGET_SET", data: { category: (cat?.name ?? "a category").slice(0, 60), cents } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: cents == null ? "No budget." : "Saved." };
}

/** A category this jar can budget: SPEND only. */
async function spendCategory(jarId: string, categoryId: string) {
  return prisma.finCategory.findFirst({
    where: { id: String(categoryId), jarId, kind: "SPEND" },
    select: { id: true, name: true, budgetCents: true, rollover: true, rolloverFrom: true },
  });
}

/**
 * Phase 31: "roll leftovers into next month". Turning it on starts the carry this month;
 * turning it off forgets the carry and the goal (turning it on again starts from zero).
 */
export async function setRollover(jarId: string, categoryId: string, on: boolean): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  on = on === true;
  const cat = await spendCategory(jar.id, categoryId);
  if (!cat) return { error: "That category isn't in this jar." };
  if (on && cat.budgetCents == null) return { error: "Set a monthly budget first: that's what goes in each month." };
  if (Boolean(on) === cat.rollover) return { ok: on ? "Already saving up." : "Already off." };
  await prisma.finCategory.update({
    where: { id: cat.id },
    data: on ? { rollover: true, rolloverFrom: todayCivil().slice(0, 7) } : { rollover: false, rolloverFrom: null, goalCents: null, goalMonth: null },
  });
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "ROLLOVER_SET", data: { category: cat.name.slice(0, 60), on: Boolean(on) } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: on ? "🐷 Leftovers roll into next month now." : "Back to a plain monthly budget." };
}

const goalMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the month you need it by.");

/** Phase 31: "need $X by <month>". Setting one turns rollover on; an empty amount takes it off. */
export async function setGoal(jarId: string, categoryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const cat = await spendCategory(jar.id, categoryId);
  if (!cat) return { error: "That category isn't in this jar." };
  const amount = budgetSchema.safeParse(String(formData.get("goal") ?? ""));
  if (!amount.success) return { error: amount.error.issues[0]?.message ?? "Use a dollar amount." };
  const cents = amount.data === "" ? null : decimalToCents(amount.data) || null;
  if (cents == null) {
    await prisma.finCategory.update({ where: { id: cat.id }, data: { goalCents: null, goalMonth: null } });
    await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "GOAL_SET", data: { category: cat.name.slice(0, 60), cents: null, month: null } });
    revalidatePath(jarPath(jar.id), "layout");
    return { ok: "Goal off. Leftovers still roll over." };
  }
  if (cat.budgetCents == null) return { error: "Set a monthly budget first: that's what goes in each month." };
  const month = goalMonthSchema.safeParse(String(formData.get("by") ?? ""));
  if (!month.success) return { error: month.error.issues[0]?.message ?? "Pick the month you need it by." };
  const current = todayCivil().slice(0, 7);
  if (month.data < current) return { error: "Pick this month or later." };
  if (month.data > shiftMonth(current, 60)) return { error: "Pick a month within five years." };
  await prisma.finCategory.update({
    where: { id: cat.id },
    data: { goalCents: cents, goalMonth: month.data, rollover: true, rolloverFrom: cat.rolloverFrom ?? current },
  });
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "GOAL_SET", data: { category: cat.name.slice(0, 60), cents, month: month.data } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "🎯 Goal set." };
}

/** "Still using this?" and "Not a bill" answers on the Bills page. CLEAR undoes one. */
export async function markRecurring(jarId: string, key: string, status: "KEEP" | "CANCEL" | "HIDDEN" | "CLEAR") {
  const { jar, viewer } = await requireJar(jarId);
  const k = String(key).slice(0, 120);
  if (!k) return;
  if (status === "CLEAR") await prisma.recurringMark.deleteMany({ where: { jarId: jar.id, key: k } });
  else if (["KEEP", "CANCEL", "HIDDEN"].includes(status)) {
    await prisma.recurringMark.upsert({
      where: { jarId_key: { jarId: jar.id, key: k } },
      create: { jarId: jar.id, key: k, status },
      update: { status, reviewedAt: new Date() },
    });
  } else return;
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "BILL_ANSWERED", data: { key: k, label: merchantLabel(k), status } });
  revalidatePath(`${jarPath(jar.id)}/bills`);
}

// ---- Bills added by hand (lib/finance/manual-bills.ts) ------------------------------------

/** "+ Add a bill": school fees, car registration, a bill paid by check. Anyone in the jar. */
export async function addManualBill(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const parsed = parseManualBillForm(formData, todayCivil());
  if (!parsed.ok) return { error: parsed.error };
  if ((await prisma.manualBill.count({ where: { jarId: jar.id } })) >= MAX_MANUAL_BILLS) return { error: "That's a lot of bills already. Remove one you don't need first." };
  const b = parsed.bill;
  await prisma.manualBill.create({ data: { jarId: jar.id, name: b.name, amountCents: b.amountCents, cadence: b.cadence, nextDue: civilDate(b.nextDue), matchKey: b.matchKey, createdById: viewer.id } });
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "BILL_ADDED", data: { name: b.name, cents: b.amountCents, cadence: b.cadence } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: `✍️ Added ${b.name}.` };
}

export async function updateManualBill(jarId: string, billId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const id = idSchema.safeParse(billId);
  if (!id.success) return { error: "That bill isn't here anymore." };
  const stored = await prisma.manualBill.findFirst({ where: { id: id.data, jarId: jar.id }, select: { cadence: true, nextDue: true } });
  if (!stored) return { error: "That bill isn't here anymore." };
  const storedDay = stored.nextDue.toISOString().slice(0, 10);
  const parsed = parseManualBillForm(formData, todayCivil(), { keepDay: storedDay });
  if (!parsed.ok) return { error: parsed.error };
  const b = parsed.bill;
  const nextDue = anchorForEdit({ cadence: stored.cadence, nextDue: storedDay }, b);
  const { count } = await prisma.manualBill.updateMany({
    where: { id: id.data, jarId: jar.id },
    data: { name: b.name, amountCents: b.amountCents, cadence: b.cadence, nextDue: civilDate(nextDue), matchKey: b.matchKey },
  });
  if (!count) return { error: "That bill isn't here anymore." };
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "BILL_CHANGED", data: { name: b.name } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "Saved." };
}

export async function removeManualBill(jarId: string, billId: string): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const id = idSchema.safeParse(billId);
  if (!id.success) return { error: "That bill isn't here anymore." };
  const bill = await prisma.manualBill.findFirst({ where: { id: id.data, jarId: jar.id }, select: { id: true, name: true } });
  if (!bill) return { error: "That bill isn't here anymore." };
  await prisma.manualBill.deleteMany({ where: { id: bill.id, jarId: jar.id } });
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "BILL_REMOVED", data: { name: bill.name.slice(0, 60) } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "Removed." };
}

// ---- Net worth: things owned or owed, valued by hand (lib/finance/holdings.ts) -----------------

/** "+ Add something": the house, a car, a loan the bank feed can't see. Anyone in the jar. */
export async function addHolding(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const parsed = holdings.parseHoldingForm(formData, todayCivil());
  if (!parsed.ok) return { error: parsed.error };
  const done = await holdings.addHolding(jar.id, parsed.holding);
  if (!done.ok) return { error: done.error };
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "HOLDING_ADDED", data: { name: done.name, kind: done.kind } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: `Added ${done.name}.` };
}

/** A new value on a day; the same day again replaces it. */
export async function valueHolding(jarId: string, holdingId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const id = idSchema.safeParse(holdingId);
  if (!id.success) return { error: "That isn't here anymore." };
  const parsed = holdings.parseValueForm(formData, todayCivil());
  if (!parsed.ok) return { error: parsed.error };
  const done = await holdings.setHoldingValue(jar.id, id.data, parsed.value);
  if (!done.ok) return { error: done.error };
  await logJarEvent(prisma, {
    jarId: jar.id,
    actorId: viewer.id,
    kind: "HOLDING_VALUED",
    data: { name: done.name, kind: done.kind, cents: parsed.value.valueCents, on: parsed.value.valuedOn },
  });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "Saved." };
}

/** Takes one dated value off (a typo); the last one stays. */
export async function removeHoldingValue(jarId: string, holdingId: string, valuedOn: string): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const id = idSchema.safeParse(holdingId);
  if (!id.success) return { error: "That isn't here anymore." };
  const done = await holdings.removeHoldingValue(jar.id, id.data, valuedOn);
  if (!done.ok) return { error: done.error };
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "HOLDING_VALUED", data: { name: done.name, kind: done.kind, cents: null, on: valuedOn } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "Taken off." };
}

export async function removeHolding(jarId: string, holdingId: string): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const id = idSchema.safeParse(holdingId);
  if (!id.success) return { error: "That isn't here anymore." };
  const done = await holdings.removeHolding(jar.id, id.data);
  if (!done.ok) return { error: done.error };
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "HOLDING_REMOVED", data: { name: done.name } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "Removed." };
}

/** Links a charge to a grocery trip a member of this jar saved. */
export async function linkTrip(jarId: string, txnId: string, formData: FormData) {
  const { jar, viewer } = await requireJar(jarId);
  const purchaseId = String(formData.get("purchaseId") ?? "");
  const members = await prisma.moneyJarMember.findMany({ where: { jarId: jar.id }, select: { personId: true } });
  const trip = await prisma.purchase.findFirst({
    where: { id: purchaseId, householdId: viewer.householdId, purchasedById: { in: members.map((m) => m.personId) } },
    select: { id: true },
  });
  if (!trip) return;
  const taken = await prisma.finTransaction.count({ where: { jarId: jar.id, state: "ACTIVE", purchaseId: trip.id, NOT: { id: String(txnId) } } });
  if (taken) return;
  const { count } = await prisma.finTransaction.updateMany({
    where: { id: String(txnId), jarId: jar.id, ...visibleToWhere(viewer.id, todayCivil()) },
    data: { purchaseId: trip.id, purchaseLinkedBy: "PERSON" },
  });
  if (count) await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "TRIP_LINKED", txnId: String(txnId), data: {} });
  revalidatePath(jarPath(jar.id), "layout");
}

export async function unlinkTrip(jarId: string, txnId: string) {
  const { jar, viewer } = await requireJar(jarId);
  // PERSON with no trip: an explicit "not this one", so the automatic pass won't re-link it.
  const { count } = await prisma.finTransaction.updateMany({
    where: { id: String(txnId), jarId: jar.id, ...visibleToWhere(viewer.id, todayCivil()) },
    data: { purchaseId: null, purchaseLinkedBy: "PERSON" },
  });
  if (count) await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "TRIP_UNLINKED", txnId: String(txnId), data: {} });
  revalidatePath(jarPath(jar.id), "layout");
}

// ---- Phase 27: surprises and money alerts -----------------------------------------------

/**
 * Marks a charge as a surprise for some of the jar's other members until a reveal day.
 * Only a row the viewer can see; a row someone else marked is theirs to change. The mark
 * covers the charge's other rows too (lib/finance/gifts.ts).
 */
export async function markGift(jarId: string, txnId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const today = todayCivil();
  const txn = await prisma.finTransaction.findFirst({
    where: { id: String(txnId), jarId: jar.id, state: "ACTIVE", ...visibleToWhere(viewer.id, today) },
    select: { id: true, giftById: true, giftHiddenFrom: true, giftRevealOn: true, giftCopiedFromId: true },
  });
  if (!txn) return { error: "That charge isn't here anymore." };
  if (isUnrevealed(txn, today) && txn.giftById !== viewer.id) return { error: "Someone else marked this one." };

  const others = await prisma.moneyJarMember.findMany({ where: { jarId: jar.id, personId: { not: viewer.id } }, select: { personId: true, person: { select: { firstName: true } } } });
  const form = parseGiftForm(formData, others.map((o) => o.personId), today);
  if ("error" in form) return form;
  const { hiddenFrom, revealOn } = form;

  const ids = txn.giftRevealOn ? await giftGroup(prisma, jar.id, txn) : [txn.id];
  await prisma.$transaction(async (tx) => {
    await tx.finTransaction.updateMany({
      where: { id: { in: ids }, jarId: jar.id },
      data: { giftById: viewer.id, giftHiddenFrom: hiddenFrom, giftRevealOn: civilDate(revealOn) },
    });
    // The order email on the charge goes with it, so it stays hidden if the match is ever let go.
    await tx.mailOrder.updateMany({
      where: { jarId: jar.id, matchedTxnId: { in: ids }, OR: [{ giftById: viewer.id }, { giftRevealOn: null }, { giftRevealOn: { lte: civilDate(today) } }] },
      data: { giftById: viewer.id, giftHiddenFrom: hiddenFrom, giftRevealOn: civilDate(revealOn) },
    });
    await spreadGiftMarks(tx, jar.id);
  });
  await logJarEvent(prisma, {
    jarId: jar.id,
    actorId: viewer.id,
    kind: "SURPRISE_MARKED",
    txnId: txn.id,
    data: { for: others.filter((o) => hiddenFrom.includes(o.personId)).map((o) => o.person.firstName.slice(0, 60)), until: revealOn },
  });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: "🤫 Shh. It's a surprise." };
}

/** The marker shows a surprise early (or takes the mark off): the whole group, now. */
export async function revealGift(jarId: string, txnId: string) {
  const { jar, viewer } = await requireJar(jarId);
  const txn = await prisma.finTransaction.findFirst({
    where: { id: String(txnId), jarId: jar.id, giftById: viewer.id },
    select: { id: true, giftById: true, giftHiddenFrom: true, giftRevealOn: true, giftCopiedFromId: true },
  });
  if (!txn) return;
  const ids = await giftGroup(prisma, jar.id, txn);
  await prisma.$transaction([
    prisma.finTransaction.updateMany({
      where: { id: { in: ids }, jarId: jar.id },
      data: { giftById: null, giftHiddenFrom: [], giftRevealOn: null, giftCopiedFromId: null },
    }),
    // And the order email on it, if this person marked that too.
    prisma.mailOrder.updateMany({ where: { jarId: jar.id, matchedTxnId: { in: ids }, giftById: viewer.id }, data: { giftById: null, giftHiddenFrom: [], giftRevealOn: null } }),
  ]);
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "SURPRISE_REVEALED", txnId: txn.id, data: {} });
  revalidatePath(jarPath(jar.id), "layout");
}

/**
 * An order email marked 🎁 before its charge arrives (owner's call, 2026-10-08): hidden from the
 * chosen members until the reveal day, and the charge it's matched to later takes the same
 * mark (lib/finance/order-mail/orders.ts carryOrderGift). Only an unmatched order the viewer
 * can see; once it's on a charge, mark the charge. No history line: jar history doesn't
 * filter orders, so one would show the hidden-from person that there's a surprise order.
 */
export async function markOrderGift(jarId: string, orderId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const today = todayCivil();
  const order = await prisma.mailOrder.findFirst({
    where: { id: String(orderId), jarId: jar.id, matchedTxnId: null, ...visibleOrderWhere(viewer.id, today) },
    select: { id: true, giftById: true, giftHiddenFrom: true, giftRevealOn: true },
  });
  if (!order) return { error: "That order isn't waiting here anymore." };
  if (isUnrevealed(order, today) && order.giftById !== viewer.id) return { error: "Someone else marked this one." };
  const others = await prisma.moneyJarMember.findMany({ where: { jarId: jar.id, personId: { not: viewer.id } }, select: { personId: true } });
  const form = parseGiftForm(formData, others.map((o) => o.personId), today);
  if ("error" in form) return form;
  const { count } = await prisma.mailOrder.updateMany({
    where: { id: order.id, jarId: jar.id, matchedTxnId: null },
    data: { giftById: viewer.id, giftHiddenFrom: form.hiddenFrom, giftRevealOn: civilDate(form.revealOn) },
  });
  revalidatePath(jarPath(jar.id), "layout");
  // It found its charge in the meantime: that's what to mark now.
  if (!count) return { error: "That order just found its charge. Mark the charge instead." };
  return { ok: "🤫 Shh. It's a surprise." };
}

/**
 * The marker shows an order early (or takes the mark off). A charge it already went onto keeps
 * its mark: show the charge to show both (revealGift clears the order with it).
 */
export async function revealOrderGift(jarId: string, orderId: string) {
  const { jar, viewer } = await requireJar(jarId);
  await prisma.mailOrder.updateMany({
    where: { id: String(orderId), jarId: jar.id, giftById: viewer.id },
    data: { giftById: null, giftHiddenFrom: [], giftRevealOn: null },
  });
  revalidatePath(jarPath(jar.id), "layout");
}

/** "Alerts for me": each member's own switches for this jar. */
export async function setMyAlerts(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  await prisma.moneyJarMember.update({
    where: { jarId_personId: { jarId: jar.id, personId: viewer.id } },
    data: {
      alertBills: formData.get("bills") === "on",
      alertSync: formData.get("sync") === "on",
      alertOverBudget: formData.get("overBudget") === "on",
      alertLowBalance: formData.get("lowBalance") === "on",
    },
  });
  revalidatePath(`${jarPath(jar.id)}/settings`);
  return { ok: "Saved." };
}

// ---- Phase 32: Safe to spend ---------------------------------------------------------------

/** Which of the jar's bank-feed accounts are day-to-day spending money (checking). */
export async function setSpendingAccounts(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const picked = [...new Set(formData.getAll("account").map(String))].slice(0, 50);
  // Only this jar's bank-feed accounts: a statement account has no balance to count.
  const ids = (await prisma.finAccount.findMany({ where: { jarId: jar.id, source: "SIMPLEFIN", id: { in: picked } }, select: { id: true } })).map((a) => a.id);
  await prisma.$transaction([
    prisma.finAccount.updateMany({ where: { jarId: jar.id, id: { in: ids } }, data: { spending: true } }),
    prisma.finAccount.updateMany({ where: { jarId: jar.id, id: { notIn: ids } }, data: { spending: false } }),
  ]);
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "ACCOUNTS_SET", data: { count: ids.length } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: ids.length ? "Saved. Safe to spend is on the Bills tab." : "Saved. No spending accounts: Safe to spend is off." };
}

/** "Keep at least $X in checking": Safe to spend leaves it alone. Empty or 0 takes it off. */
export async function setCushion(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const parsed = budgetSchema.safeParse(String(formData.get("cushion") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Use a dollar amount." };
  const cents = parsed.data === "" ? null : decimalToCents(parsed.data) || null;
  await prisma.moneyJar.update({ where: { id: jar.id }, data: { cushionCents: cents } });
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "CUSHION_SET", data: { cents } });
  revalidatePath(jarPath(jar.id), "layout");
  return { ok: cents == null ? "No cushion." : "Saved." };
}

// ---- Phase 29: order emails ---------------------------------------------------------------

/**
 * "Read my order emails into this jar": the person's own mailbox, so only for themselves.
 * Turning it on here moves it from any other jar and starts over from 90 days back.
 */
export async function setOrderMail(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const on = formData.get("on") === "on";
  const current = await prisma.mailOrderScan.findUnique({ where: { personId: viewer.id }, select: { jarId: true } });
  const moving = current?.jarId !== jar.id;
  if (on) {
    await prisma.mailOrderScan.upsert({
      where: { personId: viewer.id },
      create: { personId: viewer.id, jarId: jar.id, enabled: true },
      update: { jarId: jar.id, enabled: true, ...(moving ? { cursor: null, lastScanAt: null, lastError: null, lastFound: 0, lastSkipped: 0 } : {}) },
    });
  } else if (!moving) {
    await prisma.mailOrderScan.update({ where: { personId: viewer.id }, data: { enabled: false } });
  }
  revalidatePath(`${jarPath(jar.id)}/settings`);
  return { ok: on ? "On. Your order emails will show up here after the next visit." : "Off." };
}

export async function scanOrdersNow(jarId: string): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const started = await scheduleOrderScan(viewer.id, jar.id, { force: true });
  revalidatePath(`${jarPath(jar.id)}/settings`);
  return { ok: started ? "Reading your order emails… refresh in a minute." : "Read in the last few minutes, or Microsoft isn't available right now." };
}

/** Links an order to a charge by hand (Amazon's split shipments, a missed match). Anyone in the jar. */
export async function linkOrder(jarId: string, orderId: string, formData: FormData) {
  const { jar, viewer } = await requireJar(jarId);
  const txnId = String(formData.get("txnId") ?? "");
  // A money-out row you can see that has no order yet.
  const txn = await prisma.finTransaction.findFirst({
    where: { id: txnId, jarId: jar.id, state: "ACTIVE", amountCents: { lt: 0 }, mailOrders: { none: {} }, ...visibleToWhere(viewer.id, todayCivil()) },
    select: { id: true },
  });
  if (!txn) return;
  const order = await prisma.mailOrder.findFirst({
    where: { id: String(orderId), jarId: jar.id, matchedTxnId: null, ...visibleOrderWhere(viewer.id, todayCivil()) },
    select: { id: true, retailer: true },
  });
  if (!order) return;
  // A 🎁 order hands its mark to the charge it's now on, in the same transaction.
  if (!(await matchOrder(prisma, jar.id, order.id, txn.id, "PERSON"))) return;
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "ORDER_LINKED", txnId: txn.id, data: { retailer: RETAILER_NAME[order.retailer] } });
  revalidatePath(jarPath(jar.id));
}

/**
 * "Not this charge": the order goes back to the unmatched list and isn't matched again by
 * itself. Only on a charge the viewer can see (so never a surprise that's for them).
 */
export async function unlinkOrder(jarId: string, orderId: string) {
  const { jar, viewer } = await requireJar(jarId);
  const order = await prisma.mailOrder.findFirst({
    where: { id: String(orderId), jarId: jar.id, matchedTxn: visibleToWhere(viewer.id, todayCivil()), ...visibleOrderWhere(viewer.id, todayCivil()) },
    select: { id: true, retailer: true, matchedTxnId: true },
  });
  if (!order) return;
  await prisma.mailOrder.updateMany({ where: { id: order.id, jarId: jar.id }, data: { matchedTxnId: null, matchedBy: "PERSON", matchedAt: null } });
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "ORDER_UNLINKED", txnId: order.matchedTxnId, data: { retailer: RETAILER_NAME[order.retailer] } });
  revalidatePath(jarPath(jar.id));
}

// ---- Phase 30: one Teams chat for the jar's alerts ---------------------------------------

/**
 * Phase 50: points the jar's money alerts at one of the member's own Teams group chats, picked
 * from their list (lib/teams/jar-chat.ts checks it against that list again), and says hello there.
 * Any member, on their own Microsoft sign-in.
 */
export async function setJarChat(jarId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const chatId = z.string().min(1).max(300).safeParse(formData.get("chat"));
  if (!chatId.success) return { error: "Choose a chat." };
  const chosen = await chooseJarChat(jar, chatId.data);
  if (!chosen.ok) return { error: chosen.error };
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "CHAT_SET", data: { on: true } });
  const hello = await sendJarChatTest(jar.id);
  revalidatePath(`${jarPath(jar.id)}/settings`);
  redirect(`${jarPath(jar.id)}/settings?chat=${hello ? "saved" : "hello"}`);
}

/** Back to each person's own Teams. Any member. */
export async function stopJarChat(jarId: string): Promise<FormState> {
  const { jar, viewer } = await requireJar(jarId);
  const { count } = await prisma.moneyJar.updateMany({ where: { id: jar.id, teamsChatId: { not: null } }, data: { teamsChatId: null, teamsChatName: null, teamsChatError: null } });
  if (count > 0) await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "CHAT_SET", data: { on: false } });
  revalidatePath(`${jarPath(jar.id)}/settings`);
  return { ok: "Alerts go to each person again." };
}

/**
 * Incremental consent for listing your own group chats (Chat.ReadBasic), asked for on this button
 * only, like the calendar's write access: Better Auth's link flow re-links the signed-in person's
 * own Microsoft account. Back on the jar's settings with the list open.
 */
export async function allowChatList(jarId: string): Promise<FormState> {
  const { jar } = await requireJar(jarId);
  let url: string;
  try {
    const result = await auth.api.linkSocialAccount({
      body: { provider: "microsoft", scopes: ["Chat.ReadBasic"], callbackURL: `${jarPath(jar.id)}/settings?pick=1`, errorCallbackURL: `${jarPath(jar.id)}/settings?grant=failed` },
      headers: await headers(),
    });
    url = result.url;
  } catch (err) {
    captureError(err);
    return { error: "Couldn't start the Microsoft sign-in. Try again." };
  }
  redirect(url);
}

export async function testJarChat(jarId: string): Promise<FormState> {
  const { jar } = await requireJar(jarId);
  const error = await sendJarChatTest(jar.id);
  revalidatePath(`${jarPath(jar.id)}/settings`);
  return error ? { ok: error } : { ok: "Sent. Teams took it; check the chat." };
}
