import type { Prisma } from "@/app/generated/prisma/client";
import type { SignInEventKind } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Phase 40.2: the sign-in audit log (the owner's call). One entry for every change to how
 * someone gets in: a passkey added or removed, and (40.2b/c) invites, resets, a sign-in taken
 * away, a role changed. Append-only: nothing in the app edits or deletes an entry. Each keeps
 * the first names as they were, so it still reads right once a person is gone.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Who = { id: string | null; firstName: string };

/**
 * `subject.id` is null for someone who isn't here yet (an invite for someone new); `actor.id` is
 * null when Entra made the change (Phase 40.4, actor "Entra").
 */
export type SignInEventInput = { householdId: string; kind: SignInEventKind; actor: Who; subject: Who; detail?: string | null };

export async function recordSignInEvent(db: Db, e: SignInEventInput): Promise<void> {
  await db.signInEvent.create({
    data: {
      householdId: e.householdId,
      kind: e.kind,
      actorId: e.actor.id,
      actorName: e.actor.firstName,
      subjectId: e.subject.id,
      subjectName: e.subject.firstName,
      detail: e.detail?.slice(0, 60) || null,
    },
  });
}

export type SignInEventRow = {
  id: string;
  kind: SignInEventKind;
  actorId: string | null;
  actorName: string;
  subjectId: string | null;
  subjectName: string;
  detail: string | null;
  createdAt: Date;
};

const rowSelect = { id: true, kind: true, actorId: true, actorName: true, subjectId: true, subjectName: true, detail: true, createdAt: true } as const;

/** The household's sign-in changes, newest first (the admins' Settings → Sign-in). */
export function householdSignInHistory(householdId: string, take = 20): Promise<SignInEventRow[]> {
  return prisma.signInEvent.findMany({ where: { householdId }, orderBy: { createdAt: "desc" }, take, select: rowSelect });
}

/** What happened to one person's sign-in, newest first (their My passkeys page). */
export function signInHistoryFor(personId: string, take = 10): Promise<SignInEventRow[]> {
  return prisma.signInEvent.findMany({ where: { subjectId: personId }, orderBy: { createdAt: "desc" }, take, select: rowSelect });
}

/**
 * One entry in words, from the reader's side ("You added a passkey", "Dad reset Mom's
 * passkeys"). `you` is the reader's person id.
 */
export function describeSignInEvent(e: SignInEventRow, you: string): string {
  const actor = e.actorId === you ? "You" : e.actorName;
  // A person's own change: the same id, or, once they're gone (both ids cleared), the same name.
  const self = e.actorId !== null ? e.actorId === e.subjectId : e.subjectId === null && e.actorName === e.subjectName;
  const whose = e.subjectId === you ? "your" : self ? "their" : `${e.subjectName}'s`;
  const label = e.detail ? ` (${e.detail})` : "";
  switch (e.kind) {
    case "PASSKEY_ADDED":
      return self ? `${actor} added a passkey${label}` : `${actor} added a passkey for ${e.subjectId === you ? "you" : e.subjectName}${label}`;
    case "PASSKEY_REMOVED":
      return self ? `${actor} removed a passkey${label}` : `${actor} removed ${whose} passkey${label}`;
    case "INVITE_MADE":
      return `${actor} made an invite for ${e.subjectId === you ? "you" : e.subjectName}${e.detail ? `, as ${e.detail}` : ""}`;
    case "INVITE_CANCELLED":
      return `${actor} cancelled the ${e.detail === "recovery" ? "new sign-in link" : "invite"} for ${e.subjectId === you ? "you" : e.subjectName}`;
    case "INVITE_ACCEPTED":
      if (e.detail === "recovery") return `${e.subjectId === you ? "You" : e.subjectName} used a new sign-in link to get back in`;
      return `${e.subjectId === you ? "You" : e.subjectName} used an invite to sign in${e.detail ? `, as ${e.detail}` : ""}`;
    case "PASSKEYS_RESET":
      return `${actor} reset ${whose} passkeys`;
    case "SIGN_IN_REMOVED":
      return `${actor} removed ${whose} sign-in`;
    case "ROLE_CHANGED":
      return `${actor} changed ${whose} role${e.detail ? ` to ${e.detail}` : ""}`;
    case "ENTRA_ACCESS_ENDED":
      return `Entra ended ${whose} access`;
    case "ENTRA_ACCESS_RESTORED":
      return `${e.subjectId === you ? "You" : e.subjectName} got access again from Entra`;
    case "BREAK_GLASS_ON":
      return `Emergency local access was switched on on the server${e.detail ? `, until ${e.detail}` : ""}`;
    case "BREAK_GLASS_OFF":
      return "Emergency local access went off";
  }
}
