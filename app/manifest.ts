import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getFamilyLook } from "@/lib/household-settings";
import { themeColorOf } from "@/lib/theme-colors";

/**
 * Phase 21.6: the web app manifest. `display: "standalone"` is what lets an iPhone treat the
 * app on the Home Screen as an installed app, which is the only way iOS delivers web push.
 *
 * The name and icon are the family's own (Settings → Make it yours), so this is read per
 * request rather than cached at build. A phone keeps what it was installed with until it
 * re-reads this.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  await connection();
  const { appName, themeColor } = await getFamilyLook();
  return {
    name: appName,
    short_name: appName,
    description: "Your family's chores, store, groceries and more.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f1e3",
    theme_color: themeColorOf(themeColor).light.chrome,
    // Drawn per request in the family's choice (app/app-icon/[size]); 192 and 512 are what
    // Android's install prompt wants.
    icons: [
      { src: "/app-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
