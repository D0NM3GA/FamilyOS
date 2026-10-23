import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { graphFetchJson, graphFetchBinary, GraphAuthError } from "@/lib/graph/client";

type GraphMeResponse = {
  givenName?: string | null;
  surname?: string | null;
  displayName?: string | null;
  mail?: string | null;
  mobilePhone?: string | null;
};

const MAX_PHOTO_BYTES = 1024 * 1024; // ~1MB

export type SyncResult = { ok: true } | { ok: false; error: string };

/**
 * Enriches the SIGNED-IN adult's own Person record from Microsoft Graph — there's no
 * personId parameter on purpose; the target is always derived from the current session,
 * because Graph tokens only ever let you call `/me`, never someone else's profile.
 *
 * mode "fill": only writes fields that are currently empty — safe to run automatically.
 * mode "overwrite": always writes Graph's values over existing ones — only from an
 * explicit user action (the "Sync from Microsoft" button).
 */
export async function syncActivePersonFromEntra(mode: "fill" | "overwrite"): Promise<SyncResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const person = await prisma.person.findUnique({ where: { authUserId: session.user.id } });
  if (!person) return { ok: false, error: "No linked profile to sync." };

  let me: GraphMeResponse;
  try {
    me = await graphFetchJson<GraphMeResponse>(
      "/me?$select=givenName,surname,displayName,mail,mobilePhone",
    );
  } catch (err) {
    if (err instanceof GraphAuthError) return { ok: false, error: err.message };
    return { ok: false, error: "Couldn't reach Microsoft Graph." };
  }

  let photo: { bytes: Buffer; contentType: string } | null = null;
  try {
    photo = await graphFetchBinary("/me/photos/240x240/$value");
    if (!photo) photo = await graphFetchBinary("/me/photo/$value");
    if (photo && photo.bytes.byteLength > MAX_PHOTO_BYTES) photo = null;
  } catch {
    photo = null; // the photo is a nice-to-have — never fail the whole sync over it
  }

  const shouldWrite = (existing: string | null) =>
    mode === "overwrite" || !existing || existing.trim() === "";

  const data: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    // Always ArrayBuffer-backed in practice (built from fetch()'s arrayBuffer()), but
    // Node's Buffer type widens to ArrayBufferLike, which Prisma's Bytes field rejects.
    photo?: Uint8Array<ArrayBuffer>;
    photoContentType?: string;
    entraSyncedAt: Date;
  } = { entraSyncedAt: new Date() };

  if (me.givenName && shouldWrite(person.firstName)) data.firstName = me.givenName;
  if (me.surname && shouldWrite(person.lastName)) data.lastName = me.surname;
  if (me.mail && shouldWrite(person.email)) data.email = me.mail;
  if (me.mobilePhone && shouldWrite(person.phone)) data.phone = me.mobilePhone;
  if (photo && (mode === "overwrite" || !person.photoContentType)) {
    data.photo = new Uint8Array(photo.bytes) as Uint8Array<ArrayBuffer>;
    data.photoContentType = photo.contentType;
  }

  await prisma.person.update({ where: { id: person.id }, data });

  return { ok: true };
}
