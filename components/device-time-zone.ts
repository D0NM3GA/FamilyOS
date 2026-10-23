"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const unknownOnServer = () => null;

/**
 * Phase 45.2: this device's IANA time zone, or null on the server and during hydration (it
 * can't be known there), the same useSyncExternalStore pattern as the theme toggle, so the
 * first render matches the server's and the real value follows right after.
 */
export function useDeviceTimeZone(): string | null {
  return useSyncExternalStore(noSubscribe, deviceZone, unknownOnServer);
}
