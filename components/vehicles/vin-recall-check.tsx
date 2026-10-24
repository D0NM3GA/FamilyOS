"use client";

import { useState } from "react";
import { btn } from "@/components/styles";

/**
 * Phase 53: NHTSA's list above is by model; whether this very car still has an open recall is
 * the manufacturers' data, which NHTSA only offers on its own page (no public API). So: the VIN
 * to copy, and a link to that page, where it goes in the VIN box.
 */
export function VinRecallCheck({ vin }: { vin: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        This car&apos;s VIN: <span className="font-mono text-foreground">{vin}</span>
      </span>
      <button
        type="button"
        className={btn}
        onClick={() =>
          navigator.clipboard?.writeText(vin).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? "Copied" : "Copy the VIN"}
      </button>
      <a href="https://www.nhtsa.gov/recalls" target="_blank" rel="noreferrer" className="font-medium text-brand-text hover:underline">
        Check this VIN at NHTSA ↗
      </a>
      <span role="status" className="sr-only">
        {copied ? "The VIN is copied." : ""}
      </span>
    </div>
  );
}
