/**
 * Phase 29: reading retailers' order emails. Pure: no database, no Graph.
 *
 * Only an allowlist of senders is ever read (classify), and only after the mailbox's own
 * mail server vouched for the sender (senderVerified): anyone can type "auto-confirm@amazon.com"
 * into a From line. An order only ever annotates a charge the bank reported; it never
 * changes an amount, a category or a budget, so a wrong one can mislead but not move money.
 *
 * Shapes are modeled on real mails (fixtures in parse.test.ts are synthetic copies):
 * - Amazon "Ordered N item(s): <Category>": order number, a category label, Grand Total.
 *   (Amazon's confirmations no longer name the items.)
 * - Apple "Your receipt from Apple.": order id, date, items with prices, TOTAL. The HTML holds
 *   a hidden mobile copy of everything, which is cut off first.
 * - Publix pickup orders: order number, pickup time, items with Qty and price, Estimated Total.
 *   Often arrives through an addy.io alias relay (alias+NoReply.Publix=publix.com@mailer.me).
 */

export type Retailer = "AMAZON" | "APPLE" | "PUBLIX";

export type OrderItem = { name: string; qty: number; priceCents: number | null };

export type ParsedOrder = {
  retailer: Retailer;
  orderNumber: string;
  /** Civil day, YYYY-MM-DD. */
  orderedOn: string;
  totalCents: number | null;
  label: string | null;
  items: OrderItem[];
};

const MAX_HTML = 512 * 1024;
const MAX_ITEMS = 50;
const MAX_NAME = 200;

// ---- who sent it ---------------------------------------------------------------------------

/** addy.io (and its older anonaddy) relay domains: alias+name=domain.com@relay. */
const RELAY_DOMAINS = new Set(["mailer.me", "anonaddy.me", "anonaddy.com", "addy.io"]);

/**
 * The real sender behind an alias relay ("alias+NoReply.Publix=publix.com@mailer.me" →
 * "noreply.publix@publix.com"), or the address itself. Lowercased.
 */
export function decodeSender(address: string): { address: string; relay: string | null } {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf("@");
  if (at < 0) return { address: a, relay: null };
  const local = a.slice(0, at);
  const domain = a.slice(at + 1);
  if (!RELAY_DOMAINS.has(domain)) return { address: a, relay: null };
  const plus = local.indexOf("+");
  const encoded = plus >= 0 ? local.slice(plus + 1) : "";
  const eq = encoded.lastIndexOf("=");
  if (eq <= 0 || eq === encoded.length - 1) return { address: a, relay: null };
  return { address: `${encoded.slice(0, eq)}@${encoded.slice(eq + 1)}`, relay: domain };
}

type Rule = { retailer: Retailer; sender: string; domain: string; subject: RegExp };

const RULES: Rule[] = [
  { retailer: "AMAZON", sender: "auto-confirm@amazon.com", domain: "amazon.com", subject: /^ordered\b/i },
  { retailer: "APPLE", sender: "no_reply@email.apple.com", domain: "apple.com", subject: /^your receipt from apple/i },
  { retailer: "PUBLIX", sender: "noreply.publix@publix.com", domain: "publix.com", subject: /publix order confirmation/i },
];

/** The direct senders Graph can filter on server-side (relayed ones are found by search). */
export const DIRECT_SENDERS = RULES.map((r) => r.sender);

export type Classified = { retailer: Retailer; domain: string; relay: string | null };

/** An order email we read, or null for everything else (never opened). */
export function classify(from: string, subject: string): Classified | null {
  const { address, relay } = decodeSender(from);
  const rule = RULES.find((r) => r.sender === address && r.subject.test(subject.trim()));
  return rule ? { retailer: rule.retailer, domain: rule.domain, relay } : null;
}

/**
 * Whether the mailbox's mail server authenticated the sender: dmarc=pass (or Microsoft's
 * compauth=pass) for a From domain that is the retailer's. Only the TOPMOST
 * Authentication-Results header counts: Exchange Online adds its own on top, and anything
 * below it could have been written by the sender.
 *
 * A relayed mail (addy.io) is vouched for only as coming from the relay, which rewrote From;
 * the retailer's address sits inside the person's own alias. Someone who learned that alias
 * could send a fake "Publix" order. Accepted: an order only annotates a charge (see top).
 */
