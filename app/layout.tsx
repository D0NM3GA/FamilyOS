import type { Metadata, Viewport } from "next";
import { Baloo_2, Gaegu, Nunito } from "next/font/google";
import { connection } from "next/server";
import { headers } from "next/headers";
import { getFamilyLook } from "@/lib/household-settings";
import { themeColorCss, themeColorOf } from "@/lib/theme-colors";
import "./globals.css";

// Replaces Geist Sans as part of the warm/family-friendly design pass — see
// docs/BUILD.md. Also fixed a pre-existing bug: globals.css's `--font-sans` was a
// self-reference (`var(--font-sans)`), never actually wired to the Geist variable, so
// every page was silently rendering the browser's serif fallback rather than Geist.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

// Phase 19 Sticker Book type: Baloo 2 headings (a variable font, so no weight list) and
// Gaegu for short handwritten notes (`font-hand`; Gaegu isn't variable, so it needs one).
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
});
const gaegu = Gaegu({
  variable: "--font-gaegu",
  subsets: ["latin"],
  weight: "700",
});

export async function generateMetadata(): Promise<Metadata> {
  // The family names the app in Settings, so the name is read per request: a build-time
  // prerender would bake in whatever the database said then (or need a database at all).
  await connection();
  const { appName } = await getFamilyLook();
  return {
    title: { default: appName, template: `%s · ${appName}` },
    description: "The family's chores, groceries, and contacts, in one place.",
    // Phase 21.6: Home Screen web-app metadata (Next emits mobile-web-app-capable, title and
    // status-bar style). The manifest's display: standalone is what iOS uses to treat the
    // app as installed, the only way iPhones get web push.
    appleWebApp: { capable: true, title: appName },
  };
}

// Fallback for the OS-level color-scheme (no saved override yet, or JS never ran), in the
// family's top bar color (Settings → Make it yours). components/theme-toggle.tsx updates
// it directly once a manual light/dark choice is stored, since a media query alone can't
// reflect that override.
export async function generateViewport(): Promise<Viewport> {
  await connection();
  const color = themeColorOf((await getFamilyLook()).themeColor);
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: color.light.chrome },
      { media: "(prefers-color-scheme: dark)", color: color.dark.chrome },
    ],
  };
}

// A literal <script> inside a literal <head> below — NOT next/script's `beforeInteractive`
// strategy, which (per node_modules/next/dist/docs/01-app/02-guides/
// preventing-flash-before-hydration.md, "Themes") only runs once the client bundle has
// loaded, well after first paint, so it can't actually prevent the flash it sounds like it
// should. A raw inline <script> runs synchronously as the browser *parses* the HTML, before
// anything is painted — that's what actually avoids a saved dark preference flashing light
// for a frame on every load. Reads localStorage directly (no cookie/server round-trip):
// this app has no per-user server-side preference store, and a shared family device
// reasonably keeps this as a per-browser choice — see docs/BUILD.md's Dark mode phase entry.
const THEME_INIT_SCRIPT = `(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark =
      stored === "dark" ||
      (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The family's look, before anyone signs in: this install's household (getFamilyLook).
  await connection();
  const look = await getFamilyLook();
  const themeCss = themeColorCss(look.themeColor);
  // Phase 42: this request's script-policy nonce (proxy.ts), for the two inline blocks below.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: THEME_INIT_SCRIPT mutates this element's class before React
    // hydrates, which would otherwise make React flag a server/client mismatch here even
    // though it's expected and desired.
    // data-bunson-volume="OFF" when the family turned the mascot off hides his moments on
    // pages outside the app shell too (sign-in, not found), through globals.css's volume gate.
    <html
      lang="en"
      className={`${nunito.variable} ${baloo.variable} ${gaegu.variable} h-full antialiased`}
      data-bunson-volume={look.mascot.on ? undefined : "OFF"}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Preset values only (lib/theme-colors.ts), never typed text. */}
        {themeCss && <style nonce={nonce} dangerouslySetInnerHTML={{ __html: themeCss }} />}
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
