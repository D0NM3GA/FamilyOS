"use client";

import { useState, useTransition } from "react";
import { ConfirmAction } from "@/components/submit";
import { removeMyDevice } from "../alerts/actions";

const button = "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ring-1 ring-input hover:bg-muted disabled:opacity-50 sm:min-h-9";

export function RemoveMyDevice({ deviceId }: { deviceId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      <ConfirmAction
        question="Stop alerts on that phone?"
        yes="Stop them"
        pending={pending}
        className={button}
        onConfirm={() => start(async () => setError((await removeMyDevice(deviceId)).error ?? null))}
      >
        Remove
      </ConfirmAction>
    </span>
  );
}