export function senderVerified(headers: { name: string; value: string }[], c: Classified): boolean {
  const want = c.relay ?? c.domain;
  const top = headers.find((h) => h.name.toLowerCase() === "authentication-results");
  if (!top) return false;
  const v = top.value.toLowerCase();
  const passed = /\bdmarc=pass\b/.test(v) || /\bcompauth=pass\b/.test(v);
  const froms = [...v.matchAll(/header\.from=([a-z0-9.-]+)/g)].map((m) => m[1]);
  return passed && froms.some((d) => d === want || d.endsWith(`.${want}`));
}

// ---- reading it ------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", reg: "®", copy: "©", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", bull: "•" };

/** Removes <tag ...>...</tag> blocks in one left-to-right pass (no backtracking). */
function dropBlocks(html: string, tag: string): string {
  const lower = html.toLowerCase();
  let out = "";
  let at = 0;
  // The tag itself, not a longer one (<head, not <header).
  const find = (from: number) => {
    for (let i = lower.indexOf(`<${tag}`, from); i >= 0; i = lower.indexOf(`<${tag}`, i + 1)) {
      if (/[\s>/]/.test(lower[i + tag.length + 1] ?? ">")) return i;
    }
    return -1;
  };
  for (;;) {
    const open = find(at);
    if (open < 0) break;
    const close = lower.indexOf(`</${tag}`, open);
    if (close < 0) break;
    const end = lower.indexOf(">", close);
    out += html.slice(at, open) + " ";
    at = end < 0 ? html.length : end + 1;
  }
  return out + html.slice(at);
}

/** Mail HTML → trimmed, non-empty lines. Size-capped; every regex here is linear. */
export function htmlToText(html: string): string[] {
  let h = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;
  // Styles first: Apple's stylesheet names the mobile block too.
  for (const tag of ["style", "script", "head"]) h = dropBlocks(h, tag);
  // Apple repeats the whole receipt in a hidden mobile block: keep only the first copy.
  const mobile = h.search(/class="[^"]{0,200}aapl-mobile-div/);
  if (mobile > 0) h = h.slice(0, mobile);
  h = h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table|tbody)\s*>/gi, "\n")
    .replace(/<[^<>]{0,4000}>/g, " ")
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    // Zero-width, soft hyphen, combining joiner and direction marks (Amazon wraps the order
    // number in a right-to-left mark).
    .replace(/[\u00AD\u034F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "");
  return h
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l) => l.length > 0);
}

const MONEY = /^-?\$\s?([\d,]{1,9})\.(\d\d)$/;
const cents = (line: string | undefined): number | null => {
  const m = line ? MONEY.exec(line.trim()) : null;
  return m ? Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]) : null;
};

