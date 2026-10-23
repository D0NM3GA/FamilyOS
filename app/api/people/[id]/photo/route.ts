import { NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/active-profile";
import { prisma } from "@/lib/prisma";

// The stored type came from Graph's response header. Only plain raster images are served
// as themselves: an SVG (or HTML) body would run as script on this site.
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getActiveProfile();
  if (!viewer) {
    return new NextResponse(null, { status: 401 });
  }

  const { id } = await params;

  const person = await prisma.person.findUnique({
    where: { id },
    select: { photo: true, photoContentType: true, householdId: true },
  });

  if (
    !person ||
    person.householdId !== viewer.householdId ||
    !person.photo ||
    !person.photoContentType
  ) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(person.photo, {
    status: 200,
    headers: {
      "Content-Type": IMAGE_TYPES.has(person.photoContentType.toLowerCase()) ? person.photoContentType : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
