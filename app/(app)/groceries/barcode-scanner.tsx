"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { normalizeBarcode } from "@/lib/groceries/barcode";
import { ScanGate } from "@/lib/groceries/scan-gate";
import { btn, btnPrimary } from "@/components/styles";
import { addItemByBarcode } from "./actions";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;
// Detection attempts per second. Enough to feel instant; more just burns the phone's battery.
const DETECT_INTERVAL_MS = 125;

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

function cameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "The camera is blocked. Allow it in the browser's site settings, or type the number instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device. Type the number instead.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and try again.";
  return "Couldn't start the camera. Type the number instead.";
}

type Status = { kind: "starting" } | { kind: "scanning" } | { kind: "stopped"; message: string };

/**
 * Camera barcode scanning (Phase 10.5). One decoder on every device: the barcode-detector
 * ponyfill (zxing-wasm), loaded only when this opens, with its wasm served from this app
 * (scripts/copy-zxing-wasm.mjs), never a CDN. zxing reports UPC-E already expanded, and
 * every code goes through normalizeBarcode, so a scan matches a typed entry of the same
 * product.
 *
 * addItemByBarcode is non-idempotent, so detections pass through a ScanGate (two identical
 * reads, one call in flight, a per-code cooldown). The camera stops on Done, on unmount,
 * when the page is hidden, and before handing an unknown code to the "what is it?" step.
 */
export function BarcodeScanner({ onUnknown, onDone }: { onUnknown: (barcode: string) => void; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onUnknownRef = useRef(onUnknown);
  // Whether the component is still on screen. Separate from a camera session being
  // stopped: a result that comes back after a pause must still be shown.
  const mountedRef = useRef(false);
  // One gate for the scanner's whole life, not per camera session: its in-flight flag and
  // cooldown must survive Resume, or the can still in view gets added again.
  const [gate] = useState(() => new ScanGate());
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [message, setMessage] = useState<string | null>(null);
  // Bumped by "Resume" to start a fresh camera session.
  const [session, setSession] = useState(0);

  useEffect(() => {
    onUnknownRef.current = onUnknown;
  }, [onUnknown]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;

    const stopCamera = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    const stopWith = (text: string) => {
      stopCamera();
      if (mountedRef.current) setStatus({ kind: "stopped", message: text });
    };

    async function submit(code: string) {
      let result: Awaited<ReturnType<typeof addItemByBarcode>>;
      try {
        result = await addItemByBarcode(code);
      } catch {
        result = { kind: "error", message: "Couldn't add that one. Try again." };
      }
      if (result.kind === "error") gate.release();
      else gate.settle(code, performance.now());
      if (!mountedRef.current) return;
      if (result.kind === "added") {
        setMessage(`Added ${result.productName}. Scan the next one, or tap Done.`);
        navigator.vibrate?.(60);
      } else if (result.kind === "unknown") {
        stopCamera();
        onUnknownRef.current(result.barcode);
      } else {
        setMessage(result.message);
      }
    }

    async function start() {
      try {
        const { BarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } = await import("barcode-detector/ponyfill");
        // Checked before asking for the camera, so a StrictMode double mount (dev) or a quick
        // Done doesn't open a second stream.
        if (stopped) return;
        // Start fetching the decoder while the camera permission prompt is up.
        void prepareZXingModule({
          overrides: {
            locateFile: (path: string, prefix: string) =>
              path.endsWith(".wasm") ? `/zxing/zxing_reader-${ZXING_WASM_VERSION}.wasm` : prefix + path,
          },
          fireImmediately: true,
        }).catch(() => {}); // a failure surfaces again, and is handled, at the first detect()

        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        // iOS ends the track when another app takes the camera (a call, Control Center),
        // often without hiding the page; without this the preview freezes with no way out.
        media.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (!stopped) stopWith("The camera stopped. Resume to try again.");
        });
        const video = videoRef.current;
        if (!video) return stopCamera();
        video.srcObject = media;
        await video.play(); // iOS needs this explicitly, with playsInline + muted
        if (stopped) return;

        const detector = new BarcodeDetector({ formats: [...FORMATS] });
        setStatus({ kind: "scanning" });

        let last = 0;
        const tick = async (now: number) => {
          if (stopped) return;
          if (now - last >= DETECT_INTERVAL_MS && video.readyState >= 2 && video.videoWidth > 0 && !gate.busy) {
            last = now;
            const found = await detector.detect(video).catch(() => []);
            if (stopped) return;
            const code = found.map((b) => normalizeBarcode(b.rawValue)).find((c) => c !== null) ?? null;
            const accepted = gate.observe(code, performance.now());
            if (accepted) void submit(accepted);
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (err) {
        if (!stopped) stopWith(cameraError(err));
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "hidden" && !stopped) stopWith("Paused while the app was in the background.");
    };

    document.addEventListener("visibilitychange", onVisibility);
    void start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopCamera();
    };
  }, [session, gate]);

  function resume() {
    setMessage(null);
    setStatus({ kind: "starting" });
    setSession((n) => n + 1);
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label="Camera preview"
          className="aspect-[4/3] w-full object-cover"
        />
        {status.kind === "scanning" && (
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
        )}
        {status.kind !== "scanning" && (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/90" aria-hidden>
            {status.kind === "starting" ? "Starting the camera…" : status.message}
          </p>
        )}
      </div>
      {/* One live region for everything: status changes (blocked, paused) and results. */}
      <p className="min-h-4 text-xs text-muted-foreground" role="status">
        {message ??
          (status.kind === "scanning"
            ? "Point the camera at a barcode."
            : status.kind === "starting"
              ? "Starting the camera…"
              : status.message)}
      </p>
      <div className="flex flex-wrap gap-2">
        {status.kind === "stopped" && (
          <button type="button" onClick={resume} className={btnPrimary}>
            Resume
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className={btn}
        >
          Done
        </button>
      </div>
    </div>
  );
}
