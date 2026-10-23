import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { iconLetter, type FamilyLook } from "@/lib/family-look";
import { themeColorOf } from "@/lib/theme-colors";

/**
 * Phase 35: the app's icon (favicon, Home Screen, the manifest's install icons), drawn per
 * request from the family's choice in Settings → Make it yours: the bunny, or the app name's
 * first letter in sun yellow on their top bar color. Server-only.
 *
 * Phase 39: served with an ETag and `no-cache`, so a browser asks each time and gets a 304
 * while the icon is unchanged, and a new look shows on the next load. (next/og's own default
 * in production is "immutable, a year", which kept a new look from ever reaching the tab.)
 */

// Read on first use and kept; the art doesn't change while the server runs. Lazy, so a
// missing file fails the icon request, not the module load; a failed read is tried again.
let bunny: Promise<Buffer> | null = null;
const bunnyBytes = () =>
  (bunny ??= readFile(join(process.cwd(), "public/icons/bunny.png")).catch((err) => {
    bunny = null;
    throw err;
  }));
const bunnyDataUrl = async () => `data:image/png;base64,${(await bunnyBytes()).toString("base64")}`;

/** Bump when the drawing below changes, so browsers holding the old icon get the new one. */
const DRAWING_VERSION = 1;

/** What the icon is drawn from: the bunny (with its art's hash), or a letter on a color. */
async function iconInputs(look: FamilyLook, size: number): Promise<string> {
  const letter = look.appIcon === "LETTER" ? iconLetter(look.appName) : null;
  const what = letter
    ? `letter-${letter.codePointAt(0)}-${look.themeColor ?? "default"}`
    : `bunny-${createHash("sha256").update(await bunnyBytes()).digest("hex").slice(0, 12)}`;
  return `v${DRAWING_VERSION}-${what}-${size}`;
}

/** The icon's ETag (a strong, quoted tag). */
export async function iconTag(look: FamilyLook, size: number): Promise<string> {
  return `"${await iconInputs(look, size)}"`;
}

// Drawn icons, newest last: a few sizes of the one look an install shows (icons are drawn
// before anyone signs in, from the install's household), so a handful is plenty.
const MEMO_MAX = 8;
const memo = new Map<string, ArrayBuffer>();

/**
 * The icon route's answer: 304 when the browser already has this icon (`ifNoneMatch`, read by
 * the route from the request), else the PNG, drawn once per look and size while the server runs.
 */
export async function appIconResponse(look: FamilyLook, size: number, ifNoneMatch: string | null): Promise<Response> {
  const etag = await iconTag(look, size);
  const headers = { ETag: etag, "Cache-Control": "public, no-cache" };
  if (ifNoneMatch?.split(",").some((t) => t.trim() === "*" || t.trim().replace(/^W\//, "") === etag)) {
    return new Response(null, { status: 304, headers });
  }
  let png = memo.get(etag);
  if (!png) {
    png = await (await renderAppIcon(look, size)).arrayBuffer();
    memo.set(etag, png);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  }
  return new Response(png, { headers: { ...headers, "Content-Type": "image/png" } });
}

export async function renderAppIcon(look: FamilyLook, size: number): Promise<ImageResponse> {
  const letter = look.appIcon === "LETTER" ? iconLetter(look.appName) : null;
  const box = { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" } as const;

  if (letter) {
    // The image renderer only bundles a regular-weight font, so the letter is drawn a few
    // times a hair apart to read as the bold wordmark.
    const nudge = Math.max(1, Math.round(size * 0.012));
    const offsets = [
      [0, 0],
      [nudge, 0],
      [-nudge, 0],
      [0, nudge],
      [0, -nudge],
    ];
    return new ImageResponse(
      (
        <div style={{ ...box, position: "relative", background: themeColorOf(look.themeColor).light.chrome }}>
          {offsets.map(([x, y]) => (
            <div key={`${x},${y}`} style={{ ...box, position: "absolute", top: y, left: x, color: "#ffd23f", fontSize: Math.round(size * 0.68), lineHeight: 1 }}>
              {letter}
            </div>
          ))}
        </div>
      ),
      { width: size, height: size },
    );
  }

  const art = Math.round(size * 0.86);
  return new ImageResponse(
    (
      <div style={{ ...box, background: "#f7f1e3" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered to a PNG, not a page */}
        <img src={await bunnyDataUrl()} width={art} height={art} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
