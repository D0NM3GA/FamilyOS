import { headers } from "next/headers";
import { appIconResponse } from "@/lib/app-icon";
import { getFamilyLook } from "@/lib/household-settings";

/** Phase 35: the iPhone/iPad Home Screen icon, in the family's choice (lib/app-icon.tsx). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  // The request first: it's what makes this route dynamic, so the build never reads the database.
  const ifNoneMatch = (await headers()).get("if-none-match");
  return appIconResponse(await getFamilyLook(), size.width, ifNoneMatch);
}