/** The money on this line or, when the line is only a label, the next one. */
function amountAfter(lines: string[], label: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i])) continue;
    const inline = /\$\s?[\d,]{1,9}\.\d\d/.exec(lines[i]);
    if (inline) return cents(inline[0]);
    const next = cents(lines[i + 1]);
    if (next != null) return next;
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Aug 25, 2026" / "October 25, 2025 at 1:45 PM" → "2026-08-25". */
export function civilDay(text: string): string | null {
  const m = /\b([a-z]{3,9})\.? (\d{1,2}), (\d{4})\b/i.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  const day = Number(m[2]);
  if (month < 0 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function parseAmazon(subject: string, lines: string[], received: Date): ParsedOrder | null {
  const joined = lines.join("\n");
  const order = /Order\s*#\s*(\d{3}-\d{7}-\d{7})/.exec(joined);
  if (!order) return null;
  // "Ordered 1 item: Floor Care" / 'Ordered: "Lamp" and 2 more items'
  const label = /^ordered(?:\s+\d+\s+items?)?\s*:\s*["“']?(.+?)["”']?(?:\s+and\s+\d+\s+more\s+items?)?$/i.exec(subject.trim());
  return {
    retailer: "AMAZON",
    orderNumber: order[1],
    orderedOn: dayOf(received),
    totalCents: amountAfter(lines, /^grand total:?/i),
    label: label ? clip(label[1]) : null,
    items: [],
  };
}

const APPLE_SECTIONS = new Set(["app store", "apple services", "itunes store", "apple books", "apple tv", "apple music", "icloud"]);
const APPLE_NOISE = /^(in-app purchase|report a problem|write a review|renews .+|\(?(monthly|annual|yearly|weekly)\)?)$/i;

export function parseApple(lines: string[], received: Date): ParsedOrder | null {
  const idAt = lines.findIndex((l) => /^order id\b/i.test(l));
  if (idAt < 0) return null;
  const inline = /^order id:?\s*([A-Z0-9]{6,20})\s*$/i.exec(lines[idAt]);
  const orderNumber = inline ? inline[1] : /^[A-Z0-9]{6,20}$/i.test(lines[idAt + 1] ?? "") ? lines[idAt + 1] : null;
  if (!orderNumber) return null;
  const dateAt = lines.findIndex((l) => /^date$/i.test(l));
  const orderedOn = (dateAt >= 0 && civilDay(lines[dateAt + 1] ?? "")) || dayOf(received);

  const totalAt = lines.findIndex((l) => /^total$/i.test(l));
  const docAt = lines.findIndex((l) => /^document no\.?/i.test(l));
  const start = Math.max(idAt, docAt) + 2;
  // Items end where the money summary starts (Subtotal / Tax / TOTAL).
  const summaryAt = lines.findIndex((l, i) => i >= start && /^(subtotal|tax|total)$/i.test(l));
  const end = summaryAt >= 0 ? summaryAt : lines.length;
  const items: OrderItem[] = [];
  let buffer: string[] = [];
  for (const line of lines.slice(start, end)) {
    const price = cents(line);
    if (price == null) {
      if (!APPLE_SECTIONS.has(line.toLowerCase()) && !APPLE_NOISE.test(line)) buffer.push(line);
      continue;
    }
    if (buffer.length && items.length < MAX_ITEMS) {
      // App name, then what was bought; the line after that names the device or person.
      items.push({ name: clip(buffer.slice(0, 2).join(" — ")), qty: 1, priceCents: price });
    }
    buffer = [];
  }
  return {
    retailer: "APPLE",
    orderNumber,
    orderedOn,
    totalCents: totalAt >= 0 ? (cents(lines[totalAt + 1]) ?? null) : null,
    label: items[0]?.name.split(" — ")[0] ?? null,
    items,
  };
}

export function parsePublix(lines: string[], received: Date): ParsedOrder | null {
  const joined = lines.join("\n");
  const order = /Order number:?\s*([A-Z0-9][A-Z0-9-]{3,30})/i.exec(joined);
  if (!order) return null;
  const pickupAt = lines.findIndex((l) => /^pickup time$/i.test(l));
  const orderedOn = (pickupAt >= 0 && civilDay(lines[pickupAt + 1] ?? "")) || dayOf(received);
  const from = lines.findIndex((l) => /^your order$/i.test(l));
  const to = lines.findIndex((l, i) => i > from && /^order summary$/i.test(l));
  const items: OrderItem[] = [];
  if (from >= 0) {
    const body = lines.slice(from + 1, to > from ? to : undefined);
    for (let i = 0; i < body.length && items.length < MAX_ITEMS; i++) {
      const qty = /^qty:?\s*(\d{1,3})$/i.exec(body[i + 1] ?? "");
      if (!qty || /^pick up from/i.test(body[i])) continue;
      items.push({ name: clip(body[i]), qty: Number(qty[1]), priceCents: cents(body[i + 2]) });
      i += 2;
    }
  }
  return {
    retailer: "PUBLIX",
    orderNumber: order[1],
    orderedOn,
    totalCents: amountAfter(lines, /^(estimated )?total$/i),
    label: null,
    items,
  };
}

/** Reads one classified email's HTML body. Never throws: anything unexpected is null. */
export function parseOrder(c: Classified, subject: string, html: string, received: Date): ParsedOrder | null {
  try {
    const lines = htmlToText(html);
    if (c.retailer === "AMAZON") return parseAmazon(subject, lines, received);
    if (c.retailer === "APPLE") return parseApple(lines, received);
    return parsePublix(lines, received);
  } catch {
    return null;
  }
}
