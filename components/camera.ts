import { useSyncExternalStore } from "react";

/** The camera helpers the Groceries barcode scanner and the Cars VIN scanner (Phase 53) share. */

/**
 * True when this browser can open a camera at all: getUserMedia exists only in a secure
 * context (https, or http://localhost). On a phone over plain http on the LAN the Scan
 * button simply doesn't appear. Read after hydration (false on the server) so the markup
 * matches.
 */
export function useCameraSupported(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function",
    () => false,
  );
}

export function cameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "The camera is blocked. Allow it in the browser's site settings, or type the number instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device. Type the number instead.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and try again.";
  return "Couldn't start the camera. Type the number instead.";
}
