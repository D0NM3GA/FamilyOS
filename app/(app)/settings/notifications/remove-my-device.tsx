"use client";

import { useState, useTransition } from "react";
import { removeMyDevice } from "../alerts/actions";

export function RemoveMyDevice({ deviceId }: { deviceId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Stop alerts on that phone?")) return;
          start(async () => setError((await removeMyDevice(deviceId)).error ?? null));
        }}
        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ring-1 ring-input hover:bg-muted disabled:opacity-50 sm:min-h-9"
      >
        Remove
      </button>
    </span>
  );
}
