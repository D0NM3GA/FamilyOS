import { prisma } from "@/lib/prisma";
import type { ReminderKind } from "./plan";

/**
 * Phase 62: a grown-up's reminder settings (ReminderPrefs), read and saved for Settings → My
 * notifications. Each kind is on until switched off; only kinds whose app is on are listed (the
 * settings rule: lists show only what can be changed), and saving leaves the others as they were.
 */

export type ReminderApp = "meds" | "school" | "cars" | "chores";

export const REMINDER_KINDS: { kind: ReminderKind; label: string; app: ReminderApp | null; adminOnly?: boolean; optIn?: boolean }[] = [
  // Phase 68a: off until switched on (the owner's call).
  { kind: "REMINDER_DOSE_DUE", label: "A dose is due: your own, and the kids'", app: "meds", optIn: true },
  { kind: "REMINDER_DOSE", label: "A dose wasn't marked (comes through quiet hours)", app: "meds" },
  { kind: "REMINDER_MED_LOW", label: "A medicine is running low", app: "meds" },
  { kind: "REMINDER_SCHOOL", label: "A school form, fee or to-do is due today or tomorrow", app: "school" },
  // Phase 68b.
  { kind: "REMINDER_HOMEWORK", label: "A kid has homework or a test due tomorrow (from 3 pm)", app: "school" },
  { kind: "REMINDER_CHORES", label: "Kids still have chores open at 6 pm", app: "chores" },
  { kind: "REMINDER_DATE", label: "A birthday or anniversary is coming up this week", app: null },
  { kind: "REMINDER_CAR", label: "Car work is due within a week (paperwork within two), or overdue", app: "cars" },
  { kind: "REMINDER_RECALL", label: "A new safety recall is listed for one of the cars", app: "cars" },
  // Phase 67b: only admins get it, so only admins see the switch.
  { kind: "REMINDER_SYSTEM", label: "Something in the app stopped working: a background job, or the nightly backup", app: null, adminOnly: true },
];

/** The kinds to list, given which apps are on and whether the reader is an admin. */
export function listedKinds(isOn: (app: ReminderApp) => boolean, admin = false) {
  return REMINDER_KINDS.filter((k) => (k.app === null || isOn(k.app)) && (admin || !k.adminOnly));
}

/** The new `off` list: the listed kinds left unticked, plus what was off among the unlisted ones. */
export function nextOff(previousOff: string[], listed: ReminderKind[], ticked: Set<string>): string[] {
  const keptHidden = previousOff.filter((k) => !listed.includes(k as ReminderKind));
  return [...new Set([...keptHidden, ...listed.filter((k) => !ticked.has(k))])].sort();
}

/** Phase 68a: the new `optIn` list: listed opt-in kinds ticked, plus unlisted ones that were on. */
export function nextOptIn(previousOn: string[], listed: ReminderKind[], ticked: Set<string>): string[] {
  const keptHidden = previousOn.filter((k) => !listed.includes(k as ReminderKind));
  return [...new Set([...keptHidden, ...listed.filter((k) => ticked.has(k))])].sort();
}

/** Whether a kind is off for someone: an opt-in kind until it's in `optIn`, any other once it's in `off`. */
export function kindOff(kind: string, prefs: { off: string[]; optIn: string[] }): boolean {
  return OPT_IN.has(kind) ? !prefs.optIn.includes(kind) : prefs.off.includes(kind);
}

const OPT_IN = new Set<string>(REMINDER_KINDS.filter((k) => k.optIn).map((k) => k.kind));

export function readReminderPrefs(personId: string) {
  return prisma.reminderPrefs.findUnique({ where: { personId } });
}

export type ReminderPrefsInput = {
  off: string[];
  optIn?: string[];
  quietStart: number | null;
  quietEnd: number | null;
  teamsEnabled?: boolean;
  emailEnabled?: boolean;
  digestTeams?: boolean;
  digestEmail?: boolean;
};

export async function saveReminderPrefs(personId: string, input: ReminderPrefsInput) {
  const data = {
    off: input.off,
    ...(input.optIn === undefined ? {} : { optIn: input.optIn }),
    quietStart: input.quietStart,
    quietEnd: input.quietEnd,
    ...(input.teamsEnabled === undefined ? {} : { teamsEnabled: input.teamsEnabled }),
    ...(input.emailEnabled === undefined ? {} : { emailEnabled: input.emailEnabled }),
    ...(input.digestTeams === undefined ? {} : { digestTeams: input.digestTeams }),
    ...(input.digestEmail === undefined ? {} : { digestEmail: input.digestEmail }),
  };
  await prisma.reminderPrefs.upsert({ where: { personId }, create: { personId, ...data }, update: data });
}

/**
 * Which outside channels reminders can use for this person: email when the family has an alert
 * mailbox, Teams when the family app is published and they sign in with Microsoft. Only those
 * switches are offered.
 */
export async function reminderChannels(householdId: string, personId: string): Promise<{ email: boolean; teams: boolean }> {
  const [{ alertMailbox }, { familyTeamsAppId }] = await Promise.all([import("@/lib/alerts/email"), import("@/lib/teams/family-app")]);
  const [mailbox, teamsApp, microsoft] = await Promise.all([
    alertMailbox(householdId),
    familyTeamsAppId(householdId),
    prisma.person.findFirst({ where: { id: personId, authUser: { accounts: { some: { providerId: "microsoft" } } } }, select: { id: true } }),
  ]);
  return { email: mailbox !== null, teams: teamsApp !== null && microsoft !== null };
}
