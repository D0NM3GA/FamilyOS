import { createHash } from "node:crypto";
import { BlockList, isIP } from "node:net";

/**
 * School calendar feed URLs (Phase 18.5): normalising what an admin pastes, and the
 * address blocklist behind the fetcher's SSRF guard (lib/school/feeds/fetch.ts). Pure.
 */

export type NormalizedUrl = { ok: true; url: URL } | { ok: false; error: string };

/** webcal(s):// is how calendar apps link feeds; it's https underneath. Only https is fetched. */
export function normalizeFeedUrl(raw: string): NormalizedUrl {
  let text = raw.trim();
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That doesn't look like a web address." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The feed address must start with https:// (or webcal://)." };
  if (url.username || url.password) return { ok: false, error: "Feed addresses with a username or password in them aren't supported." };
  url.hash = "";
  return { ok: true, url };
}

/** Same feed, same hash: for spotting a duplicate without storing the (secret) URL in clear. */
export function feedUrlHash(url: URL): string {
  return createHash("sha256").update(url.toString()).digest("hex");
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/**
 * True for any address the app must never fetch from: loopback, private, link-local,
 * carrier-grade NAT, multicast, reserved, and IPv6 forms that reach those (mapped v4,
 * NAT64, 6to4). A school feed lives on the public internet; anything else is someone
 * pointing the server at itself or the LAN.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return blocked.check(address, "ipv4");
}

/** A URL's hostname as an IP literal, if it is one ("[::1]" -> "::1"). */
export function literalAddress(url: URL): string | null {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return isIP(host) ? host : null;
}
