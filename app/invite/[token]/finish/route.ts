import { after } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";
import { setActiveProfileCookie } from "@/lib/active-profile";
import { acceptInviteForUser, discardOrphanSignIn, halfFinishedProviderSignIn, InviteError } from "@/lib/invites";
import { INVITE_START_COOKIE } from "@/lib/oidc-sign-up";
import { deliverSignInNotices } from "@/lib/sign-in-notices";

/**
 * Phase 40.3: where the OIDC provider sends someone back after "Use <provider> instead" on an
 * invite (and where the invite page sends a half-finished one). Signed in as the provider's new
 * account, the invite is used for it (lib/invites.ts acceptInviteForUser); refused, that new
 * sign-in is cleared and the invite page says why, with the invite still there.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = `/invite/${encodeURIComponent(token)}`;
  // Its job is done either way.
  (await cookies()).set(INVITE_START_COOKIE, "", { path: "/api/auth", maxAge: 0 });

  const session = await getServerSession();
  // Only a provider sign-in that isn't anyone yet has anything to finish here.
  if (!session || !(await halfFinishedProviderSignIn(session.user.id))) redirect(back);
  let personId: string;
  try {
    const accepted = await acceptInviteForUser(token, session.user.id);
    personId = accepted.personId;
    if (accepted.notices.length) after(() => deliverSignInNotices({ otherNotices: accepted.notices }));
  } catch (e) {
    if (!(e instanceof InviteError)) throw e;
    await discardOrphanSignIn(session.user.id);
    redirect(`${back}?error=${e.code}`);
  }
  await setActiveProfileCookie(personId);
  redirect("/");
}
