import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/page-header";
import { backLink } from "@/components/styles";
import { LookForm } from "./look-form";
import { lookFormDefaults } from "./defaults";

export const metadata = { title: "Make it yours" };

/** Phase 35: the family's own look for the app (admin-only, for everyone in the household). */
export default async function MakeItYoursPage() {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile)) redirect("/settings");

  const defaults = await lookFormDefaults(profile.householdId);

  return (
    <div className="p-4 sm:p-6">
      <Link href="/settings" className={backLink}>
        ← Settings
      </Link>
      <PageHeader title="Make it yours" />
      <p className="mb-4 mt-1 max-w-2xl text-sm text-muted-foreground">
        Admins only. These change the app for everyone in the family, on every device. They live with your family&apos;s data
        and in your backups, never in the app&apos;s code.
      </p>
      <LookForm defaults={defaults} />
    </div>
  );
}
