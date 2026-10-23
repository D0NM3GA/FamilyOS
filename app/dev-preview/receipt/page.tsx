import { notFound } from "next/navigation";
import { ReceiptReview } from "@/app/(app)/groceries/receipts/new/receipt-flow";
import { matchReceipt, receiptTextKey } from "@/lib/groceries/receipt-match";
import type { PreparedReceipt } from "@/lib/groceries/receipts";

// Phase 24 harness: the receipt review screen with a sample read, for screenshots without
// a Document Intelligence resource. Dev only, render-only (Save needs a signed-in adult).
export default function ReceiptPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const pantry = [
    { id: "dog", name: "Dog food", brand: "Purina" },
    { id: "ban", name: "Bananas", brand: null },
    { id: "gold", name: "Goldfish crackers", brand: null },
    { id: "milk", name: "Milk", brand: null },
  ];
  const lines = [
    { text: "PURINA DOG FD 31.1LB", quantity: null, unitCents: null, totalCents: 5499 },
    { text: "BANANAS", quantity: 2.34, unitCents: 59, totalCents: 138 },
    { text: "GLDFSH CRKR", quantity: 2, unitCents: 250, totalCents: 500 },
    { text: "KS PAPER TWL", quantity: null, unitCents: null, totalCents: 1899 },
    { text: "TAX", quantity: null, unitCents: null, totalCents: 312 },
  ];
  const matches = matchReceipt({ lines, aliases: new Map([[receiptTextKey("PURINA DOG FD 31.1LB"), "dog"]]), trip: pantry.slice(0, 3), pantry });
  const receipt: PreparedReceipt = {
    merchant: "TARGET T-1234",
    date: "2026-10-04",
    totalCents: 8348,
    purchaseId: "p",
    storeId: "t",
    lines: lines.map((l, i) => ({ ...l, key: matches[i].key, match: matches[i] })),
    tripItems: pantry.slice(0, 3),
    pantry,
    stores: [
      { id: "t", name: "Target" },
      { id: "a", name: "Aldi" },
    ],
  };
  return (
    <div className="graph-paper min-h-screen bg-muted p-4 sm:p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-extrabold">📸 Snap the receipt</h1>
        <ReceiptReview receipt={receipt} />
      </div>
    </div>
  );
}
