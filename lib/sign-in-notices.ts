import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { SignInEventKind } from "@/app/generated/prisma/enums";
import type { TeamsCard } from "@/lib/alerts/teams";

/**
 * Phase 40.2c: who hears about a change to someone's sign-in. Written in the same transaction as
 * the audit entry (lib/sign-in-events.ts), then delivered after it commits like the backup
 * notices: the bell, Teams (each person's own chat) and phones.
 *
 * The owner's calls (2026-10-13):
 * - Notices about your own sign-in always come: a reset, losing your own sign-in, a new role, a
 *   passkey added (even by you: that's the one that says "if that wasn't you"). The switch in My
 *   notifications (AlertPrefs.signInNotices) only quiets an admin's notices about other people.
 * - The person and the other admins are told; jar-mates aren't.
 *
 * Titles name people by first name only, never an email or a link.
 */

type Tx = Prisma.TransactionClient;
type Who = { id: string | null; firstName: string };

/** Notice ids to deliver once the change has committed: the person's own, and the others'. */
export type Announced = { subjectNotices: string[]; otherNotices: string[] };

export const SIGN_IN_CARD: TeamsCard = { heading: "🔐 Sign-in", linkText: "See sign-ins" };
/** The person's own notices open their own page, not the admins'. */
const OWN_SIGN_IN_CARD: TeamsCard = { heading: "🔐 Your sign-in", linkText: "Open the app" };

/** The kinds that tell the person themselves; their own, so always. */
const TELLS_SUBJECT = new Set<SignInEventKind>(["PASSKEYS_RESET", "SIGN_IN_REMOVED", "ROLE_CHANGED", "PASSKEY_ADDED", "ENTRA_ACCESS_ENDED"]);
/** The kinds the other admins hear about (if their switch is on). */
const TELLS_ADMINS = new Set<SignInEventKind>(["PASSKEYS_RESET", "SIGN_IN_REMOVED", "ROLE_CHANGED", "ENTRA_ACCESS_ENDED"]);

const roleWords = (role: string | null | undefined) => (role === "Admin" ? "an admin" : "a grown-up without admin");

function subjectTitle(kind: SignInEventKind, actor: string, role?: string | null): string {
  switch (kind) {
    case "PASSKEYS_RESET":
      return `🔐 ${actor} reset your passkeys. If you didn't ask for that, tell another grown-up.`;
    case "SIGN_IN_REMOVED":
      return `🔐 ${actor} took away your own sign-in. Your profile opens with a PIN now.`;
    case "ROLE_CHANGED":
      return `🔐 ${actor} made you ${roleWords(role)}.`;
    case "ENTRA_ACCESS_ENDED":
      return "🔐 Your access to the app was ended in Entra (Microsoft 365). If that's a mistake, ask whoever looks after it.";
    default:
      return "🔐 A passkey was added to your sign-in. If that wasn't you, tell an admin.";
  }
}

function adminTitle(kind: SignInEventKind, actor: string, subject: string, role?: string | null): string {
  switch (kind) {
    case "PASSKEYS_RESET":
      return `🔐 ${actor} reset ${subject}'s passkeys.`;
    case "SIGN_IN_REMOVED":
      return `🔐 ${actor} removed ${subject}'s own sign-in.`;
    case "ENTRA_ACCESS_ENDED":
      return `🔐 Entra ended ${subject}'s access to the app. Invites or links ${subject} made stopped working, and a shared tablet signed in as ${subject} needs another grown-up's sign-in.`;
    default:
      return `🔐 ${actor} made ${subject} ${roleWords(role)}.`;
  }
}

/** Grown-ups who want notices about other people's sign-ins (no prefs row means yes). */
const wantsOthersNotices: Prisma.PersonWhereInput = { OR: [{ alertPrefs: { is: null } }, { alertPrefs: { is: { signInNotices: true } } }] };

export type SignInNoticeInput = {
  householdId: string;
  kind: SignInEventKind;
  actor: Who;
  subject: Who;
  /** The role it gave, for ROLE_CHANGED: "Admin" or "Adult". */
  role?: string | null;
};

/**
 * Writes the bell notices for one sign-in change; returns their ids to deliver once the
 * transaction has committed (deliverSignInNotices). `subjectNotices` are the person's own, which
 * also go by email where the install can send it (a reset leaves them signed out everywhere).
 */
