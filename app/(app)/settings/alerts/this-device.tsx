"use client";

import { useEffect, useState, useTransition } from "react";
import { saveThisDevice, turnOffThisDevice, whoseDevice } from "./actions";
import { useAppName } from "@/components/family-look";
import { registerAppWorker } from "@/lib/offline/worker";

type State =
  | { kind: "checking" }
  | { kind: "noServer" }
  | { kind: "insecure" }
  | { kind: "installFirst" }
  | { kind: "unsupported" }
  | { kind: "denied" }
  | { kind: "error" }
  | { kind: "ready"; owner: { name: string; isMe: boolean } | null; endpoint: string | null };

const btn = "inline-flex min-h-11 items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50 sm:min-h-9";
const quiet = "inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-input hover:bg-muted disabled:opacity-50 sm:min-h-9";

/** iPhones and iPads (iPadOS reports a Mac user agent, so check touch too). */
function isAppleTouch() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function keyBytes(b64u: string) {
  const s = atob(b64u.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * Phase 21.6 "This phone": turns phone alerts on for this browser, for the active grown-up.
 * Permission must be requested inside the tap. On an iPhone it only works from the Home
 * Screen app, so a Safari tab gets the "add to Home Screen" hint instead.
 */
export function ThisDevice({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const appName = useAppName();
  const [state, setState] = useState<State>({ kind: "checking" });
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();

  async function refresh() {
    if (!vapidPublicKey) return setState({ kind: "noServer" });
    if (!window.isSecureContext) return setState({ kind: "insecure" });
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      return setState({ kind: isAppleTouch() && !standalone ? "installFirst" : "unsupported" });
    }
    if (Notification.permission === "denied") return setState({ kind: "denied" });
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const owner = sub ? await whoseDevice(sub.endpoint) : null;
    setState({ kind: "ready", owner, endpoint: sub?.endpoint ?? null });
  }

  useEffect(() => {
    // Runs once on mount to read this browser's current push state.
    // A failed server check isn't "this browser can't" — say it couldn't check.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch(() => setState({ kind: "error" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function turnOn() {
    setMsg({});
    start(async () => {
      try {
        // Ask first, inside the tap: browsers only allow the prompt from a user gesture.
        const permission = await Notification.requestPermission();
        if (permission === "denied") return setState({ kind: "denied" });
        if (permission !== "granted") return setMsg({ error: "Notifications weren't allowed. Tap the button again and choose Allow." });
        const reg = await registerAppWorker();
        await navigator.serviceWorker.ready;
        const key = keyBytes(vapidPublicKey!);
        let sub = await reg.pushManager.getSubscription();
        // A subscription made with old server keys can't be reused (and can't be resubscribed over).
        if (sub && !sameKey(sub.options.applicationServerKey, key)) {
          await sub.unsubscribe();
          sub = null;
        }
        sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const res = await saveThisDevice(sub.toJSON());
        setMsg(res);
        await refresh();
      } catch {
        setMsg({ error: "This browser wouldn't turn on notifications. Try again, or check its notification settings." });
      }
    });
  }

  function turnOff(endpoint: string) {
    setMsg({});
    start(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        await sub?.unsubscribe().catch(() => false);
        setMsg(await turnOffThisDevice(endpoint));
        await refresh();
      } catch {
        setMsg({ error: "Couldn't turn it off just now. Try again." });
      }
    });
  }

  let body: React.ReactNode;
  switch (state.kind) {
    case "checking":
      body = <p className="text-sm text-muted-foreground">Checking this phone…</p>;
      break;
    case "noServer":
      body = <p className="text-sm text-muted-foreground">Phone alerts aren&apos;t set up on the server yet (README, Alerts).</p>;
      break;
    case "insecure":
      body = (
        <p className="text-sm text-muted-foreground">
          Phone alerts need a secure (https) address. Open {appName} from its https address (for testing, the dev:lan setup).
        </p>
      );
      break;
    case "installFirst":
      body = (
        <p className="text-sm text-muted-foreground">
          On an iPhone or iPad, add {appName} to your Home Screen first: tap <b>Share</b>, then <b>Add to Home Screen</b>. Open it
          from there, sign in, and come back to this page.
        </p>
      );
      break;
    case "error":
      body = <p className="text-sm text-muted-foreground">Couldn&apos;t check this phone just now. Reload the page to try again.</p>;
      break;
    case "unsupported":
      body = <p className="text-sm text-muted-foreground">This browser can&apos;t show {appName} notifications.</p>;
      break;
    case "denied":
      body = (
        <p className="text-sm text-muted-foreground">
          Notifications are blocked for {appName} on this device. Allow them in the browser&apos;s (or iPhone&apos;s) notification
          settings, then reload this page.
        </p>
      );
      break;
    case "ready":
      body =
        state.endpoint && state.owner ? (
          <div className="space-y-2">
            <p className="text-sm">
              This phone alerts <b>{state.owner.isMe ? "you" : state.owner.name}</b>.
            </p>
            <div className="flex flex-wrap gap-2">
              {!state.owner.isMe && (
                <button type="button" disabled={pending} onClick={turnOn} className={btn}>
                  Alert me on this phone instead
                </button>
              )}
              <button type="button" disabled={pending} onClick={() => turnOff(state.endpoint!)} className={quiet}>
                Turn off on this phone
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">A phone alerts whoever turned it on last.</p>
            <button type="button" disabled={pending} onClick={turnOn} className={btn}>
              Turn on alerts on this phone
            </button>
          </div>
        );
      break;
  }

  return (
    <div className="space-y-2">
      {body}
      {msg.error && (
        <p role="alert" className="text-sm text-destructive">
          {msg.error}
        </p>
      )}
      {msg.ok && (
        <p role="status" className="text-sm text-foreground">
          {msg.ok}
        </p>
      )}
    </div>
  );
}
