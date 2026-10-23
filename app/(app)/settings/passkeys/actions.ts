"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { getServerSession } from "@/lib/session";
import {
  createAddPasskeyTicket,
  passkeyNameSchema,
  PASSKEY_ERRORS,
  PasskeyError,
  removePasskey,
  renamePasskey,
  type PasskeyErrorCode,
  type SessionFacts,
} from "@/lib/my-passkeys";

const PAGE = "/settings/passkeys";

// A code, never words: the page looks the words up, so a link can't make it say anything else.
function fail(code: PasskeyErrorCode): never {
  redirect(`${PAGE}?error=${code}`);
}

/** The signed-in person's own session, when the profile in use is theirs (not a PIN-switch). */
async function ownSession(): Promise<SessionFacts | null> {
  const profile = await requireActiveProfile();
  const session = await getServerSession();
  if (!session || !(await isSessionOwner(profile))) return null;
  return { id: session.session.id, userId: session.user.id, createdAt: session.session.createdAt };
}

export type AddPasskeyState = { error?: string; ticket?: string };

/** Step 1 of adding a passkey: the checks, then a ticket for the browser's passkey call (step 2). */
export async function startAddingPasskey(_prev: AddPasskeyState, formData: FormData): Promise<AddPasskeyState> {
  const session = await ownSession();
  if (!session) return { error: PASSKEY_ERRORS.notOwn };
  const raw = String(formData.get("name") ?? "").trim();
  const name = raw ? passkeyNameSchema.safeParse(raw) : null;
  if (name && !name.success) return { error: name.error.issues[0]?.message ?? "That name doesn't work." };
  try {
    return { ticket: await createAddPasskeyTicket(session, name?.data) };
  } catch (e) {
    if (e instanceof PasskeyError) return { error: e.message };
    throw e;
  }
}

export type RenamePasskeyState = { error?: string; success?: boolean };

export async function renameMyPasskey(passkeyId: string, _prev: RenamePasskeyState, formData: FormData): Promise<RenamePasskeyState> {
  const session = await ownSession();
  if (!session) return { error: PASSKEY_ERRORS.notOwn };
  const name = passkeyNameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success) return { error: name.error.issues[0]?.message ?? "That name doesn't work." };
  try {
    await renamePasskey(session.userId, passkeyId, name.data);
  } catch (e) {
    if (e instanceof PasskeyError) return { error: e.message };
    throw e;
  }
  revalidatePath(PAGE);
  return { success: true };
}

export async function removeMyPasskey(passkeyId: string) {
  const session = await ownSession();
  if (!session) fail("notOwn");
  try {
    await removePasskey(session, passkeyId);
  } catch (e) {
    if (e instanceof PasskeyError) fail(e.code);
    throw e;
  }
  redirect(PAGE);
}
