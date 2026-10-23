import { NextResponse } from "next/server";
import { getActiveProfile, isOwnSignIn } from "@/lib/active-profile";
import { signedInRecently } from "@/lib/session";
import { isAdmin, isAdult } from "@/lib/authz";
import { setSentryUser } from "@/lib/observability";
import { activeAppId } from "@/lib/apps";
import { appOn } from "@/lib/app-switches";

/**
 * Shared plumbing for every export download (Phase 16). Kernel: no domain imports.
 *
 * Downloads are route handlers, not pages, so the (app) layout's auth doesn't wrap them;
 * every route calls `authorizeExport` itself. Who may download (the owner's decision): the
 * whole-household backup is ADMIN only; per-domain CSVs are for any adult; kids never.
 */

type Viewer = NonNullable<Awaited<ReturnType<typeof getActiveProfile>>>;
export type ExportLevel = "adult" | "admin";

/**
 * Phase 28: backups are "sensitive" downloads (AAA). On top of the role check they must be
 * a POST from our own page (a plain link can be re-fetched by a download manager or a link
 * scanner, and each fetch is an audited, announced backup), by the person themselves (their
 * own sign-in, not a profile switched to), signed in within the last 15 minutes
 * (lib/session.ts signedInRecently). A refused form post goes back to `stepUpPath` with
 * ?stepup=own|fresh so the page can say what to do.
 */
export type SensitiveExport = { stepUpPath: string };

export function hostOf(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export async function authorizeExport(
  request: Request,
  level: ExportLevel,
  sensitive?: SensitiveExport,
): Promise<{ viewer: Viewer; response?: never } | { viewer?: never; response: Response }> {
  // A cross-site page can make the browser *request* a download (a link or a form) but
  // can't read the response, so this isn't a confidentiality hole on its own. Refusing
  // is still the right default for endpoints that exist only for this app's own pages.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return { response: new NextResponse(null, { status: 403 }) };
  }
  const viewer = await getActiveProfile();
  if (!viewer) {
    // A signed-out click on a download link is a page navigation: send it through "/", which
    // redirects to sign-in or the profile picker, instead of "downloading" an empty 401
    // (Fable's implementation review). Non-navigation requests still get a plain 401.
    if (request.headers.get("sec-fetch-mode") === "navigate") {
      return { response: NextResponse.redirect(new URL("/", request.url), 303) };
    }
    return { response: new NextResponse(null, { status: 401 }) };
  }
  const allowed = level === "admin" ? isAdmin(viewer) : isAdult(viewer);
  if (!allowed) return { response: new NextResponse(null, { status: 403 }) };
  if (sensitive) {
    const h = request.headers;
    const host = h.get("x-forwarded-host") ?? h.get("host");
    // A form post is a navigation; an old browser sends no fetch metadata at all.
    const navigating = h.get("sec-fetch-mode") === "navigate" || h.get("sec-fetch-mode") == null;
    const back = (reason: "own" | "fresh" | "blocked") =>
      navigating
        ? { response: NextResponse.redirect(new URL(`${sensitive.stepUpPath}?stepup=${reason}`, request.url), 303) }
        : { response: new NextResponse(null, { status: 403 }) };
    if (request.method !== "POST" || h.get("sec-fetch-site") !== "same-origin" || !host || hostOf(h.get("origin")) !== host) {
      // A cross-site post is refused before this (403); a same-site one just can't prove it.
      return back("blocked");
    }
    if (!(await isOwnSignIn(viewer))) return back("own");
    if (!(await signedInRecently())) return back("fresh");
  }
  // Route handlers don't go through requireActiveProfile, which is where pages tag Sentry.
  setSentryUser(viewer.id);
  return { viewer };
}

// Filenames are built by our own code, never from user text: a household name with a
// quote or newline in a Content-Disposition header would be header injection.
const SAFE_FILENAME = /^[a-z0-9][a-z0-9.-]*$/;

export function downloadResponse(body: string, filename: string, contentType: string): Response {
  if (!SAFE_FILENAME.test(filename)) throw new Error("unsafe export filename");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Today's local date as YYYY-MM-DD, for filenames. */
export function exportDateStamp(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * Whether the app a domain's downloads belong to is on. Each domain's export lives at
 * `/<domain>/export/...`, inside its app's own path, so the app is the one that path lands in
 * (`points` is the Store, `vehicles` is Cars).
 */
export async function exportAppOn(householdId: string, domain: string): Promise<boolean> {
  const app = activeAppId(`/${domain}`);
  return app === null || appOn(householdId, app);
}

/** One downloadable CSV a domain offers. `build` returns the finished CSV text. */
export type CsvExport = {
  label: string;
  description: string;
  build: (householdId: string) => Promise<string>;
};

/**
 * The GET handler every domain's `export/[file]/route.ts` delegates to: resolves
 * `<name>.csv` against the domain's registry, authorizes (adult), builds, downloads.
 */
export async function serveCsvExport(
  request: Request,
  params: Promise<{ file: string }>,
  domain: string,
  registry: Record<string, CsvExport>,
): Promise<Response> {
  const { file } = await params;
  const name = file.endsWith(".csv") ? file.slice(0, -4) : null;
  const entry = name != null && Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (!entry) return new NextResponse(null, { status: 404 });

  const auth = await authorizeExport(request, "adult");
  if (auth.response) return auth.response;
  // Phase 36: a turned-off app has no downloads (its data is still in the full backup).
  if (!(await exportAppOn(auth.viewer.householdId, domain))) return new NextResponse(null, { status: 404 });

  const csv = await entry.build(auth.viewer.householdId);
  return downloadResponse(csv, `${domain}-${name}-${exportDateStamp()}.csv`, "text/csv; charset=utf-8");
}
