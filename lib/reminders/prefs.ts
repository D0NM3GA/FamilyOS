import { prisma } from "@/lib/prisma";
import type { ReminderKind } from "./plan";

/**
 * Phase 62: a grown-up's reminder settings (ReminderPrefs), read and saved for Settings → My
 * notifications. Each kind is on until switched off; only kinds whose app is on are listed (the
 * settings rule: lists show only what can be changed), and saving leaves the others as they were.
 */

export const REMINDER_KINDS: { kind: ReminderKind; label: string; app: "meds" | "school" | "cars" | null }[] = [
  { kind: "REMINDER_DOSE", label: "A dose wasn't marked (comes through quiet hours)", app: "meds" },
  { kind: "REMINDER_MED_LOW", label: "A medicine is running low", app: "meds" },
  { kind: "REMINDER_SCHOOL", label: "A school form, fee or to-do is due today or tomorrow", app: "school" },
  { kind: "REMINDER_DATE", label: "A birthday or anniversary is coming up this week", app: null },
  { kind: "REMINDER_CAR", label: "Car work is due within a week, or overdue", app: "cars" },
  { kind: "REMINDER_RECALL", label: "A new safety recall is listed for one of the cars", app: "cars" },
];

/** The kinds to list, given which apps are on. */
export function listedKinds(isOn: (app: "meds" | "school" | "cars") => boolean) {
  return REMINDER_KINDS.filter((k) => k.app === null || isOn(k.app));
}

/** The new `off` list: the listed kinds left unticked, plus what was off among the unlisted ones. */
export function nextOff(previousOff: string[], listed: ReminderKind[], ticked: Set<string>): string[] {
  const keptHidden = previousOff.filter((k) => !listed.includes(k as ReminderKind));
  return [...new Set([...keptHidden, ...listed.filter((k) => !ticked.has(k))])].sort();
}

export function readReminderPrefs(personId: string) {
  return prisma.reminderPrefs.findUnique({ where: { personId } });
}

export type ReminderPrefsInput = {
  off: string[];
  quietStart: number | null;
  quietEnd: number | null;
  teamsEnabled?: boolean;
  emailEnabled?: boolean;
};

export async function saveReminderPrefs(personId: string, input: ReminderPrefsInput) {
  const data = {
    off: input.off,
    quietStart: input.quietStart,
    quietEnd: input.quietEnd,
    ...(input.teamsEnabled === undefined ? {} : { teamsEnabled: input.teamsEnabled }),
    ...(input.emailEnabled === undefined ? {} : { emailEnabled: input.emailEnabled }),
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
