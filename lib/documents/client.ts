import { COGNITIVE_SERVICES_SCOPE, getAppToken, invalidateAppToken } from "@/lib/graph/app-token";

/**
 * Phase 24: Azure AI Document Intelligence, the family's document reader. A kernel (no
 * domain imports, no database) so receipts today and bills or other paperwork later can
 * share it. REST v4.0 GA, Node fetch only.
 *
 * Auth is Microsoft Entra only (no API key): the app's own registration's client
 * credentials for the Cognitive Services scope, authorized by an Azure "Cognitive Services
 * User" role on this one resource. Entra needs the resource's custom-subdomain endpoint,
 * which is also the only kind DOCINTEL_ENDPOINT accepts. Setup: README "Receipts".
 *
 * Privacy: the document is sent once and never stored here; after reading, the result is
 * deleted from the service (it would otherwise keep input and result for 24 hours).
 * Errors carry fixed text and at most an HTTP status, never the service's response, which
 * could echo document content.
 */

const API_VERSION = "2024-11-30";
const ENDPOINT_SUFFIX = ".cognitiveservices.azure.com";
const POLL_MS = 2000;
const REQUEST_TIMEOUT_MS = 15_000;
const DEADLINE_MS = 45_000;

export class DocumentError extends Error {
  constructor(
    message: string,
    readonly kind: "notConfigured" | "busy" | "refused" | "failed" | "timeout",
  ) {
    super(message);
  }
}

export const NOT_CONFIGURED = "Receipt reading isn't set up yet. Ask a grown-up (README, Receipts).";

/** The resource's custom-subdomain endpoint, or null when it isn't a safe one to send a token to. */
export function checkEndpoint(raw: string | undefined): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const ok =
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash &&
    (url.pathname === "/" || url.pathname === "") &&
    host.endsWith(ENDPOINT_SUFFIX) &&
    host.length > ENDPOINT_SUFFIX.length &&
    !host.slice(0, -ENDPOINT_SUFFIX.length).includes(".");
  return ok ? url : null;
}

export function documentsConfigured(): boolean {
  return checkEndpoint(process.env.DOCINTEL_ENDPOINT) != null;
}

export type Deps = {
  fetchFn?: typeof fetch;
  token?: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type AnalyzeStatus = { status?: string; analyzeResult?: unknown };

/** Frees the connection when the body isn't needed. */
function drain(res: Response) {
  void res.body?.cancel().catch(() => {});
}

function refused(status: number): DocumentError {
  // A role applied (or removed) after the cached token was minted: get a fresh one next time.
  invalidateAppToken(COGNITIVE_SERVICES_SCOPE);
  return new DocumentError(`The receipt reader refused this app (${status}). Check its setup (README, Receipts).`, "refused");
}

function retryAfterMs(res: Response): number {
  const s = Number(res.headers.get("retry-after"));
  return Number.isFinite(s) && s > 0 ? Math.min(s * 1000, 10_000) : POLL_MS;
}

/**
 * Reads one document with a prebuilt model ("prebuilt-receipt") and returns the raw
 * AnalyzeResult. Throws DocumentError with copy fit to show a person.
 */
export async function analyzeDocument(
  input: { model: string; bytes: Uint8Array },
  deps: Deps = {},
): Promise<unknown> {
  const endpoint = checkEndpoint(process.env.DOCINTEL_ENDPOINT);
  if (!endpoint) throw new DocumentError(NOT_CONFIGURED, "notConfigured");
  if (!/^prebuilt-[a-z.]+$/i.test(input.model)) throw new DocumentError("Unknown document type.", "failed");

  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + DEADLINE_MS;

  let token: string;
  try {
    token = await (deps.token ?? (() => getAppToken(COGNITIVE_SERVICES_SCOPE, { fetchFn: deps.fetchFn })))();
  } catch {
    throw new DocumentError("Couldn't sign in to the receipt reader. Check its setup (README, Receipts).", "refused");
  }
  const auth = { Authorization: `Bearer ${token}` };

  const analyzeUrl = new URL(`/documentintelligence/documentModels/${input.model}:analyze`, endpoint);
  analyzeUrl.searchParams.set("api-version", API_VERSION);

  let started: Response;
  try {
    started = await fetchFn(analyzeUrl, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ base64Source: Buffer.from(input.bytes).toString("base64") }),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DocumentError("Couldn't reach the receipt reader. Try again in a moment.", "failed");
  }
  drain(started);
  if (started.status === 429) throw new DocumentError("Receipt reading is busy. Try again in a minute.", "busy");
  if (started.status === 401 || started.status === 403) throw refused(started.status);
  if (started.status !== 202) throw new DocumentError(`Couldn't read that (${started.status}).`, "failed");

  // The result URL may be relative, and must stay on the resource we trust with the token.
  const header = started.headers.get("operation-location");
  let resultUrl: URL;
  try {
    resultUrl = new URL(header ?? "", endpoint);
  } catch {
    throw new DocumentError("The receipt reader gave an unexpected answer.", "failed");
  }
  if (!header || resultUrl.origin !== endpoint.origin || !resultUrl.pathname.startsWith("/documentintelligence/")) {
    throw new DocumentError("The receipt reader gave an unexpected answer.", "failed");
  }

  let wait = POLL_MS;
  for (;;) {
    if (now() + wait > deadline) throw new DocumentError("Reading the receipt took too long. Try again.", "timeout");
    await sleep(wait);
    let res: Response;
    try {
      res = await fetchFn(resultUrl, { headers: auth, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new DocumentError("Lost the connection while reading the receipt. Try again.", "failed");
    }
    if (res.status === 429) {
      wait = retryAfterMs(res);
      drain(res);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      drain(res);
      throw refused(res.status);
    }
    if (!res.ok) {
      drain(res);
      throw new DocumentError(`Couldn't read that (${res.status}).`, "failed");
    }
    const body = (await res.json().catch(() => ({}))) as AnalyzeStatus;
    if (typeof body.status !== "string") throw new DocumentError("The receipt reader gave an unexpected answer.", "failed");
    if (body.status === "succeeded") {
      // Purge the copy the service keeps for 24 hours. Best effort: the read already worked.
      // Fire-and-forget is fine on the Node runtime this app uses (not the edge runtime).
      void fetchFn(resultUrl, { method: "DELETE", headers: auth, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(
        () => {},
      );
      return body.analyzeResult ?? {};
    }
    if (body.status !== "running" && body.status !== "notStarted") {
      throw new DocumentError("Couldn't read that photo. Try a flatter, brighter shot.", "failed");
    }
    wait = retryAfterMs(res);
  }
}
