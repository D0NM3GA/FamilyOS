import { appIconResponse } from "@/lib/app-icon";
import { getFamilyLook } from "@/lib/household-settings";

/** The sizes app/manifest.ts lists for installing the app (and push notifications use). */
const INSTALL_SIZES = ["192", "512"];

/**
 * Phase 39: the app's install icons, in the family's choice (lib/app-icon.tsx), with an ETag so
 * an unchanged icon is a 304. A plain route rather than an icon file with several sizes, which
 * Next turns into a statically generated route whose responses can't be a 304.
 */
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  if (!INSTALL_SIZES.includes(size)) return new Response("Not found", { status: 404 });
  return appIconResponse(await getFamilyLook(), Number(size), request.headers.get("if-none-match"));
}
