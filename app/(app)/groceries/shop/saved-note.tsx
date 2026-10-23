"use client";

import { useEffect, useState } from "react";

function asOf(at: number): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return when.toDateString() === new Date().toDateString()
    ? time
    : `${when.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

/** Asks the app's service worker whether this page came from the copy it saved (public/sw.js). */
function askWorker(): Promise<boolean> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 2000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(Boolean(e.data?.fromCopy));
    };
    worker.postMessage({ type: "from-copy?" }, [channel.port2]);
  });
}

/**
 * Phase 44.2: says when the Shop view is the list saved on this device rather than a fresh one.
 * Only the worker knows (a browser with no signal can still say it's online), so the page
 * asks it after hydration.
 */
export function SavedNote({ renderedAt }: { renderedAt: number }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    void askWorker().then((fromCopy) => live && setSaved(fromCopy));
    return () => {
      live = false;
    };
  }, []);
  if (!saved) return null;
  return (
    <p role="status" className="rounded-xl bg-sun/30 px-3 py-2 text-sm font-semibold">
      The list as of {asOf(renderedAt)}, saved on this device. Check-offs sync when there&apos;s signal.
    </p>
  );
}
