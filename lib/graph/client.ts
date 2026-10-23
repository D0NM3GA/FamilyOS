import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Thrown when we can't get a usable Microsoft access token for the current session. */
export class GraphAuthError extends Error {}

/**
 * A Graph token for whoever is CURRENTLY SIGNED IN — resolved from the request's own
 * session headers, never from an arbitrary personId/userId passed in. Graph tokens are
 * per-account, so there is no safe way to fetch someone else's `/me` on their behalf;
 * keeping this self-only is what makes that mistake impossible to make by accident.
 *
 * Once per request (React cache): Home's calendar makes two Graph calls, and each uncached
 * call re-read the session and account rows.
 *
 * Phase 40.1 (Better Auth 1.7): the token is asked for by the signed-in user's own Microsoft
 * account row (1.7 takes the local row id, checked against the session's user, instead of a
 * provider name). Someone who signs in another way has no such row.
 */
export const getGraphToken = cache(async (): Promise<string> => {
  const session = await getServerSession();
  const account = session
    ? await prisma.account.findFirst({ where: { userId: session.user.id, providerId: "microsoft" }, select: { id: true } })
    : null;
  if (!account) throw new GraphAuthError("This needs a Microsoft sign-in.");
  try {
    const result = await auth.api.getAccessToken({
      body: { accountId: account.id },
      headers: await headers(),
    });
    if (!result?.accessToken) {
      throw new Error("No access token returned");
    }
    return result.accessToken;
  } catch (err) {
    throw new GraphAuthError(
      "Couldn't get a Microsoft access token — try signing out and back in.",
      { cause: err },
    );
  }
});

/**
 * Just the pathname of a Graph request, for error messages. The query can carry personal
 * data (lib/graph/mail.ts filters by a contact's email address), and error messages can end
 * up in logs or Sentry (Phase 15).
 */
function graphPathForErrors(path: string): string {
  return path.split("?")[0];
}

export async function graphFetchJson<T>(
  path: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const token = await getGraphToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
  });
  if (!res.ok) {
    throw new Error(`Graph request failed: ${res.status} ${graphPathForErrors(path)}`);
  }
  return res.json() as Promise<T>;
}

/** Returns null on 404 (e.g. no photo set) rather than throwing. */
export async function graphFetchBinary(
  path: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const token = await getGraphToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Graph request failed: ${res.status} ${graphPathForErrors(path)}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const arrayBuffer = await res.arrayBuffer();
  return { bytes: Buffer.from(arrayBuffer), contentType };
}

export type GraphResponse = {
  status: number;
  /** Parsed body, or null for 204 / a non-JSON body. */
  json: unknown;
  /** Seconds, from Retry-After on 429/503. */
  retryAfter: number | null;
};

/**
 * Any-method Graph call (Phase 17's calendar write-back is the app's first write). Takes
 * the token explicitly, rather than reading the session itself, so a sync can run inside
 * `after()`, where a Server Component may no longer read request headers; the caller got
 * the token from getGraphToken() while it still could. Never throws on an HTTP status:
 * the caller decides what a 404 or a 429 means. Network failures do throw.
 */
export async function graphRequest(
  token: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<GraphResponse> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const retryAfterRaw = res.headers.get("retry-after");
  const retryAfter = retryAfterRaw && /^\d+$/.test(retryAfterRaw) ? Number(retryAfterRaw) : null;
  return { status: res.status, json, retryAfter };
}

/** A Graph caller bound to one already-fetched token (calendar sync, Phase 29 order mail). */
export type Graph = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<GraphResponse>;

export function graphWithToken(token: string): Graph {
  return (method, path, body) => graphRequest(token, method, path, body);
}

/** The Graph path of a request, safe for error text (see graphPathForErrors). */
export { graphPathForErrors };
