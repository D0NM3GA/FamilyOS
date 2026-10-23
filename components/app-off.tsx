import Link from "next/link";
import type { AppDef } from "@/lib/apps";
import { AppTile } from "@/components/app-tile";
import { btn, btnPrimary, card } from "@/components/styles";

/**
 * Phase 36: the friendly note for an app the family turned off, shown by /apps-off/<app>
 * (lib/app-guard.ts sends every page of an off app there). Kid-friendly and short; admins
 * also get the way back to Settings → Apps.
 */
export function AppOffCard({ app, isAdmin }: { app: AppDef; isAdmin: boolean }) {
  return (
    <div className="p-4 sm:p-6">
      <div className={`${card} mx-auto mt-6 flex max-w-md flex-col items-center gap-3 text-center sm:mt-12`}>
        <AppTile app={app} size="lg" dim />
        <h1 className="font-heading text-2xl font-extrabold leading-tight">{app.label} is turned off for your family.</h1>
        <p className="text-muted-foreground">An admin can turn it back on in Settings → Apps.</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Link href="/" className={btnPrimary}>
            Go home
          </Link>
          {isAdmin && (
            <Link href="/settings/apps" className={btn}>
              Settings → Apps
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
