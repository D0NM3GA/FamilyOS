import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeExport, downloadResponse, hostOf } from "@/lib/export";
import { appOn } from "@/lib/app-switches";
import { requireJar } from "@/lib/finance/access";
import { todayCivil } from "@/lib/finance/budget";
import { logJarEvent } from "@/lib/finance/history";
import { parseYear, yearCsv } from "@/lib/finance/year";
import { loadYear } from "@/lib/finance/year-load";

/**
 * Phase 70e: the year as a spreadsheet. The same rules as the jar's activity spreadsheet: a POST
 * from the jar's own page, members on their own sign-in only, same origin, noted in the jar's
 * history, and only what the member sees (surprises as a total).
 */
export async function POST(request: Request, { params }: { params: Promise<{ jarId: string }> }) {
  const auth = await authorizeExport(request, "adult");
  if (auth.response) return auth.response;
  if (!(await appOn(auth.viewer.householdId, "money"))) return new NextResponse(null, { status: 404 });
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || hostOf(request.headers.get("origin")) !== host) return new NextResponse(null, { status: 403 });
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);

  const today = todayCivil();
  const form = await request.formData().catch(() => null);
  const year = parseYear(form?.get("year"), today);
  const summary = await loadYear(jar.id, viewer.id, year, today);
  await logJarEvent(prisma, { jarId: jar.id, actorId: viewer.id, kind: "EXPORTED", data: { month: null, year, count: summary.rowCount } });
  return downloadResponse(yearCsv(summary), `year-${year}.csv`, "text/csv; charset=utf-8");
}
