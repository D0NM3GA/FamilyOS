import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeExport, downloadResponse, hostOf } from "@/lib/export";
import { appOn } from "@/lib/app-switches";
import { requireJar } from "@/lib/finance/access";
import { activityCsv, activityCsvName, exportMonth } from "@/lib/finance/activity";
import { todayCivil } from "@/lib/finance/budget";
import { logJarEvent } from "@/lib/finance/history";

/**
 * A jar's activity as a spreadsheet (lib/finance/activity.ts): one month, or everything. POST
 * from the jar's own page only (a link could be prefetched or re-fetched, and each download is
 * noted in the jar's history for everyone in it). Members only, on their own Microsoft sign-in
 * (requireJar: anyone else gets a 404, so a jar's existence isn't revealed), and only what
 * they see on the page: surprises hidden from them stay out.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jarId: string }> }) {
  const auth = await authorizeExport(request, "adult");
  if (auth.response) return auth.response;
  // Phase 36: no downloads while the family has Money turned off.
  if (!(await appOn(auth.viewer.householdId, "money"))) return new NextResponse(null, { status: 404 });
  // Same origin only, by the Origin header too: not every browser sends Fetch Metadata (older
  // Safari), and a cross-site form post would otherwise add a download nobody made to the
  // jar's history.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || hostOf(request.headers.get("origin")) !== host) return new NextResponse(null, { status: 403 });
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);

  const today = todayCivil();
  const form = await request.formData().catch(() => null);
  const choice = exportMonth(form?.get("month"), today);
  if (!choice.ok) return new NextResponse(null, { status: 400 });

  const { csv, count } = await activityCsv(jar.id, viewer.id, today, choice.month);
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "EXPORTED", data: { month: choice.month, count } });
  return downloadResponse(csv, activityCsvName(choice.month, today), "text/csv; charset=utf-8");
}
