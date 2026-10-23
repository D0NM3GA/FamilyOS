import { headers } from "next/headers";
import { appIconResponse } from "@/lib/app-icon";
import { getFamilyLook } from "@/lib/household-settings";

/**
 * Phase 35: the browser tab icon, in the family's choice (Settings → Make it yours). Read per
 * request, so a change shows without a new build. Phase 39: with an ETag, so an unchanged icon
 * is a 304 (lib/app-icon.tsx). The install sizes for the manifest are app/app-icon/[size]: a
 * multi-size icon file becomes a statically generated route, whose responses can't be a 304.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  // The request first: it's what makes this route dynamic, so the build never reads the database.
  const ifNoneMatch = (await headers()).get("if-none-match");
  return appIconResponse(await getFamilyLook(), size.width, ifNoneMatch);
}
