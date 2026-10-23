import Link from "next/link";
import type { Metadata } from "next";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { documentsConfigured, NOT_CONFIGURED } from "@/lib/documents/client";
import { ReceiptFlow } from "./receipt-flow";
import { backLink } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Snap the receipt" };

/**
 * Phase 24: snap a receipt, check the matches, save the prices. Grown-ups only: prices are
 * money, and kids don't see them anywhere.
 */
export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ purchase?: string | string[] }> }) {
  await requireAppOn("groceries");
  const profile = await requireActiveProfile();
  const { purchase } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl p-4 pb-28 sm:p-6">
      <Link href="/groceries" className={backLink}>
        ← Back to the list
      </Link>
      <h1 className="mt-2 text-3xl font-extrabold">📸 Snap the receipt</h1>
      {!isAdult(profile) ? (
        <p className="mt-4 text-muted-foreground">Receipts are a grown-up job.</p>
      ) : !documentsConfigured() ? (
        <p className="mt-4 rounded-2xl border-2 border-dashed border-ink/20 p-4 font-semibold">{NOT_CONFIGURED}</p>
      ) : (
        <>
          <p className="mt-1 text-muted-foreground">
            The app reads the prices and matches them to what you bought. Nobody types a price. The photo isn&apos;t kept.
          </p>
          <ReceiptFlow purchaseId={typeof purchase === "string" ? purchase.slice(0, 64) : null} />
        </>
      )}
    </div>
  );
}