export async function writeSignInNotices(tx: Tx, n: SignInNoticeInput): Promise<{ subjectNotices: string[]; otherNotices: string[] }> {
  const subjectNotices: string[] = [];
  const otherNotices: string[] = [];

  if (TELLS_SUBJECT.has(n.kind) && n.subject.id) {
    const here = await tx.person.count({ where: { id: n.subject.id, householdId: n.householdId, isHouseholdMember: true } });
    if (here) {
      const created = await tx.notification.create({
        data: {
          householdId: n.householdId,
          recipientId: n.subject.id,
          kind: "SIGN_IN_CHANGED",
          title: subjectTitle(n.kind, n.actor.firstName, n.role),
          // My passkeys only for passkey matters; anyone can open Settings.
          href: n.kind === "PASSKEYS_RESET" || n.kind === "PASSKEY_ADDED" ? "/settings/passkeys" : "/settings",
        },
        select: { id: true },
      });
      subjectNotices.push(created.id);
    }
  }

  if (TELLS_ADMINS.has(n.kind)) {
    const admins = await tx.person.findMany({
      where: {
        householdId: n.householdId,
        isHouseholdMember: true,
        role: "ADMIN",
        authUserId: { not: null },
        id: { notIn: [n.actor.id, n.subject.id].filter((id): id is string => id !== null) },
        // Phase 40.4: never someone Entra has cut off.
        entraAccessEndedAt: null,
        ...wantsOthersNotices,
      },
      select: { id: true },
    });
    const title = adminTitle(n.kind, n.actor.firstName, n.subject.firstName, n.role);
    for (const admin of admins) {
      const created = await tx.notification.create({
        data: { householdId: n.householdId, recipientId: admin.id, kind: "SIGN_IN_CHANGED", title, href: "/settings/sign-in" },
        select: { id: true },
      });
      otherNotices.push(created.id);
    }
  }
  return { subjectNotices, otherNotices };
}

/**
 * Tells whoever made an invite that it was used (if they're still here and want these). A reset's
 * link too: "back in" from the admin who holds the link is how a link used by someone else shows.
 */
export async function writeInviteUsedNotice(tx: Tx, householdId: string, makerId: string | null, person: Who, recovery = false): Promise<string[]> {
  if (!makerId || makerId === person.id) return [];
  const maker = await tx.person.findFirst({ where: { id: makerId, householdId, isHouseholdMember: true, entraAccessEndedAt: null, ...wantsOthersNotices }, select: { id: true } });
  if (!maker) return [];
  const title = recovery
    ? `🔐 ${person.firstName} used the new sign-in link and is back in. If ${person.firstName} didn't, reset again.`
    : `🔐 ${person.firstName} used your invite and can sign in now.`;
  const created = await tx.notification.create({
    data: { householdId, recipientId: maker.id, kind: "SIGN_IN_CHANGED", title, href: "/settings/sign-in" },
    select: { id: true },
  });
  return [created.id];
}

/** An admin's switch for notices about other people's sign-ins (My notifications). */
export async function othersSignInNoticesOn(personId: string): Promise<boolean> {
  const prefs = await prisma.alertPrefs.findUnique({ where: { personId }, select: { signInNotices: true } });
  return prefs?.signInNotices ?? true;
}

export async function setOthersSignInNotices(personId: string, on: boolean): Promise<void> {
  await prisma.alertPrefs.upsert({ where: { personId }, create: { personId, signInNotices: on }, update: { signInNotices: on } });
}

/**
 * Delivers notices written by writeSignInNotices, after the change has committed. Never throws
 * (delivery failures are recorded per person, lib/alerts/dispatch.ts). Loaded lazily, so the
 * passkey hooks that call it (lib/auth.ts) don't pull the alert senders into every import.
 */
export async function deliverSignInNotices(ids: { subjectNotices?: string[]; otherNotices?: string[] }): Promise<void> {
  const { deliverNotifications } = await import("@/lib/alerts/dispatch");
  const own = ids.subjectNotices ?? [];
  const others = ids.otherNotices ?? [];
  await Promise.all([
    // Their own, always: even to someone Entra just cut off (the owner's call, 40.4).
    own.length ? deliverNotifications({ id: { in: own } }, { channels: "teams-first", card: OWN_SIGN_IN_CARD, alsoEmail: true, includeEnded: true }) : null,
    others.length ? deliverNotifications({ id: { in: others } }, { channels: "teams-first", card: SIGN_IN_CARD }) : null,
  ]);
}
