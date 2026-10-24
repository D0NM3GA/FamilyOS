"use client";

import { useEffect, useRef, useState } from "react";
import { btn } from "@/components/styles";
import { cameraError } from "@/components/camera";
import { checkVin } from "@/lib/vehicles/vin";

// Door jambs carry a Code 39 (sometimes Code 128) barcode; windshield stickers a Data Matrix or QR.
const FORMATS = ["code_39", "code_128", "data_matrix", "qr_code"] as const;
const DETECT_INTERVAL_MS = 125;

/**
 * Phase 53: reads a VIN with the camera, with the same self-hosted decoder as the Groceries
 * scanner (zxing-wasm, never a CDN), for VIN barcodes. Stops at the first VIN read the same twice
 * in a row (a passing glance at another code doesn't count) and hands it over.
 */
export function VinScanner({ onVin, onDone }: { onVin: (vin: string) => void; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onVinRef = useRef(onVin);
  const [status, setStatus] = useState<string>("Starting the camera…");

  useEffect(() => {
    onVinRef.current = onVin;
  }, [onVin]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    async function start() {
      try {
        const { BarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } = await import("barcode-detector/ponyfill");
        if (stopped) return;
        void prepareZXingModule({
          overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/zxing/zxing_reader-${ZXING_WASM_VERSION}.wasm` : prefix + path) },
          fireImmediately: true,
        }).catch(() => {});
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) return media.getTracks().forEach((t) => t.stop());
        stream = media;
        const video = videoRef.current;
        if (!video) return stop();
        video.srcObject = media;
        await video.play();
        if (stopped) return;
        const detector = new BarcodeDetector({ formats: [...FORMATS] });
        setStatus("Point the camera at the VIN barcode (inside the driver's door, or the windshield sticker).");
        let last = 0;
        let seen: string | null = null;
        const tick = async (now: number) => {
          if (stopped) return;
          if (now - last >= DETECT_INTERVAL_MS && video.readyState >= 2 && video.videoWidth > 0) {
            last = now;
            const found = await detector.detect(video).catch(() => []);
            if (stopped) return;
            const vin = found.map((b) => checkVin(b.rawValue)).find((v) => v.ok);
            const read = vin && vin.ok ? vin.vin : null;
            if (read && read === seen) {
              stop();
              navigator.vibrate?.(60);
              onVinRef.current(read);
              return;
            }
            seen = read;
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (err) {
        if (!stopped) {
          stop();
          setStatus(cameraError(err).replaceAll("the number", "the VIN"));
        }
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);

  return (
    <div className="space-y-2">
      <video ref={videoRef} playsInline muted autoPlay aria-label="Camera preview" className="aspect-[4/3] w-full rounded-md bg-black object-cover" />
      <p className="min-h-4 text-xs text-muted-foreground" role="status">
        {status}
      </p>
      <button type="button" onClick={onDone} className={btn}>
        Done
      </button>
    </div>
  );
}
